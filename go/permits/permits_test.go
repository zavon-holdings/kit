package permits

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/zavon-holdings/kit/go/policy"
)

func snapshot() Snapshot {
	return Snapshot{Org: "org-a", App: "cms", Version: 7, Members: []Member{
		{Sub: "acc_1", Email: "Cara@example.test", Name: "Cara", Roles: []string{"owner"}, Statements: []policy.Statement{
			{Sid: "all", Effect: policy.Allow, Actions: []string{"cms:*"}, Resources: []string{"*"}},
		}},
		{Sub: "acc_2", Email: "ben@example.test", Roles: []string{"editor"}, Statements: []policy.Statement{
			{Sid: "edit", Effect: policy.Allow, Actions: []string{"cms:page.edit", "cms:page.publish"}, Resources: []string{"page/*"}},
			{Sid: "not-home", Effect: policy.Deny, Actions: []string{"cms:page.publish"}, Resources: []string{"page/home"}},
		}},
		{Sub: "acc_3", Email: "guest@example.test", Statements: nil},
	}}
}

func TestDecideUsesThePolicyEvaluatorPerMember(t *testing.T) {
	s := snapshot()
	if d := Decide(s, "acc_1", "cms:page.publish", "page/home"); !d.Allowed {
		t.Fatalf("owner: %+v", d)
	}
	if d := Decide(s, "ben@example.test", "cms:page.publish", "page/about"); !d.Allowed || d.By != "edit" {
		t.Fatalf("editor on about: %+v", d)
	}
	if d := Decide(s, "BEN@example.test", "cms:page.publish", "page/home"); d.Allowed || d.By != "not-home" {
		t.Fatalf("deny beats allow: %+v", d)
	}
	if d := Decide(s, "acc_3", "cms:page.edit", "page/about"); d.Allowed {
		t.Fatal("no statements is default deny")
	}
	if d := Decide(s, "nobody", "cms:page.edit", "page/about"); d.Allowed || d.By != "" {
		t.Fatalf("unknown member: %+v", d)
	}
	who := Permitted(s, "cms:page.publish", "page/home")
	if len(who) != 1 || who[0].Sub != "acc_1" {
		t.Fatalf("permitted on home: %v", who)
	}
	if who := Permitted(s, "cms:page.publish", "page/about"); len(who) != 2 {
		t.Fatalf("permitted on about: %v", who)
	}
	if h := s.Holders("editor"); len(h) != 1 || h[0].Sub != "acc_2" {
		t.Fatalf("holders: %v", h)
	}
	if h := s.Holders("nobody-has-this"); h != nil {
		t.Fatal(h)
	}
	if _, ok := s.Find(" cara@example.test "); !ok {
		t.Fatal("email lookup is case- and space-insensitive")
	}
}

func TestTheFourRefreshTriggersAndOnlyThose(t *testing.T) {
	s := snapshot()
	if !ShouldRefresh(nil, 0) {
		t.Fatal("4: a cold start refreshes")
	}
	if !ShouldRefresh(&s, 8) {
		t.Fatal("1: a newer token refreshes")
	}
	if ShouldRefresh(&s, 7) || ShouldRefresh(&s, 3) {
		t.Fatal("a token at or below the cache does not refresh by itself — no TTL, no polling")
	}
	pushed := s
	pushed.Wanted = 9
	if !ShouldRefresh(&pushed, 7) || !pushed.Stale() {
		t.Fatal("3: a push announcing a version refreshes")
	}
	if s.Stale() {
		t.Fatal("a copy at its wanted version is not stale")
	}

	// 2: an OLDER token for a member whose statements changed is refused.
	if TokenStale(nil, 1, "acc_2", nil) {
		t.Fatal("no cache, nothing to be stale against")
	}
	if TokenStale(&s, 7, "acc_2", nil) || TokenStale(&s, 9, "acc_2", nil) {
		t.Fatal("a token at or above the cache is never stale")
	}
	if !TokenStale(&s, 5, "acc_2", nil) {
		t.Fatal("old token, member, unknown changes: refuse, the safe direction is a refresh")
	}
	if TokenStale(&s, 5, "stranger", nil) {
		t.Fatal("an old token for a non-member is not this rule's business")
	}
	if TokenStale(&s, 5, "acc_2", []string{"acc_1"}) {
		t.Fatal("an unrelated role edit must not bounce everybody")
	}
	if !TokenStale(&s, 5, "acc_2", []string{"acc_1", "acc_2"}) {
		t.Fatal("this person's statements changed: refuse")
	}
	if TokenStale(&s, 5, "acc_2", []string{}) {
		t.Fatal("a known-empty change list bounces nobody")
	}
}

/* ── the cache through a fake Querier ── */

type stored struct {
	version, wanted int64
	members         string
	fetched         time.Time
}

type fakeQ struct {
	rows map[string]*stored
	fail error
}

type scanRow struct {
	org, app string
	s        *stored
	err      error
}

func (r scanRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	*(dest[0].(*string)) = r.org
	*(dest[1].(*string)) = r.app
	*(dest[2].(*int64)) = r.s.version
	*(dest[3].(*int64)) = r.s.wanted
	*(dest[4].(*time.Time)) = r.s.fetched
	*(dest[5].(*string)) = r.s.members
	return nil
}

func (q *fakeQ) key(args []any) string { return args[0].(string) + "/" + args[1].(string) }

func (q *fakeQ) Exec(_ context.Context, sql string, args ...any) (any, error) {
	if q.fail != nil {
		return nil, q.fail
	}
	if q.rows == nil {
		q.rows = map[string]*stored{}
	}
	k := q.key(args)
	switch {
	case strings.Contains(sql, "INSERT INTO permits_cache") && strings.Contains(sql, "fetched_at, members"):
		if _, isString := args[3].(string); !isString {
			return nil, fmt.Errorf("JSONB must be a string, got %T", args[3])
		}
		v := args[2].(int64)
		if r, ok := q.rows[k]; ok {
			r.version, r.members, r.fetched = v, args[3].(string), time.Now()
			if v > r.wanted {
				r.wanted = v
			}
			return nil, nil
		}
		q.rows[k] = &stored{version: v, wanted: v, members: args[3].(string), fetched: time.Now()}
	case strings.Contains(sql, "INSERT INTO permits_cache"):
		w := args[2].(int64)
		if r, ok := q.rows[k]; ok {
			if w > r.wanted {
				r.wanted = w
			}
			return nil, nil
		}
		q.rows[k] = &stored{version: 0, wanted: w, members: "[]"}
	case strings.HasPrefix(sql, "UPDATE permits_cache SET fetched_at"):
		if r, ok := q.rows[k]; ok {
			r.fetched, r.wanted = time.Now(), r.version
		}
	default:
		return nil, fmt.Errorf("unexpected Exec %s", sql)
	}
	return nil, nil
}

func (q *fakeQ) QueryRow(_ context.Context, sql string, args ...any) Row {
	if q.fail != nil {
		return scanRow{err: q.fail}
	}
	if r, ok := q.rows[q.key(args)]; ok {
		return scanRow{org: args[0].(string), app: args[1].(string), s: r}
	}
	return scanRow{err: errors.New("no rows in result set")}
}

func TestTheCacheRoundTripsAndOnlyRaisesWanted(t *testing.T) {
	ctx := context.Background()
	q := &fakeQ{}
	c := Cache{Q: q}
	if got, err := c.Get(ctx, "org-a", "cms"); err != nil || got != nil {
		t.Fatalf("cold: %v %v", got, err)
	}
	if err := c.Put(ctx, snapshot()); err != nil {
		t.Fatal(err)
	}
	got, err := c.Get(ctx, "org-a", "cms")
	if err != nil || got == nil || got.Version != 7 || got.Wanted != 7 || len(got.Members) != 3 || got.Members[1].Statements[1].Effect != policy.Deny {
		t.Fatalf("round trip: %+v %v", got, err)
	}
	if got.Stale() {
		t.Fatal("a fresh put is not stale")
	}
	if err := c.MarkWanted(ctx, "org-a", "cms", 9); err != nil {
		t.Fatal(err)
	}
	if got, _ = c.Get(ctx, "org-a", "cms"); got.Wanted != 9 || !got.Stale() {
		t.Fatalf("after a push: %+v", got)
	}
	// An older push does not lower wanted.
	_ = c.MarkWanted(ctx, "org-a", "cms", 8)
	if got, _ = c.Get(ctx, "org-a", "cms"); got.Wanted != 9 {
		t.Fatalf("an older push lowered wanted: %+v", got)
	}
	// A put at 9 catches up; a put at 8 would still be stale.
	s := snapshot()
	s.Version = 8
	_ = c.Put(ctx, s)
	if got, _ = c.Get(ctx, "org-a", "cms"); got.Version != 8 || got.Wanted != 9 || !got.Stale() {
		t.Fatalf("put below wanted: %+v", got)
	}
	s.Version = 9
	_ = c.Put(ctx, s)
	if got, _ = c.Get(ctx, "org-a", "cms"); got.Stale() {
		t.Fatalf("put at wanted: %+v", got)
	}
	// A push for an org never seen creates an empty row the cold-start rule fetches.
	_ = c.MarkWanted(ctx, "org-b", "cms", 3)
	if got, _ = c.Get(ctx, "org-b", "cms"); got == nil || got.Version != 0 || got.Wanted != 3 || len(got.Members) != 0 || !ShouldRefresh(got, 0) {
		t.Fatalf("unseen org after a push: %+v", got)
	}
	if err := c.Put(ctx, Snapshot{Org: "x", App: "y", Version: 1}); err != nil {
		t.Fatal(err)
	}
	if q.rows["x/y"].members != "[]" {
		t.Fatalf("nil members stored as %q", q.rows["x/y"].members)
	}
	q.fail = errors.New("connection refused")
	if _, err := c.Get(ctx, "org-a", "cms"); err == nil {
		t.Fatal("a store fault was hidden")
	}
}

type fakeDirectory struct {
	answer Snapshot
	err    error
	asked  []int64
}

func (f *fakeDirectory) Fetch(_ context.Context, org, app string, ifNoneMatch int64) (Snapshot, error) {
	f.asked = append(f.asked, ifNoneMatch)
	return f.answer, f.err
}

func TestRefreshServesStaleOnFailureAndConfirmsOn304(t *testing.T) {
	ctx := context.Background()
	q := &fakeQ{}
	c := Cache{Q: q}
	acc := &fakeDirectory{answer: snapshot()}

	got, err := Refresh(ctx, c, acc, "org-a", "cms")
	if err != nil || got == nil || got.Version != 7 || acc.asked[0] != 0 {
		t.Fatalf("cold fetch: %+v %v asked %v", got, err, acc.asked)
	}
	if row, _ := c.Get(ctx, "org-a", "cms"); row == nil || row.Version != 7 {
		t.Fatal("the fetch was not stored")
	}

	acc.err = ErrNotModified
	_ = c.MarkWanted(ctx, "org-a", "cms", 8)
	got, err = Refresh(ctx, c, acc, "org-a", "cms")
	if err != nil || got.Version != 7 || got.Stale() || acc.asked[1] != 7 {
		t.Fatalf("304: %+v %v asked %v", got, err, acc.asked)
	}
	if row, _ := c.Get(ctx, "org-a", "cms"); row.Stale() {
		t.Fatal("a 304 confirms the copy; wanted should be lowered")
	}

	acc.err = errors.New("the identity service is down")
	got, err = Refresh(ctx, c, acc, "org-a", "cms")
	if err == nil || got == nil || got.Version != 7 || !got.Stale() {
		t.Fatalf("failure with a copy: served %+v err %v; want the copy, marked stale, with the error", got, err)
	}
	if got, err := Refresh(ctx, c, acc, "nowhere", "cms"); err == nil || got != nil {
		t.Fatalf("failure with no copy: %+v %v", got, err)
	}

	acc.err = nil
	acc.answer = Snapshot{Version: 10, Members: []Member{{Sub: "acc_9", Email: "z@example.test"}}}
	got, err = Refresh(ctx, c, acc, "org-a", "cms")
	if err != nil || got.Version != 10 || got.Org != "org-a" || got.App != "cms" || got.Stale() {
		t.Fatalf("fresh: %+v %v", got, err)
	}
	if row, _ := c.Get(ctx, "org-a", "cms"); row.Version != 10 || len(row.Members) != 1 {
		t.Fatalf("stored fresh: %+v", row)
	}

	// A snapshot survives JSON with its statements intact (the wire shape
	// the identity service will answer).
	raw, _ := json.Marshal(snapshot())
	var back Snapshot
	if err := json.Unmarshal(raw, &back); err != nil || len(back.Members) != 3 || back.Members[1].Statements[0].Sid != "edit" {
		t.Fatalf("wire: %v %+v", err, back)
	}
	if !strings.Contains(DDL, "permits_cache") || !strings.Contains(DDL, "wanted_version") {
		t.Fatal(DDL)
	}
}
