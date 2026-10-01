package wfclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Error is an answer core gave that was not a success: the §7.5 shape.
type Error struct {
	Status  int             `json:"-"`
	Code    string          `json:"code"`
	Message string          `json:"error"`
	Detail  json.RawMessage `json:"detail,omitempty"`
}

func (e *Error) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("core answered %d %s: %s", e.Status, e.Code, e.Message)
	}
	return fmt.Sprintf("core answered %d: %s", e.Status, e.Message)
}

// ErrUnreachable wraps a transport failure: core did not answer at all.
var ErrUnreachable = errors.New("wfclient: core did not answer")

// IsUnavailable says whether an error means core DID NOT DECIDE — it was
// unreachable, or it answered 5xx (503 unavailable included) — so the caller
// should try again later. A decided no (4xx) is not.
func IsUnavailable(err error) bool {
	if errors.Is(err, ErrUnreachable) {
		return true
	}
	var e *Error
	return errors.As(err, &e) && e.Status >= 500
}

// IsUnconfigured says whether core answered that its workflow engine is not
// set up — no database, or the wf_* tables not applied yet (§7.5
// `unconfigured`). It is a state for a screen to render, not a fault to
// retry: nothing will change until somebody finishes the deployment. It is
// ALSO unavailable (a 503), so a caller that only wants "try later" need not
// tell them apart; one that wants to say WHY reads this first. The code is
// what tells, never the presence of a reason — a store fault (`unavailable`)
// carries detail.reason too.
func IsUnconfigured(err error) bool {
	return Code(err) == "unconfigured"
}

// Code is the §7.5 code of an error, or "".
func Code(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

// Client speaks to one core with one property credential.
type Client struct {
	base  string
	token string
	http  *http.Client
	// Property, when set, rides as ?property= — for the admin credential,
	// which acts for a named property. A property token needs none.
	property string
}

// Option adjusts a Client.
type Option func(*Client)

// WithHTTPClient replaces the transport. The default has a 20-second timeout,
// shorter than the function that holds it: a timeout the client owns comes
// back as an error to retry, one the platform enforces kills the invocation.
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// WithProperty names the property an admin credential acts for.
func WithProperty(property string) Option { return func(c *Client) { c.property = property } }

// New builds a client. token is the property's zvn_ token (or the Vercel
// OIDC token, when the deployment is bound to the property).
func New(baseURL, token string, opts ...Option) *Client {
	c := &Client{base: strings.TrimRight(baseURL, "/"), token: token, http: &http.Client{Timeout: 20 * time.Second}}
	for _, o := range opts {
		o(c)
	}
	return c
}

// Configured says whether this client can call anything.
func (c *Client) Configured() bool { return c.base != "" && c.token != "" }

// ErrNotConfigured is a call on a client with no address or no credential.
var ErrNotConfigured = errors.New("wfclient: no ZAVON_CORE_URL or credential is configured")

// Result carries what every call answers beside its body.
type Result struct {
	Status int
	// Replayed is Idempotent-Replay: core answered a stored response to a key
	// it had seen, and did nothing new.
	Replayed bool
	ETag     string
}

// call makes one request. `into` receives the decoded body on a 2xx.
func (c *Client) call(ctx context.Context, method, path string, query url.Values, headers map[string]string, body any, into any) (Result, error) {
	var res Result
	if !c.Configured() {
		return res, ErrNotConfigured
	}
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return res, err
		}
		reader = bytes.NewReader(raw)
	}
	if c.property != "" {
		if query == nil {
			query = url.Values{}
		}
		query.Set("property", c.property)
	}
	u := c.base + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, reader)
	if err != nil {
		return res, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Zavon-Workflow-Version", WireVersion)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		if v != "" {
			req.Header.Set(k, v)
		}
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return res, fmt.Errorf("%w: %v", ErrUnreachable, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return res, fmt.Errorf("%w: reading the answer: %v", ErrUnreachable, err)
	}
	res.Status = resp.StatusCode
	res.Replayed = resp.Header.Get("Idempotent-Replay") == "true"
	res.ETag = resp.Header.Get("ETag")
	if resp.StatusCode >= 300 {
		e := &Error{Status: resp.StatusCode}
		if json.Unmarshal(raw, e) != nil || e.Message == "" {
			e.Message = strings.TrimSpace(string(raw))
			if e.Message == "" {
				e.Message = http.StatusText(resp.StatusCode)
			}
		}
		// A 412 carries the current ETag; keep it where the caller can see.
		if res.ETag != "" && e.Detail == nil {
			e.Detail, _ = json.Marshal(map[string]string{"etag": res.ETag})
		}
		return res, e
	}
	if into != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, into); err != nil {
			return res, fmt.Errorf("wfclient: core's answer could not be read: %w", err)
		}
	}
	return res, nil
}

func idem(key string) map[string]string { return map[string]string{"Idempotency-Key": key} }

/* ── manifest ── */

// PutManifest replaces the property's manifest. Idempotent by content; core
// answers changed:false for the same one again.
func (c *Client) PutManifest(ctx context.Context, m Manifest) (changed bool, err error) {
	var out struct {
		Changed bool `json:"changed"`
	}
	_, err = c.call(ctx, http.MethodPut, "/api/workflows/manifest", nil, nil, m, &out)
	return out.Changed, err
}

// GetManifest reads it back, with whether a callback secret is set.
func (c *Client) GetManifest(ctx context.Context) (ManifestStatus, error) {
	var out ManifestStatus
	_, err := c.call(ctx, http.MethodGet, "/api/workflows/manifest", nil, nil, nil, &out)
	return out, err
}

// RotateCallbackSecret mints the secret core signs its calls with. The value
// is shown once: store it as ZAVON_WORKFLOW_SECRET.
func (c *Client) RotateCallbackSecret(ctx context.Context) (RotatedSecret, error) {
	var out RotatedSecret
	_, err := c.call(ctx, http.MethodPost, "/api/workflows/callback-secret/rotate", nil, nil, nil, &out)
	return out, err
}

// Catalogue lists the events this property's definitions may start from.
func (c *Client) Catalogue(ctx context.Context, tenant string) ([]CatalogueEntry, error) {
	var out struct {
		Events []CatalogueEntry `json:"events"`
	}
	_, err := c.call(ctx, http.MethodGet, "/api/workflows/catalogue", url.Values{"tenant": {tenant}}, nil, nil, &out)
	return out.Events, err
}

/* ── definitions ── */

// ListDefinitions lists one tenant's definitions, a page at a time.
func (c *Client) ListDefinitions(ctx context.Context, f DefinitionFilter) ([]Definition, Page, error) {
	q := url.Values{"tenant": {f.Tenant}}
	if f.Kind != "" {
		q.Set("kind", f.Kind)
	}
	if f.IncludeTemplates {
		q.Set("include_templates", "true")
	}
	if f.IncludeArchived {
		q.Set("include_archived", "true")
	}
	if f.Cursor != "" {
		q.Set("cursor", f.Cursor)
	}
	if f.Limit > 0 {
		q.Set("limit", strconv.Itoa(f.Limit))
	}
	var out struct {
		Definitions []Definition `json:"definitions"`
		Page
	}
	_, err := c.call(ctx, http.MethodGet, "/api/workflows/definitions", q, nil, nil, &out)
	return out.Definitions, out.Page, err
}

// CreateDefinition creates one. Replayed says core answered the earlier
// creation for this key rather than making another.
func (c *Client) CreateDefinition(ctx context.Context, in DefinitionInput, idempotencyKey string) (Definition, Result, error) {
	var out Definition
	res, err := c.call(ctx, http.MethodPost, "/api/workflows/definitions", nil, idem(idempotencyKey), in, &out)
	return out, res, err
}

// GetDefinition reads one, with its ETag (also in the body).
func (c *Client) GetDefinition(ctx context.Context, uid string) (Definition, error) {
	var out Definition
	res, err := c.call(ctx, http.MethodGet, "/api/workflows/definitions/"+url.PathEscape(uid), nil, nil, nil, &out)
	if err == nil && out.ETag == "" {
		out.ETag = res.ETag
	}
	return out, err
}

// GetDefinitionVersion reads an old version's steps.
func (c *Client) GetDefinitionVersion(ctx context.Context, uid string, version int) ([]StepView, error) {
	var out struct {
		Steps []StepView `json:"steps"`
	}
	_, err := c.call(ctx, http.MethodGet, fmt.Sprintf("/api/workflows/definitions/%s/versions/%d", url.PathEscape(uid), version), nil, nil, nil, &out)
	return out.Steps, err
}

// SaveDefinition saves one. ifMatch is the ETag read; a stale one is a 412
// stale_definition whose Detail carries the current ETag.
func (c *Client) SaveDefinition(ctx context.Context, uid string, in DefinitionInput, ifMatch string) (Saved, error) {
	var out Saved
	_, err := c.call(ctx, http.MethodPut, "/api/workflows/definitions/"+url.PathEscape(uid), nil, map[string]string{"If-Match": ifMatch}, in, &out)
	return out, err
}

// Validate dry-runs a body against a definition (or the stored one when in
// is nil) and answers the problems.
func (c *Client) Validate(ctx context.Context, uid string, in *DefinitionInput) ([]Problem, error) {
	var out struct {
		Problems []Problem `json:"problems"`
	}
	var body any = map[string]any{}
	if in != nil {
		body = in
	}
	_, err := c.call(ctx, http.MethodPost, "/api/workflows/definitions/"+url.PathEscape(uid)+"/validate", nil, nil, body, &out)
	return out.Problems, err
}

// Archive takes a definition out of listings. Refused (409 runs_live) while
// runs are going unless cancelRuns.
func (c *Client) Archive(ctx context.Context, uid string, cancelRuns bool, reason string, actor *Actor) error {
	body := map[string]any{"cancel_runs": cancelRuns}
	if reason != "" {
		body["reason"] = reason
	}
	if actor != nil {
		body["actor"] = actor
	}
	_, err := c.call(ctx, http.MethodPost, "/api/workflows/definitions/"+url.PathEscape(uid)+"/archive", nil, nil, body, nil)
	return err
}

// Restore brings an archived definition back, switched off.
func (c *Client) Restore(ctx context.Context, uid string, actor *Actor) error {
	body := map[string]any{}
	if actor != nil {
		body["actor"] = actor
	}
	_, err := c.call(ctx, http.MethodPost, "/api/workflows/definitions/"+url.PathEscape(uid)+"/restore", nil, nil, body, nil)
	return err
}

// Board reads a definition's columns and live cards.
func (c *Client) Board(ctx context.Context, uid, stage, owner, search string) (Board, error) {
	q := url.Values{}
	for k, v := range map[string]string{"stage": stage, "owner": owner, "q": search} {
		if v != "" {
			q.Set(k, v)
		}
	}
	var out Board
	_, err := c.call(ctx, http.MethodGet, "/api/workflows/definitions/"+url.PathEscape(uid)+"/board", q, nil, nil, &out)
	return out, err
}

/* ── runs ── */

// StartRun starts one. A live run for the subject is a 409 run_already_live
// whose Detail names run_uid. Replayed says this key had started it already.
func (c *Client) StartRun(ctx context.Context, in StartRun, idempotencyKey string) (Run, Result, error) {
	var out Run
	res, err := c.call(ctx, http.MethodPost, "/api/workflows/runs", nil, idem(idempotencyKey), in, &out)
	return out, res, err
}

// ListRuns lists runs, a page at a time.
func (c *Client) ListRuns(ctx context.Context, f RunFilter) ([]RunSummary, Page, error) {
	q := url.Values{"tenant": {f.Tenant}}
	for k, v := range map[string]string{"kind": f.Kind, "definition": f.Definition, "state": f.State,
		"subject_type": f.SubjectType, "subject_pid": f.SubjectPID, "cursor": f.Cursor} {
		if v != "" {
			q.Set(k, v)
		}
	}
	if f.Limit > 0 {
		q.Set("limit", strconv.Itoa(f.Limit))
	}
	var out struct {
		Runs []RunSummary `json:"runs"`
		Page
	}
	_, err := c.call(ctx, http.MethodGet, "/api/workflows/runs", q, nil, nil, &out)
	return out.Runs, out.Page, err
}

// GetRun reads one run with its steps, stage and pending jobs.
func (c *Client) GetRun(ctx context.Context, uid string) (Run, error) {
	var out Run
	_, err := c.call(ctx, http.MethodGet, "/api/workflows/runs/"+url.PathEscape(uid), nil, nil, nil, &out)
	return out, err
}

// Timeline reads a run's entries and deliveries, newest first. kinds narrows
// the entries; nil is everything.
func (c *Client) Timeline(ctx context.Context, uid string, kinds []string, limit int) (Timeline, error) {
	q := url.Values{}
	if len(kinds) > 0 {
		q.Set("kinds", strings.Join(kinds, ","))
	}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	var out Timeline
	_, err := c.call(ctx, http.MethodGet, "/api/workflows/runs/"+url.PathEscape(uid)+"/timeline", q, nil, nil, &out)
	return out, err
}

func (c *Client) runAction(ctx context.Context, uid, verb string, body map[string]any, actor *Actor, into any) error {
	if body == nil {
		body = map[string]any{}
	}
	if actor != nil {
		body["actor"] = actor
	}
	_, err := c.call(ctx, http.MethodPost, "/api/workflows/runs/"+url.PathEscape(uid)+"/"+verb, nil, nil, body, into)
	return err
}

// Cancel stops a run for good. outcome, when given, is how it ended
// (withdrawn, for an approval).
func (c *Client) Cancel(ctx context.Context, uid string, actor *Actor, reason, outcome string) (Run, error) {
	var out Run
	body := map[string]any{}
	if reason != "" {
		body["reason"] = reason
	}
	if outcome != "" {
		body["outcome"] = outcome
	}
	return out, c.runAction(ctx, uid, "cancel", body, actor, &out)
}

// Pause stops a running run until somebody resumes it.
func (c *Client) Pause(ctx context.Context, uid string, actor *Actor) (Run, error) {
	var out Run
	return out, c.runAction(ctx, uid, "pause", nil, actor, &out)
}

// Resume puts a paused run back in motion. A run paused because the person
// refused mail is 403 unless force is given with a reason.
func (c *Client) Resume(ctx context.Context, uid string, actor *Actor, force bool, reason string) (Run, error) {
	var out Run
	body := map[string]any{}
	if force {
		body["force"] = true
		body["reason"] = reason
	}
	return out, c.runAction(ctx, uid, "resume", body, actor, &out)
}

// Snooze pauses a run until a time; the wake is booked.
func (c *Client) Snooze(ctx context.Context, uid string, actor *Actor, until time.Time) (Run, error) {
	var out Run
	return out, c.runAction(ctx, uid, "snooze", map[string]any{"until": until.UTC()}, actor, &out)
}

// Move puts a run into a stage by its code.
func (c *Client) Move(ctx context.Context, uid, stage string, actor *Actor) (Run, error) {
	var out Run
	return out, c.runAction(ctx, uid, "move", map[string]any{"stage": stage}, actor, &out)
}

// Migrate moves a run onto another version (0 = current). dryRun answers
// what would happen and writes nothing.
func (c *Client) Migrate(ctx context.Context, uid string, to int, dryRun bool, actor *Actor) (Migration, error) {
	var out Migration
	body := map[string]any{"dry_run": dryRun}
	if to > 0 {
		body["to"] = to
	}
	return out, c.runAction(ctx, uid, "migrate", body, actor, &out)
}

// Transfer moves a person into another definition (uid or code), optionally
// at a stage.
func (c *Client) Transfer(ctx context.Context, uid, definition, stage string, actor *Actor) (Transferred, error) {
	var out Transferred
	body := map[string]any{"definition": definition}
	if stage != "" {
		body["stage"] = stage
	}
	return out, c.runAction(ctx, uid, "transfer", body, actor, &out)
}

// Note writes a note on a run's timeline.
func (c *Client) Note(ctx context.Context, uid, body string, actor *Actor) (Entry, error) {
	var out Entry
	return out, c.runAction(ctx, uid, "notes", map[string]any{"body": body}, actor, &out)
}

// PatchRun refreshes a run's subject label and link, and merges vars. Either
// may be empty.
func (c *Client) PatchRun(ctx context.Context, uid, label, link string, vars map[string]any, actor *Actor) (Run, error) {
	body := map[string]any{}
	if label != "" || link != "" {
		sub := map[string]string{}
		if label != "" {
			sub["label"] = label
		}
		if link != "" {
			sub["url"] = link
		}
		body["subject"] = sub
	}
	if len(vars) > 0 {
		body["vars"] = vars
	}
	if actor != nil {
		body["actor"] = actor
	}
	var out Run
	_, err := c.call(ctx, http.MethodPatch, "/api/workflows/runs/"+url.PathEscape(uid), nil, nil, body, &out)
	return out, err
}

// MigrateRuns moves every open run of one version onto another (0 = current),
// one at a time; dryRun first.
func (c *Client) MigrateRuns(ctx context.Context, definition string, from, to int, dryRun bool, idempotencyKey string, actor *Actor) (BulkMigration, error) {
	body := map[string]any{"definition": definition, "from": from, "dry_run": dryRun}
	if to > 0 {
		body["to"] = to
	}
	if actor != nil {
		body["actor"] = actor
	}
	var headers map[string]string
	if !dryRun {
		headers = idem(idempotencyKey)
	}
	var out BulkMigration
	_, err := c.call(ctx, http.MethodPost, "/api/workflows/runs/migrate", nil, headers, body, &out)
	return out, err
}

/* ── events ── */

// PostEvent posts one event. A redelivery is accepted, with Duplicate set.
func (c *Client) PostEvent(ctx context.Context, ev Event) (EventResult, error) {
	var out EventResult
	_, err := c.call(ctx, http.MethodPost, "/api/workflows/events", nil, nil, ev, &out)
	return out, err
}

// PostEvents posts up to 500 events, with a result per event: a refused one
// carries its Status and Code, and the batch itself is not an error.
func (c *Client) PostEvents(ctx context.Context, events []Event) ([]EventResult, error) {
	var out struct {
		Results []EventResult `json:"results"`
	}
	_, err := c.call(ctx, http.MethodPost, "/api/workflows/events/batch", nil, nil, map[string]any{"events": events}, &out)
	return out.Results, err
}

/* ── deliveries and settings ── */

// CompleteDelivery finishes work this app accepted with 202. done=false is a
// refusal, with its sentence.
func (c *Client) CompleteDelivery(ctx context.Context, deliveryUID string, done bool, output map[string]any, refusal string) error {
	body := map[string]any{"status": "done"}
	if !done {
		body["status"] = "refused"
		body["refusal"] = refusal
	} else if len(output) > 0 {
		body["output"] = output
	}
	_, err := c.call(ctx, http.MethodPost, "/api/workflows/deliveries/"+url.PathEscape(deliveryUID)+"/complete", nil, nil, body, nil)
	return err
}

// PutSettings writes an organisation's calendar.
func (c *Client) PutSettings(ctx context.Context, s Settings) error {
	_, err := c.call(ctx, http.MethodPut, "/api/workflows/settings", nil, nil, s, nil)
	return err
}
