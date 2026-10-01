// Package permits is an app's cached copy of who holds what in an
// organisation, refreshed only when a version says it is stale
// (admin/docs/workflow-engine-plan.md §10.3).
//
// Accounts publishes it (2026-10-01): orgs.permits_version, the `pv` claim
// on every token, and GET /api/orgs/{slug}/permits?app=<app> answering
// {org, app, version, members:[{sub, email, name, staff, roles, statements}]}
// with ETag "<version>" and 304 on If-None-Match. HTTPRefresher reads it,
// as the app's own core property token carrying workflows:permits (the
// property must be on Accounts' permitReaders), or as a manager's token.
// contract/permits/snapshot.json is the answer, as core reads it too.
//
// The four times an app refreshes, and the only four:
//  1. a request's token carries a permits version NEWER than the cache;
//  2. a request's token is OLDER than the cache AND the cache changed that
//     person's statements — the app answers 401 token_stale, never widens;
//  3. a permits.changed push announced a version (wanted_version);
//  4. there is no row (a cold start).
//
// There is no TTL. A failed refresh keeps the cached copy and marks it stale.
package permits

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/zavon-holdings/kit/go/policy"
)

// DDL is the cache table (§10.3).
const DDL = `CREATE TABLE IF NOT EXISTS permits_cache (
  org_slug       TEXT NOT NULL,
  app            TEXT NOT NULL,
  version        BIGINT NOT NULL,
  wanted_version BIGINT NOT NULL DEFAULT 0,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  members        JSONB NOT NULL,
  PRIMARY KEY (org_slug, app)
);`

// Member is one person's permits in one app of one organisation.
type Member struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	Name  string `json:"name,omitempty"`
	// Staff carry `*` on `*` in every organisation, the statement their
	// token carries too.
	Staff      bool               `json:"staff,omitempty"`
	Roles      []string           `json:"roles,omitempty"`
	Statements []policy.Statement `json:"statements"`
}

// Snapshot is one (org, app) at one version.
type Snapshot struct {
	Org     string    `json:"org"`
	App     string    `json:"app"`
	Version int64     `json:"version"`
	Members []Member  `json:"members"`
	Fetched time.Time `json:"fetched_at,omitempty"`
	// Wanted is the highest version a push announced; above Version it means
	// the copy is known stale.
	Wanted int64 `json:"wanted_version,omitempty"`
}

// Stale says a push has announced a version this copy has not reached.
func (s Snapshot) Stale() bool { return s.Wanted > s.Version }

// Find is one member by Accounts subject, or by lower-cased address.
func (s Snapshot) Find(subOrEmail string) (Member, bool) {
	want := strings.ToLower(strings.TrimSpace(subOrEmail))
	for _, m := range s.Members {
		if m.Sub == subOrEmail || strings.ToLower(m.Email) == want {
			return m, true
		}
	}
	return Member{}, false
}

// Holders lists the members holding a role code.
func (s Snapshot) Holders(role string) []Member {
	var out []Member
	for _, m := range s.Members {
		for _, r := range m.Roles {
			if r == role {
				out = append(out, m)
				break
			}
		}
	}
	return out
}

// Decide answers whether one member may do action on resource, with the same
// evaluator every app and Accounts use: deny beats allow, default deny. An
// unknown member is denied.
func Decide(s Snapshot, subOrEmail, action, resource string) policy.Decision {
	m, ok := s.Find(subOrEmail)
	if !ok {
		return policy.Decision{}
	}
	return policy.Decide(m.Statements, action, resource)
}

// Permitted lists the members whose statements allow action on resource — who
// can approve this, the member picker, "is this nominee allowed".
func Permitted(s Snapshot, action, resource string) []Member {
	var out []Member
	for _, m := range s.Members {
		if policy.Decide(m.Statements, action, resource).Allowed {
			out = append(out, m)
		}
	}
	return out
}

/* ── the four triggers ── */

// ShouldRefresh says whether an app should fetch (in the background) after
// seeing a request: a token newer than the cache (1), a push announced a
// newer version (3), or no row at all (4). A nil cached is "no row".
func ShouldRefresh(cached *Snapshot, tokenVersion int64) bool {
	if cached == nil {
		return true
	}
	return tokenVersion > cached.Version || cached.Wanted > cached.Version
}

// TokenStale says whether a request must be refused with 401 token_stale
// (rule 2): its token is OLDER than the cache, and the cache changed THIS
// person's statements since the token's version. changed lists the subjects
// whose statements changed between the two versions; when the app does not
// know (nil), a stale token for a member is refused, since the safe direction
// is a refresh. An unrelated role edit must not bounce everybody, so a
// non-nil list that omits the subject lets the request proceed.
func TokenStale(cached *Snapshot, tokenVersion int64, sub string, changed []string) bool {
	if cached == nil || tokenVersion >= cached.Version {
		return false
	}
	if changed == nil {
		_, member := cached.Find(sub)
		return member
	}
	for _, c := range changed {
		if c == sub {
			return true
		}
	}
	return false
}

/* ── the cache ── */

// Row is one row as a Querier scans it.
type Row interface {
	Scan(dest ...any) error
}

// Querier is the least the cache needs: a pgx pool or transaction.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (any, error)
	QueryRow(ctx context.Context, sql string, args ...any) Row
}

// ErrNoRows is what a Querier returns for an empty QueryRow (pgx's text).
var ErrNoRows = errors.New("no rows in result set")

// Cache is the table through a Querier.
type Cache struct{ Q Querier }

// Get reads one (org, app); (nil, nil) when there is no row.
func (c Cache) Get(ctx context.Context, org, app string) (*Snapshot, error) {
	var s Snapshot
	var raw string
	err := c.Q.QueryRow(ctx, `SELECT org_slug, app, version, wanted_version, fetched_at, members::text
		  FROM permits_cache WHERE org_slug=$1 AND app=$2`, org, app).
		Scan(&s.Org, &s.App, &s.Version, &s.Wanted, &s.Fetched, &raw)
	if err != nil {
		if errors.Is(err, ErrNoRows) || strings.Contains(err.Error(), "no rows in result set") {
			return nil, nil
		}
		return nil, err
	}
	if err := json.Unmarshal([]byte(raw), &s.Members); err != nil {
		return nil, err
	}
	return &s, nil
}

// Put replaces one (org, app) with a fetched snapshot. wanted_version is
// lowered to the version reached, never raised: a push announced after the
// fetch is a newer fact.
func (c Cache) Put(ctx context.Context, s Snapshot) error {
	members, err := json.Marshal(s.Members)
	if err != nil {
		return err
	}
	if s.Members == nil {
		members = []byte(`[]`)
	}
	_, err = c.Q.Exec(ctx, `INSERT INTO permits_cache (org_slug, app, version, wanted_version, fetched_at, members)
		VALUES ($1, $2, $3, $3, now(), $4::jsonb)
		ON CONFLICT (org_slug, app) DO UPDATE SET version = EXCLUDED.version,
		  wanted_version = GREATEST(permits_cache.wanted_version, EXCLUDED.version),
		  fetched_at = now(), members = EXCLUDED.members`,
		s.Org, s.App, s.Version, string(members))
	return err
}

// MarkWanted records a permits.changed push: the next read refreshes. A row
// that does not exist yet is created empty at version 0, so the cold-start
// rule fetches it.
func (c Cache) MarkWanted(ctx context.Context, org, app string, version int64) error {
	_, err := c.Q.Exec(ctx, `INSERT INTO permits_cache (org_slug, app, version, wanted_version, members)
		VALUES ($1, $2, 0, $3, '[]'::jsonb)
		ON CONFLICT (org_slug, app) DO UPDATE SET wanted_version = GREATEST(permits_cache.wanted_version, EXCLUDED.wanted_version)`,
		org, app, version)
	return err
}

// Touch records a conditional GET that answered 304: nothing changed, the
// copy is confirmed current.
func (c Cache) Touch(ctx context.Context, org, app string) error {
	_, err := c.Q.Exec(ctx, `UPDATE permits_cache SET fetched_at = now(), wanted_version = version WHERE org_slug=$1 AND app=$2`, org, app)
	return err
}

/* ── fetching ── */

// ErrNotModified is a conditional fetch answered 304.
var ErrNotModified = errors.New("permits: not modified")

// Refresher fetches a snapshot from Accounts: GET /api/orgs/{slug}/permits
// ?app= with If-None-Match: "<version>". ErrNotModified for a 304.
// HTTPRefresher (http.go) is the implementation over the real endpoint.
type Refresher interface {
	Fetch(ctx context.Context, org, app string, ifNoneMatch int64) (Snapshot, error)
}

// Refresh brings one (org, app) up to date through r, and answers the copy
// to serve: on a failure the cached copy, marked stale, never nothing when
// something was held. A 304 confirms the copy.
func Refresh(ctx context.Context, c Cache, r Refresher, org, app string) (*Snapshot, error) {
	cached, err := c.Get(ctx, org, app)
	if err != nil {
		return nil, err
	}
	var have int64
	if cached != nil {
		have = cached.Version
	}
	fresh, err := r.Fetch(ctx, org, app, have)
	switch {
	case errors.Is(err, ErrNotModified):
		if cached != nil {
			_ = c.Touch(ctx, org, app)
			cached.Wanted = cached.Version
		}
		return cached, nil
	case err != nil:
		if cached != nil {
			// Served stale, said stale, never widened.
			if cached.Wanted < cached.Version+1 {
				cached.Wanted = cached.Version + 1
			}
			return cached, err
		}
		return nil, err
	}
	fresh.Org, fresh.App = org, app
	if err := c.Put(ctx, fresh); err != nil {
		return &fresh, err
	}
	fresh.Wanted = fresh.Version
	return &fresh, nil
}
