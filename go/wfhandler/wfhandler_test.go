package wfhandler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/zavon-holdings/kit/go/webhooksig"
)

var (
	secrets = []string{"door-secret"}
	clock   = time.Unix(1790000000, 0).UTC()
)

// memStore is a ReplayStore in a map; the SQL one is exercised below with a
// fake Querier.
type memStore struct {
	mu   sync.Mutex
	rows map[string]Stored
	fail error
}

func (m *memStore) Get(_ context.Context, key string) (*Stored, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fail != nil {
		return nil, m.fail
	}
	if s, ok := m.rows[key]; ok {
		return &s, nil
	}
	return nil, nil
}

func (m *memStore) Put(_ context.Context, key string, s Stored) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rows == nil {
		m.rows = map[string]Stored{}
	}
	m.rows[key] = s
	return nil
}

type rig struct {
	t     *testing.T
	srv   *httptest.Server
	calls int
	store *memStore
}

func newRig(t *testing.T, h Handlers, secs []string) *rig {
	r := &rig{t: t, store: &memStore{}}
	counted := Handlers{}
	for name, fn := range h {
		fn := fn
		counted[name] = func(ctx context.Context, c Call) (Answer, error) {
			r.calls++
			return fn(ctx, c)
		}
	}
	mux := http.NewServeMux()
	Mount(mux, "/api/workflow/", secs, counted, r.store, Options{Now: func() time.Time { return clock }})
	r.srv = httptest.NewServer(mux)
	t.Cleanup(r.srv.Close)
	return r
}

// post sends a signed call the way core does.
func (r *rig) post(path, body, key string, sign []string) (int, map[string]any) {
	r.t.Helper()
	req, _ := http.NewRequest("POST", r.srv.URL+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Zavon-Workflow-Version", "1")
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	if sign != nil {
		webhooksig.SignRequest(req, sign, []byte(body), clock)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		r.t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

const publishCall = `{"action":"pages.publish","delivery":"dv1","tenant":"shofar","run":{"uid":"r1","definition":"page-review","version":2,"kind":"approval","tenant":"shofar","property":"pages-by-zavon"},"step":{"code":"publish","kind":"action"},"subject":{"property":"pages-by-zavon","type":"page","pid":"p1","label":"Easter"},"input":{"scope":"site"},"vars":{},"attempt":1}`

func handlers() Handlers {
	return Handlers{
		"pages.publish": func(_ context.Context, c Call) (Answer, error) {
			if c.Subject.PID == "gone" {
				return Answer{Refusal: "The page was deleted.", Status: 410}, nil
			}
			if c.Subject.PID == "slow" {
				return Accepted(), nil
			}
			if c.Subject.PID == "broken" {
				return Answer{}, errors.New("the database went away")
			}
			return Done(map[string]any{"published_at": "2026-09-30T10:00:00Z", "key": c.IdempotencyKey}), nil
		},
		"pages.resolve_recipient": func(context.Context, Call) (Answer, error) {
			return Done(map[string]any{"email": "nomsa@example.test", "name": "Nomsa"}), nil
		},
		"pages.notify": func(_ context.Context, c Call) (Answer, error) {
			if c.Input["event"] != "finished" {
				return Refuse("only finished is heard"), nil
			}
			return Done(nil), nil
		},
	}
}

func TestTheDoorIsClosedWithoutASecret(t *testing.T) {
	r := newRig(t, handlers(), []string{"", "  "})
	status, body := r.post("/api/workflow/actions", publishCall, "k1", secrets)
	if status != 503 || body["error"] == nil {
		t.Fatalf("%d %v: an unset secret must fail closed, not open", status, body)
	}
	if r.calls != 0 {
		t.Fatal("the handler ran with no secret")
	}
}

func TestTheSignatureIsCheckedBeforeAnythingElse(t *testing.T) {
	r := newRig(t, handlers(), secrets)
	if status, _ := r.post("/api/workflow/actions", publishCall, "k1", []string{"wrong"}); status != 403 {
		t.Fatalf("a wrong secret answered %d, want 403", status)
	}
	if status, _ := r.post("/api/workflow/actions", publishCall, "k1", nil); status != 401 {
		t.Fatalf("an unsigned request answered %d, want 401", status)
	}
	// A body edited in flight fails the signature, not the JSON parse.
	req, _ := http.NewRequest("POST", r.srv.URL+"/api/workflow/actions", strings.NewReader(publishCall+" "))
	req.Header.Set("Idempotency-Key", "k1")
	webhooksig.SignRequest(req, secrets, []byte(publishCall), clock)
	resp, _ := http.DefaultClient.Do(req)
	if resp.StatusCode != 403 {
		t.Fatalf("a tampered body answered %d", resp.StatusCode)
	}
	if r.calls != 0 {
		t.Fatal("a handler ran for an unverified request")
	}
	// An old timestamp is refused too (the clock is the option's).
	req, _ = http.NewRequest("POST", r.srv.URL+"/api/workflow/actions", strings.NewReader(publishCall))
	req.Header.Set("Idempotency-Key", "k1")
	webhooksig.SignRequest(req, secrets, []byte(publishCall), clock.Add(-time.Hour))
	resp, _ = http.DefaultClient.Do(req)
	if resp.StatusCode != 401 {
		t.Fatalf("an hour-old signature answered %d", resp.StatusCode)
	}
	// The previous secret still works during a rotation.
	both := []string{"new-secret", "door-secret"}
	r2 := newRig(t, handlers(), both)
	if status, _ := r2.post("/api/workflow/actions", publishCall, "k1", []string{"door-secret"}); status != 200 {
		t.Fatalf("the previous secret answered %d during rotation", status)
	}
}

func TestAnIdempotencyKeyIsRequiredAndReplayed(t *testing.T) {
	r := newRig(t, handlers(), secrets)
	if status, body := r.post("/api/workflow/actions", publishCall, "", secrets); status != 400 || !strings.Contains(fmt.Sprint(body["error"]), "Idempotency-Key") {
		t.Fatalf("no key: %d %v", status, body)
	}
	status, body := r.post("/api/workflow/actions", publishCall, "run:r1:step:publish", secrets)
	if status != 200 || body["status"] != "done" {
		t.Fatalf("first: %d %v", status, body)
	}
	out := body["output"].(map[string]any)
	if out["key"] != "run:r1:step:publish" || out["published_at"] == nil {
		t.Fatalf("output %v", out)
	}
	// Same key again, even with a different body: the stored answer, and the
	// handler is not run.
	status2, body2 := r.post("/api/workflow/actions", strings.Replace(publishCall, `"attempt":1`, `"attempt":2`, 1), "run:r1:step:publish", secrets)
	if status2 != 200 || fmt.Sprint(body2) != fmt.Sprint(body) {
		t.Fatalf("replay: %d %v", status2, body2)
	}
	if r.calls != 1 {
		t.Fatalf("the handler ran %d times for one key", r.calls)
	}
	// A different key is a different action.
	if status, _ := r.post("/api/workflow/actions", publishCall, "run:r1:step:publish:2", secrets); status != 200 || r.calls != 2 {
		t.Fatalf("second key: %d, calls %d", status, r.calls)
	}
	// A key the store can't read is a 503, not a rerun.
	r.store.fail = errors.New("db down")
	if status, _ := r.post("/api/workflow/actions", publishCall, "k9", secrets); status != 503 || r.calls != 2 {
		t.Fatalf("unreadable history: %d, calls %d", status, r.calls)
	}
}

func TestEachAnswerHasItsShape(t *testing.T) {
	r := newRig(t, handlers(), secrets)
	with := func(pid string) string { return strings.Replace(publishCall, `"pid":"p1"`, `"pid":"`+pid+`"`, 1) }

	status, body := r.post("/api/workflow/actions", with("slow"), "k-async", secrets)
	if status != 202 || body["status"] != "accepted" || body["output"] != nil {
		t.Fatalf("accepted: %d %v", status, body)
	}
	status, body = r.post("/api/workflow/actions", with("gone"), "k-gone", secrets)
	if status != 410 || body["refusal"] != "The page was deleted." {
		t.Fatalf("refused with a chosen status: %d %v", status, body)
	}
	// A refusal with a status core would retry is corrected to 422.
	r3 := newRig(t, Handlers{"pages.publish": func(context.Context, Call) (Answer, error) {
		return Answer{Refusal: "no", Status: 500}, nil
	}}, secrets)
	if status, body := r3.post("/api/workflow/actions", publishCall, "k", secrets); status != 422 || body["refusal"] != "no" {
		t.Fatalf("a refusal with a 5xx: %d %v", status, body)
	}
	status, body = r.post("/api/workflow/actions", with("broken"), "k-broken", secrets)
	if status != 500 || body["error"] != "the database went away" {
		t.Fatalf("a fault: %d %v", status, body)
	}
	// A fault is not remembered: the retry runs the handler again.
	before := r.calls
	if status, _ := r.post("/api/workflow/actions", with("broken"), "k-broken", secrets); status != 500 || r.calls != before+1 {
		t.Fatalf("a retried fault: %d, calls %d→%d", status, before, r.calls)
	}
	status, body = r.post("/api/workflow/actions", strings.Replace(publishCall, "pages.publish", "pages.unknown", 1), "k-unknown", secrets)
	if status != 404 || !strings.Contains(fmt.Sprint(body["refusal"]), "pages.unknown") {
		t.Fatalf("unknown action: %d %v", status, body)
	}
	if status, body := r.post("/api/workflow/actions", `{"nope":1}`, "k-bad", secrets); status != 400 || body["error"] == nil {
		t.Fatalf("not a call: %d %v", status, body)
	}
	// Hooks arrive at the other path and are served by the same handlers.
	hook := `{"action":"pages.notify","tenant":"shofar","run":{"uid":"r1"},"step":{"code":"","kind":"hook"},"subject":{"property":"pages-by-zavon","type":"page","pid":"p1"},"input":{"event":"finished","state":"done","outcome":"approved"},"attempt":1}`
	if status, body := r.post("/api/workflow/hooks", hook, "run:r1:hook:finished", secrets); status != 200 || body["status"] != "done" || body["output"] != nil {
		t.Fatalf("hook: %d %v", status, body)
	}
	if status, _ := r.post("/api/workflow/other", hook, "k", secrets); status != 404 && status != 405 {
		t.Fatalf("an unmounted path answered %d", status)
	}
}

/* ── the SQL store through a fake Querier ── */

type fakeQ struct {
	rows  map[string]Stored
	execs []string
}

type fakeRow struct {
	s   *Stored
	err error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	*(dest[0].(*string)) = r.s.Action
	*(dest[1].(*int)) = r.s.Status
	*(dest[2].(*string)) = string(r.s.Response)
	return nil
}

func (q *fakeQ) Exec(_ context.Context, sql string, args ...any) (any, error) {
	q.execs = append(q.execs, sql)
	if !strings.Contains(sql, "INSERT INTO workflow_actions") {
		return nil, fmt.Errorf("unexpected SQL %s", sql)
	}
	if _, isString := args[3].(string); !isString {
		return nil, fmt.Errorf("JSONB must be passed as a string under the simple protocol, got %T", args[3])
	}
	key := args[0].(string)
	if _, dup := q.rows[key]; dup {
		return nil, nil // ON CONFLICT DO NOTHING
	}
	if q.rows == nil {
		q.rows = map[string]Stored{}
	}
	q.rows[key] = Stored{Action: args[1].(string), Status: args[2].(int), Response: json.RawMessage(args[3].(string))}
	return nil, nil
}

func (q *fakeQ) QueryRow(_ context.Context, sql string, args ...any) Row {
	if s, ok := q.rows[args[0].(string)]; ok {
		return fakeRow{s: &s}
	}
	return fakeRow{err: errors.New("no rows in result set")}
}

func TestTheSQLStoreKeepsDecisionsNotFaults(t *testing.T) {
	ctx := context.Background()
	q := &fakeQ{}
	s := SQLReplayStore{Q: q}
	if got, err := s.Get(ctx, "k"); err != nil || got != nil {
		t.Fatalf("empty: %v %v", got, err)
	}
	if err := s.Put(ctx, "k", Stored{Action: "pages.publish", Status: 200, Response: json.RawMessage(`{"status":"done"}`)}); err != nil {
		t.Fatal(err)
	}
	got, err := s.Get(ctx, "k")
	if err != nil || got == nil || got.Status != 200 || string(got.Response) != `{"status":"done"}` || got.Action != "pages.publish" {
		t.Fatalf("stored: %+v %v", got, err)
	}
	if err := s.Put(ctx, "k", Stored{Action: "pages.publish", Status: 410, Response: json.RawMessage(`{"refusal":"x"}`)}); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Get(ctx, "k"); got.Status != 200 {
		t.Fatal("a second Put replaced the first answer; the first decision stands")
	}
	if err := s.Put(ctx, "fault", Stored{Status: 500, Response: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Get(ctx, "fault"); got != nil {
		t.Fatal("a 5xx was remembered; core's retry must run the handler again")
	}
	if !strings.Contains(DDL, "workflow_actions") || !strings.Contains(DDL, "idempotency_key TEXT PRIMARY KEY") {
		t.Fatalf("DDL %s", DDL)
	}
}

/* ── contract vectors ── */

// Vector is one case in contract/callback/*.json: the request core sends and
// the answer the app's door gives when its handler decides as `decision`
// says. Consumers replay these against their own doors.
type Vector struct {
	Name     string            `json:"name"`
	Path     string            `json:"path"`
	Secrets  []string          `json:"secrets"`
	Headers  map[string]string `json:"headers"`
	Body     string            `json:"body"`
	Decision string            `json:"decision"` // done | accepted | refused | unknown
	Answer   struct {
		Status int    `json:"status"`
		Body   string `json:"body"`
	} `json:"answer"`
}

func vectorCases() []Vector {
	mk := func(name, path, key, body, decision string) Vector {
		v := Vector{Name: name, Path: path, Secrets: []string{"door-secret"}, Body: body, Decision: decision}
		v.Headers = map[string]string{
			"Content-Type":           "application/json",
			"Idempotency-Key":        key,
			"X-Zavon-Delivery":       "dv-" + name,
			"Zavon-Workflow-Version": "1",
		}
		return v
	}
	return []Vector{
		mk("action-done", "/actions", "run:r1:step:publish", publishCall, "done"),
		mk("action-accepted", "/actions", "run:r1:step:publish", strings.Replace(publishCall, `"pid":"p1"`, `"pid":"slow"`, 1), "accepted"),
		mk("action-refused", "/actions", "run:r1:step:publish", strings.Replace(publishCall, `"pid":"p1"`, `"pid":"gone"`, 1), "refused"),
		mk("action-unknown", "/actions", "run:r1:step:archive", strings.Replace(publishCall, "pages.publish", "pages.archive", 1), "unknown"),
		mk("resolve-recipient", "/actions", "run:r1:step:notify-owner:resolve",
			`{"action":"pages.resolve_recipient","tenant":"shofar","run":{"uid":"r1","definition":"page-review","version":2,"kind":"approval","tenant":"shofar","property":"pages-by-zavon"},"step":{"code":"notify-owner","kind":"email"},"subject":{"property":"pages-by-zavon","type":"page","pid":"p1"},"input":{"role":"owner"},"attempt":1}`, "done"),
		mk("hook-finished", "/hooks", "run:r1:hook:finished",
			`{"action":"pages.notify","tenant":"shofar","run":{"uid":"r1","definition":"page-review","version":2,"kind":"approval","tenant":"shofar","property":"pages-by-zavon"},"step":{"code":"","kind":"hook"},"subject":{"property":"pages-by-zavon","type":"page","pid":"p1"},"input":{"event":"finished","state":"done","outcome":"approved","pause_reason":""},"attempt":1}`, "done"),
	}
}

// deciding is the handler set the vectors are recorded against: the answer
// each decision produces, so the recorded answers are what any door built on
// this package returns for the same call.
func deciding() Handlers {
	h := Handlers{}
	for _, name := range []string{"pages.publish", "pages.resolve_recipient", "pages.notify"} {
		name := name
		h[name] = func(_ context.Context, c Call) (Answer, error) {
			switch {
			case c.Subject.PID == "slow":
				return Accepted(), nil
			case c.Subject.PID == "gone":
				return Answer{Refusal: "The page was deleted.", Status: 410}, nil
			case name == "pages.resolve_recipient":
				return Done(map[string]any{"email": "nomsa@example.test", "name": "Nomsa"}), nil
			case name == "pages.notify":
				return Done(nil), nil
			}
			return Done(map[string]any{"published_at": "2026-09-30T10:00:00Z"}), nil
		}
	}
	return h
}

// KIT_WRITE_VECTORS=1 go test ./wfhandler -run TestContractVectors rewrites
// contract/callback/*.json; otherwise the files are replayed through Door and
// must produce the recorded answers with valid signatures.
func TestContractVectors(t *testing.T) {
	dir := filepath.Join("..", "..", "contract", "callback")
	mux := http.NewServeMux()
	Mount(mux, "/api/workflow", secrets, deciding(), nil, Options{Now: func() time.Time { return clock }})
	if os.Getenv("KIT_WRITE_VECTORS") == "1" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		for _, v := range vectorCases() {
			v.Headers["X-Zavon-Timestamp"] = strconv.FormatInt(clock.Unix(), 10)
			v.Headers["X-Zavon-Signature"] = webhooksig.Header(v.Secrets, clock.Unix(), []byte(v.Body))
			rec := replay(mux, v)
			v.Answer.Status = rec.Code
			v.Answer.Body = strings.TrimSpace(rec.Body.String())
			raw, _ := json.MarshalIndent(v, "", "  ")
			if err := os.WriteFile(filepath.Join(dir, v.Name+".json"), append(raw, '\n'), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no vectors in %s (%v); run with KIT_WRITE_VECTORS=1", dir, err)
	}
	sort.Strings(files)
	if len(files) != len(vectorCases()) {
		t.Fatalf("%d vector files for %d cases", len(files), len(vectorCases()))
	}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var v Vector
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		t.Run(v.Name, func(t *testing.T) {
			ts, _ := strconv.ParseInt(v.Headers["X-Zavon-Timestamp"], 10, 64)
			if err := webhooksig.Verify(v.Secrets, v.Headers["X-Zavon-Signature"], v.Headers["X-Zavon-Timestamp"], []byte(v.Body), time.Unix(ts, 0)); err != nil {
				t.Fatalf("the recorded signature does not verify: %v", err)
			}
			if want := webhooksig.Header(v.Secrets, ts, []byte(v.Body)); v.Headers["X-Zavon-Signature"] != want {
				t.Fatalf("signature %s, this implementation says %s", v.Headers["X-Zavon-Signature"], want)
			}
			rec := replay(mux, v)
			if rec.Code != v.Answer.Status || strings.TrimSpace(rec.Body.String()) != v.Answer.Body {
				t.Fatalf("answered %d %s, vector says %d %s", rec.Code, rec.Body.String(), v.Answer.Status, v.Answer.Body)
			}
			var body map[string]any
			if err := json.Unmarshal([]byte(v.Answer.Body), &body); err != nil {
				t.Fatal(err)
			}
			switch v.Decision {
			case "done":
				if v.Answer.Status != 200 || body["status"] != "done" {
					t.Fatalf("done is 200 {status:done}, not %d %s", v.Answer.Status, v.Answer.Body)
				}
			case "accepted":
				if v.Answer.Status != 202 || body["status"] != "accepted" {
					t.Fatalf("accepted is 202 {status:accepted}, not %d %s", v.Answer.Status, v.Answer.Body)
				}
			case "refused", "unknown":
				if !decidedStatuses[v.Answer.Status] || body["refusal"] == nil {
					t.Fatalf("a refusal is a decided 4xx with a sentence, not %d %s", v.Answer.Status, v.Answer.Body)
				}
			}
		})
	}
}

func replay(mux *http.ServeMux, v Vector) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", "/api/workflow"+v.Path, strings.NewReader(v.Body))
	for k, val := range v.Headers {
		req.Header.Set(k, val)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}
