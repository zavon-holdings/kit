package wfclient

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Every method's path, verb, headers and body shape, pinned against a fake
// workflow service that records the request and answers what the test says.
// A mismatch with the real service is a wire change and a kit major.

type seen struct {
	method, path, query, body string
	headers                   http.Header
}

type fakeCore struct {
	t      *testing.T
	status int
	answer string
	header http.Header
	last   seen
}

func newFakeCore(t *testing.T) (*fakeCore, *Client) {
	f := &fakeCore{t: t, status: 200, answer: `{}`, header: http.Header{}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		f.last = seen{method: r.Method, path: r.URL.Path, query: r.URL.RawQuery, body: string(raw), headers: r.Header.Clone()}
		for k, v := range f.header {
			w.Header()[k] = v
		}
		w.WriteHeader(f.status)
		_, _ = w.Write([]byte(f.answer))
	}))
	t.Cleanup(srv.Close)
	return f, New(srv.URL+"/", "tok_k.s")
}

func (f *fakeCore) expect(method, path string) {
	f.t.Helper()
	if f.last.method != method || f.last.path != path {
		f.t.Fatalf("called %s %s, want %s %s", f.last.method, f.last.path, method, path)
	}
	if f.last.headers.Get("Authorization") != "Bearer tok_k.s" {
		f.t.Errorf("Authorization = %q", f.last.headers.Get("Authorization"))
	}
	if f.last.headers.Get("Zavon-Workflow-Version") != "1" {
		f.t.Errorf("Zavon-Workflow-Version = %q", f.last.headers.Get("Zavon-Workflow-Version"))
	}
}

func (f *fakeCore) bodyField(key string) any {
	var m map[string]any
	_ = json.Unmarshal([]byte(f.last.body), &m)
	return m[key]
}

func TestEveryCallHasItsPathVerbAndBody(t *testing.T) {
	ctx := context.Background()
	f, c := newFakeCore(t)
	actor := &Actor{Email: "cara@example.test"}

	f.answer = `{"changed":true}`
	if ch, err := c.PutManifest(ctx, Manifest{Namespace: "acme", Version: "1", BaseURL: "https://acme.test/api/workflow"}); err != nil || !ch {
		t.Fatal(ch, err)
	}
	f.expect("PUT", "/api/workflows/manifest")
	if f.bodyField("namespace") != "acme" {
		t.Errorf("body %s", f.last.body)
	}

	f.answer = `{"manifest":null,"callback_secret_set":true}`
	if st, err := c.GetManifest(ctx); err != nil || !st.CallbackSecretSet {
		t.Fatal(st, err)
	}
	f.expect("GET", "/api/workflows/manifest")

	f.answer = `{"secret":"zwh_x","previous_valid_until":"2026-10-01T09:00:00Z","note":"n"}`
	if s, err := c.RotateCallbackSecret(ctx); err != nil || s.Secret != "zwh_x" {
		t.Fatal(s, err)
	}
	f.expect("POST", "/api/workflows/callback-secret/rotate")

	f.answer = `{"events":[{"type":"orders.order.paid","producer":"shop","shareable":true}]}`
	if ev, err := c.Catalogue(ctx, "org-a"); err != nil || len(ev) != 1 || ev[0].Type != "orders.order.paid" {
		t.Fatal(ev, err)
	}
	f.expect("GET", "/api/workflows/catalogue")
	if !strings.Contains(f.last.query, "tenant=org-a") {
		t.Errorf("query %q", f.last.query)
	}

	f.answer = `{"definitions":[{"uid":"d1","code":"c","etag":"\"v1-abc\""}],"next_cursor":"MTA"}`
	defs, page, err := c.ListDefinitions(ctx, DefinitionFilter{Tenant: "org-a", Kind: "approval", IncludeTemplates: true, Cursor: "MQ", Limit: 10})
	if err != nil || len(defs) != 1 || page.NextCursor != "MTA" {
		t.Fatal(defs, page, err)
	}
	f.expect("GET", "/api/workflows/definitions")
	for _, want := range []string{"tenant=org-a", "kind=approval", "include_templates=true", "cursor=MQ", "limit=10"} {
		if !strings.Contains(f.last.query, want) {
			t.Errorf("query %q lacks %s", f.last.query, want)
		}
	}

	f.status, f.answer = 201, `{"uid":"d1","etag":"\"v1-abc\""}`
	f.header.Set("ETag", `"v1-abc"`)
	def, res, err := c.CreateDefinition(ctx, DefinitionInput{Tenant: "org-a", Code: "c", Name: "C", Actor: actor}, "create-c")
	if err != nil || def.UID != "d1" || res.Status != 201 || res.Replayed || res.ETag != `"v1-abc"` {
		t.Fatal(def, res, err)
	}
	f.expect("POST", "/api/workflows/definitions")
	if f.last.headers.Get("Idempotency-Key") != "create-c" || f.bodyField("tenant") != "org-a" {
		t.Errorf("headers %v body %s", f.last.headers, f.last.body)
	}
	f.status = 200
	f.header = http.Header{}

	f.header.Set("ETag", `"v1-abc"`)
	f.answer = `{"uid":"d1","code":"c"}`
	if d, err := c.GetDefinition(ctx, "d1"); err != nil || d.ETag != `"v1-abc"` {
		t.Fatal(d, err)
	}
	f.expect("GET", "/api/workflows/definitions/d1")
	f.header = http.Header{}

	f.answer = `{"version":1,"steps":[{"code":"a"}]}`
	if steps, err := c.GetDefinitionVersion(ctx, "d1", 1); err != nil || len(steps) != 1 {
		t.Fatal(steps, err)
	}
	f.expect("GET", "/api/workflows/definitions/d1/versions/1")

	f.answer = `{"definition":{"uid":"d1"},"version":2,"versioned":true,"live_on_previous":{"v1":3}}`
	saved, err := c.SaveDefinition(ctx, "d1", DefinitionInput{Tenant: "org-a", Code: "c", Name: "C"}, `"v1-abc"`)
	if err != nil || !saved.Versioned || saved.LiveOnPrevious["v1"] != 3 {
		t.Fatal(saved, err)
	}
	f.expect("PUT", "/api/workflows/definitions/d1")
	if f.last.headers.Get("If-Match") != `"v1-abc"` {
		t.Errorf("If-Match = %q", f.last.headers.Get("If-Match"))
	}

	f.answer = `{"problems":[{"code":"unknown_action","message":"x"}]}`
	if p, err := c.Validate(ctx, "d1", nil); err != nil || len(p) != 1 {
		t.Fatal(p, err)
	}
	f.expect("POST", "/api/workflows/definitions/d1/validate")
	if f.last.body != "{}" {
		t.Errorf("an empty validate sends %q", f.last.body)
	}

	f.answer = `{"archived":true}`
	if err := c.Archive(ctx, "d1", true, "done with it", actor); err != nil {
		t.Fatal(err)
	}
	f.expect("POST", "/api/workflows/definitions/d1/archive")
	if f.bodyField("cancel_runs") != true || f.bodyField("reason") != "done with it" {
		t.Errorf("body %s", f.last.body)
	}
	if err := c.Restore(ctx, "d1", nil); err != nil {
		t.Fatal(err)
	}
	f.expect("POST", "/api/workflows/definitions/d1/restore")

	f.answer = `{"columns":[{"code":"a","name":"A","sends":false}],"cards":[],"finished":2}`
	if b, err := c.Board(ctx, "d1", "a", "", "launch"); err != nil || b.Finished != 2 || len(b.Columns) != 1 {
		t.Fatal(b, err)
	}
	f.expect("GET", "/api/workflows/definitions/d1/board")
	if !strings.Contains(f.last.query, "stage=a") || !strings.Contains(f.last.query, "q=launch") {
		t.Errorf("query %q", f.last.query)
	}

	f.status, f.answer = 201, `{"uid":"r1","state":"open","steps":[],"pending_jobs":[],"tasks":[],"vars":{}}`
	run, res, err := c.StartRun(ctx, StartRun{Tenant: "org-a", Definition: "c", Subject: SubjectRef{Property: "acme", Type: "page", PID: "p1"}}, "review:1")
	if err != nil || run.UID != "r1" || res.Replayed {
		t.Fatal(run, res, err)
	}
	f.expect("POST", "/api/workflows/runs")
	if f.last.headers.Get("Idempotency-Key") != "review:1" {
		t.Errorf("key %q", f.last.headers.Get("Idempotency-Key"))
	}
	if sub, _ := f.bodyField("subject").(map[string]any); sub["pid"] != "p1" {
		t.Errorf("body %s", f.last.body)
	}
	f.status = 200

	f.answer = `{"runs":[{"uid":"r1"}],"next_cursor":""}`
	runs, page, err := c.ListRuns(ctx, RunFilter{Tenant: "org-a", State: "open", SubjectType: "page", SubjectPID: "p1"})
	if err != nil || len(runs) != 1 || page.NextCursor != "" {
		t.Fatal(runs, page, err)
	}
	f.expect("GET", "/api/workflows/runs")
	for _, want := range []string{"tenant=org-a", "state=open", "subject_type=page", "subject_pid=p1"} {
		if !strings.Contains(f.last.query, want) {
			t.Errorf("query %q lacks %s", f.last.query, want)
		}
	}

	f.answer = `{"uid":"r1","stage":"a","steps":[{"code":"a","status":"in_progress"}],"pending_jobs":[],"tasks":[],"vars":{"k":1}}`
	if r, err := c.GetRun(ctx, "r1"); err != nil || r.Stage != "a" || r.Vars["k"] != float64(1) {
		t.Fatal(r, err)
	}
	f.expect("GET", "/api/workflows/runs/r1")

	f.answer = `{"entries":[{"uid":"e1","kind":"note","title":"t"}],"deliveries":[]}`
	if tl, err := c.Timeline(ctx, "r1", []string{"note", "email"}, 20); err != nil || len(tl.Entries) != 1 {
		t.Fatal(tl, err)
	}
	f.expect("GET", "/api/workflows/runs/r1/timeline")
	if !strings.Contains(f.last.query, "kinds=note%2Cemail") || !strings.Contains(f.last.query, "limit=20") {
		t.Errorf("query %q", f.last.query)
	}

	runOut := `{"uid":"r1","state":"paused","steps":[],"pending_jobs":[],"tasks":[],"vars":{}}`
	f.answer = runOut
	if _, err := c.Cancel(ctx, "r1", actor, "no longer needed", "withdrawn"); err != nil {
		t.Fatal(err)
	}
	f.expect("POST", "/api/workflows/runs/r1/cancel")
	if f.bodyField("outcome") != "withdrawn" || f.bodyField("actor") == nil {
		t.Errorf("body %s", f.last.body)
	}
	if _, err := c.Pause(ctx, "r1", actor); err != nil {
		t.Fatal(err)
	}
	f.expect("POST", "/api/workflows/runs/r1/pause")
	if _, err := c.Resume(ctx, "r1", actor, true, "they asked"); err != nil {
		t.Fatal(err)
	}
	f.expect("POST", "/api/workflows/runs/r1/resume")
	if f.bodyField("force") != true || f.bodyField("reason") != "they asked" {
		t.Errorf("body %s", f.last.body)
	}
	until := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	if _, err := c.Snooze(ctx, "r1", actor, until); err != nil {
		t.Fatal(err)
	}
	f.expect("POST", "/api/workflows/runs/r1/snooze")
	if f.bodyField("until") != "2026-10-01T09:00:00Z" {
		t.Errorf("body %s", f.last.body)
	}
	if _, err := c.Move(ctx, "r1", "booked", actor); err != nil {
		t.Fatal(err)
	}
	f.expect("POST", "/api/workflows/runs/r1/move")
	if f.bodyField("stage") != "booked" {
		t.Errorf("body %s", f.last.body)
	}

	f.answer = `{"dry_run":true,"from_version":1,"to_version":2,"kept":["a"],"new":[{"code":"b","name":"B","kind":"form"}],"left_behind":[],"now_at":"b","says":"Moved"}`
	if m, err := c.Migrate(ctx, "r1", 2, true, actor); err != nil || !m.DryRun || len(m.New) != 1 || m.New[0].Kind != "form" {
		t.Fatal(m, err)
	}
	f.expect("POST", "/api/workflows/runs/r1/migrate")
	if f.bodyField("dry_run") != true || f.bodyField("to") != float64(2) {
		t.Errorf("body %s", f.last.body)
	}

	f.answer = `{"from":"r1","to":"r2","stage":"placed","sends":true}`
	if tr, err := c.Transfer(ctx, "r1", "volunteers", "placed", actor); err != nil || tr.To != "r2" || !tr.Sends {
		t.Fatal(tr, err)
	}
	f.expect("POST", "/api/workflows/runs/r1/transfer")
	if f.bodyField("definition") != "volunteers" || f.bodyField("stage") != "placed" {
		t.Errorf("body %s", f.last.body)
	}

	f.status, f.answer = 201, `{"uid":"e1","kind":"note","body":"hi","title":""}`
	if e, err := c.Note(ctx, "r1", "hi", actor); err != nil || e.Body != "hi" {
		t.Fatal(e, err)
	}
	f.expect("POST", "/api/workflows/runs/r1/notes")
	f.status = 200

	f.answer = runOut
	if _, err := c.PatchRun(ctx, "r1", "Launch", "https://acme.test/p", map[string]any{"scope": "site"}, actor); err != nil {
		t.Fatal(err)
	}
	f.expect("PATCH", "/api/workflows/runs/r1")
	if sub, _ := f.bodyField("subject").(map[string]any); sub["label"] != "Launch" || sub["url"] != "https://acme.test/p" {
		t.Errorf("body %s", f.last.body)
	}
	if vars, _ := f.bodyField("vars").(map[string]any); vars["scope"] != "site" {
		t.Errorf("body %s", f.last.body)
	}

	f.answer = `{"dry_run":false,"migrated":2,"results":[]}`
	if bm, err := c.MigrateRuns(ctx, "d1", 1, 2, false, "mig-1", actor); err != nil || bm.Migrated != 2 {
		t.Fatal(bm, err)
	}
	f.expect("POST", "/api/workflows/runs/migrate")
	if f.last.headers.Get("Idempotency-Key") != "mig-1" || f.bodyField("from") != float64(1) {
		t.Errorf("headers %v body %s", f.last.headers, f.last.body)
	}
	if _, err := c.MigrateRuns(ctx, "d1", 1, 0, true, "", actor); err != nil {
		t.Fatal(err)
	}
	if f.last.headers.Get("Idempotency-Key") != "" {
		t.Error("a dry run carried an Idempotency-Key; the workflow service does not want one")
	}

	f.status, f.answer = 202, `{"event_uid":"ev1","matched":1,"advanced":false,"duplicate":false}`
	occurred := time.Date(2026, 9, 30, 10, 0, 0, 0, time.UTC)
	ev, err := c.PostEvent(ctx, Event{Type: "acme.thing.done", Ref: "t1", Tenant: "org-a", OccurredAt: &occurred,
		Subject: &SubjectRef{Property: "acme", Type: "thing", PID: "t1"}, Vars: map[string]any{"n": 1}})
	if err != nil || ev.Matched != 1 || ev.EventUID != "ev1" {
		t.Fatal(ev, err)
	}
	f.expect("POST", "/api/workflows/events")
	if f.bodyField("ref") != "t1" || f.bodyField("occurred_at") != "2026-09-30T10:00:00Z" || f.bodyField("subject") == nil {
		t.Errorf("body %s", f.last.body)
	}
	f.status = 200

	f.answer = `{"results":[{"index":0,"status":202,"event_uid":"a"},{"index":1,"status":403,"error":"no","code":"namespace"}]}`
	results, err := c.PostEvents(ctx, []Event{{Type: "acme.a", Ref: "1", Tenant: "org-a"}, {Type: "orders.b", Ref: "2", Tenant: "org-a"}})
	if err != nil || len(results) != 2 || results[1].Status != 403 || results[1].Code != "namespace" {
		t.Fatal(results, err)
	}
	f.expect("POST", "/api/workflows/events/batch")

	f.answer = `{"completed":true}`
	if err := c.CompleteDelivery(ctx, "dv1", true, map[string]any{"published_at": "x"}, ""); err != nil {
		t.Fatal(err)
	}
	f.expect("POST", "/api/workflows/deliveries/dv1/complete")
	if f.bodyField("status") != "done" || f.bodyField("output") == nil {
		t.Errorf("body %s", f.last.body)
	}
	if err := c.CompleteDelivery(ctx, "dv1", false, nil, "The page was deleted."); err != nil {
		t.Fatal(err)
	}
	if f.bodyField("status") != "refused" || f.bodyField("refusal") != "The page was deleted." {
		t.Errorf("body %s", f.last.body)
	}

	f.answer = `{"tenant":"org-a"}`
	if err := c.PutSettings(ctx, Settings{Tenant: "org-a", Timezone: "Africa/Johannesburg", Workweek: []int{1, 2, 3, 4, 5}}); err != nil {
		t.Fatal(err)
	}
	f.expect("PUT", "/api/workflows/settings")
	if f.bodyField("timezone") != "Africa/Johannesburg" {
		t.Errorf("body %s", f.last.body)
	}
}

func TestAReplayIsReportedNotHidden(t *testing.T) {
	f, c := newFakeCore(t)
	f.header.Set("Idempotent-Replay", "true")
	f.answer = `{"uid":"r1","steps":[],"pending_jobs":[],"tasks":[],"vars":{}}`
	run, res, err := c.StartRun(context.Background(), StartRun{Tenant: "org-a", Definition: "c", Subject: SubjectRef{Property: "a", Type: "t", PID: "p"}}, "k")
	if err != nil || run.UID != "r1" || !res.Replayed || res.Status != 200 {
		t.Fatalf("run %v res %+v err %v", run, res, err)
	}
}

func TestErrorsCarryCoresCodeAndTellUnavailableFromRefused(t *testing.T) {
	f, c := newFakeCore(t)
	ctx := context.Background()
	f.status, f.answer = 409, `{"error":"That subject already has a live run.","code":"run_already_live","detail":{"run_uid":"r9"}}`
	_, _, err := c.StartRun(ctx, StartRun{Tenant: "t", Definition: "c", Subject: SubjectRef{Property: "a", Type: "t", PID: "p"}}, "k")
	var e *Error
	if !errors.As(err, &e) || e.Status != 409 || e.Code != "run_already_live" || Code(err) != "run_already_live" {
		t.Fatalf("err = %v", err)
	}
	var detail struct {
		RunUID string `json:"run_uid"`
	}
	if json.Unmarshal(e.Detail, &detail) != nil || detail.RunUID != "r9" {
		t.Fatalf("detail = %s", e.Detail)
	}
	if IsUnavailable(err) {
		t.Fatal("a decided 409 read as unavailable")
	}

	f.status, f.answer = 412, `{"error":"stale","code":"stale_definition","detail":{"etag":"\"v2-def\""}}`
	f.header.Set("ETag", `"v2-def"`)
	_, err = c.SaveDefinition(ctx, "d1", DefinitionInput{}, `"v1-abc"`)
	var stale *Error
	if Code(err) != "stale_definition" || !errors.As(err, &stale) || !strings.Contains(string(stale.Detail), "v2-def") {
		t.Fatalf("stale save = %v", err)
	}
	f.header = http.Header{}

	f.status, f.answer = 503, `{"error":"The workflow store did not answer.","code":"unavailable","detail":{"reason":"dial tcp: connection refused"}}`
	if _, err := c.GetRun(ctx, "r1"); !IsUnavailable(err) || Code(err) != "unavailable" || IsUnconfigured(err) {
		t.Fatalf("a 503 = %v", err)
	}
	// Off for want of configuration is its own code: still unavailable
	// (nobody should retry into it), and unconfigured, which a screen renders
	// as a state. A reason rides on BOTH 503s, so the code is what tells.
	f.status, f.answer = 503, `{"error":"workflows unconfigured","code":"unconfigured","detail":{"reason":"the wf_* tables are not applied yet (run sync-secrets with redeploy=true)"}}`
	if _, err := c.GetRun(ctx, "r1"); !IsUnavailable(err) || !IsUnconfigured(err) || Code(err) != "unconfigured" {
		t.Fatalf("an unconfigured 503 = %v", err)
	}
	if IsUnconfigured(errors.New("plain")) || IsUnconfigured(nil) {
		t.Fatal("an error with no code read as unconfigured")
	}
	f.status, f.answer = 502, `bad gateway`
	if _, err := c.GetRun(ctx, "r1"); !IsUnavailable(err) || !strings.Contains(err.Error(), "bad gateway") {
		t.Fatalf("a 502 with no JSON = %v", err)
	}

	// The workflow service not answering at all is unavailable too, and distinct from a code.
	down := New("http://127.0.0.1:1", "tok_k.s", WithHTTPClient(&http.Client{Timeout: time.Second}))
	if _, err := down.GetRun(ctx, "r1"); !IsUnavailable(err) || !errors.Is(err, ErrUnreachable) {
		t.Fatalf("unreachable = %v", err)
	}
	// And an unconfigured client refuses to pretend.
	if _, err := New("", "").GetRun(ctx, "r1"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("unconfigured = %v", err)
	}
}

func TestAnOperatorCredentialNamesItsProperty(t *testing.T) {
	f, base := newFakeCore(t)
	c := New(base.base, "operator-token", WithProperty("site-a"))
	f.answer = `{"manifest":null,"callback_secret_set":false}`
	if _, err := c.GetManifest(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(f.last.query, "property=site-a") {
		t.Fatalf("query %q", f.last.query)
	}
	// A property token names nothing: the workflow service reads the property off the token.
	f.last = seen{}
	if _, err := base.GetManifest(context.Background()); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(f.last.query, "property=") {
		t.Fatalf("query %q", f.last.query)
	}
}
