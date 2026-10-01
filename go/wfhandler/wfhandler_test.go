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

// post sends a signed call the way the workflow service does.
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
	// A refusal with a status the workflow service would retry is corrected to 422.
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
		t.Fatal("a 5xx was remembered; the workflow service's retry must run the handler again")
	}
	if !strings.Contains(DDL, "workflow_actions") || !strings.Contains(DDL, "idempotency_key TEXT PRIMARY KEY") {
		t.Fatalf("DDL %s", DDL)
	}
}

/* ── contract vectors ── */

// Vector is one case in contract/callback/*.json: the request the workflow service sends and
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
		// A notification step's phone channel goes through Reach until the
		// channel lift (expansion plan §2.4): one call per recipient, keyed
		// by the step and the number; Reach answers done with the delivery,
		// or a decided no (no consent, outside the session window) that
		// skips that recipient.
		mk("channel-send", "/actions", "run:r1:step:ping:+27821234567",
			`{"action":"reach.channel.send","tenant":"shofar","run":{"uid":"r1","definition":"order-ready","version":1,"kind":"workflow","tenant":"shofar","property":"shop"},"step":{"code":"ping","kind":"notification"},"subject":{"property":"shop","type":"order","pid":"o1","label":"Order 1048"},"input":{"channel":"whatsapp","to":"+27821234567","name":"Thandi","template":"hsm_order_ready_v1","vars":{"order":"1048"}},"vars":{"order":"1048"},"attempt":1}`, "done"),
		mk("channel-send-refused", "/actions", "run:r1:step:ping:+27820000000",
			`{"action":"reach.channel.send","tenant":"shofar","run":{"uid":"r1","definition":"order-ready","version":1,"kind":"workflow","tenant":"shofar","property":"shop"},"step":{"code":"ping","kind":"notification"},"subject":{"property":"shop","type":"order","pid":"o1","label":"Order 1048"},"input":{"channel":"whatsapp","to":"+27820000000","template":"hsm_order_ready_v1","vars":{"order":"1048"}},"vars":{"order":"1048"},"attempt":1}`, "refused"),
		mk("hook-finished", "/hooks", "run:r1:hook:finished",
			`{"action":"pages.notify","tenant":"shofar","run":{"uid":"r1","definition":"page-review","version":2,"kind":"approval","tenant":"shofar","property":"pages-by-zavon"},"step":{"code":"","kind":"hook"},"subject":{"property":"pages-by-zavon","type":"page","pid":"p1"},"input":{"event":"finished","state":"done","outcome":"approved","pause_reason":""},"attempt":1}`, "done"),
	}
}

// deciding is the handler set the vectors are recorded against: the answer
// each decision produces, so the recorded answers are what any door built on
// this package returns for the same call.
func deciding() Handlers {
	h := Handlers{}
	for _, name := range []string{"pages.publish", "pages.resolve_recipient", "pages.notify", "reach.channel.send"} {
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
			case name == "reach.channel.send":
				if c.Input["to"] == "+27820000000" {
					return Refuse("no consent for this number"), nil
				}
				return Done(map[string]any{"delivery_uids": []string{"dl_01J9"}}), nil
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

/* ── the transactional door ── */

// memDB is a database with two tables — the app's effects and
// workflow_actions — and transactions that stage writes and apply them at
// Commit, where the replay key's uniqueness is checked the way a primary key
// would refuse it. Enough to prove the door's atomicity without a driver.
type memDB struct {
	mu       sync.Mutex
	effects  []string
	answers  map[string]Stored
	begun    int
	commits  int
	failNext error // the next Commit fails with this
	hold     chan struct{}
}

type memTx struct {
	db      *memDB
	effects []string
	answers map[string]Stored
	done    bool
}

func (db *memDB) Begin(context.Context) (Tx, error) {
	db.mu.Lock()
	defer db.mu.Unlock()
	db.begun++
	return &memTx{db: db, answers: map[string]Stored{}}, nil
}

func (tx *memTx) Exec(_ context.Context, sql string, args ...any) (any, error) {
	if strings.Contains(sql, "INSERT INTO workflow_actions") {
		if strings.Contains(sql, "ON CONFLICT") {
			return nil, errors.New("the transactional door must insert plainly, so a racing twin is refused rather than ignored")
		}
		if _, isString := args[3].(string); !isString {
			return nil, fmt.Errorf("JSONB must be passed as a string, got %T", args[3])
		}
		key := args[0].(string)
		// Postgres makes the second inserter WAIT for the first transaction
		// and then refuses it at the unique key; here the committed table is
		// what a waiting inserter would see.
		tx.db.mu.Lock()
		_, taken := tx.db.answers[key]
		tx.db.mu.Unlock()
		if taken {
			return nil, errors.New(`duplicate key value violates unique constraint "workflow_actions_pkey"`)
		}
		tx.answers[key] = Stored{Action: args[1].(string), Status: args[2].(int), Response: json.RawMessage(args[3].(string))}
		return nil, nil
	}
	// Anything else is the handler's own effect.
	tx.effects = append(tx.effects, fmt.Sprint(sql, args))
	return nil, nil
}

func (tx *memTx) QueryRow(_ context.Context, _ string, args ...any) Row {
	tx.db.mu.Lock()
	defer tx.db.mu.Unlock()
	if s, ok := tx.db.answers[args[0].(string)]; ok {
		return fakeRow{s: &s}
	}
	return fakeRow{err: errors.New("no rows in result set")}
}

func (tx *memTx) Commit(context.Context) error {
	tx.db.mu.Lock()
	defer tx.db.mu.Unlock()
	if tx.done {
		return errors.New("tx is closed")
	}
	tx.done = true
	if err := tx.db.failNext; err != nil {
		tx.db.failNext = nil
		return err
	}
	for k := range tx.answers {
		if _, taken := tx.db.answers[k]; taken {
			return errors.New(`duplicate key value violates unique constraint "workflow_actions_pkey"`)
		}
	}
	for k, v := range tx.answers {
		if tx.db.answers == nil {
			tx.db.answers = map[string]Stored{}
		}
		tx.db.answers[k] = v
	}
	tx.db.effects = append(tx.db.effects, tx.effects...)
	tx.db.commits++
	return nil
}

func (tx *memTx) Rollback(context.Context) error {
	tx.db.mu.Lock()
	defer tx.db.mu.Unlock()
	tx.done = true
	return nil
}

// txRig mounts DoorTx over a memDB, counting handler runs.
type txRig struct {
	srv   *httptest.Server
	db    *memDB
	calls int
	mu    sync.Mutex
}

func newTxRig(t *testing.T, h TxHandlers) *txRig {
	r := &txRig{db: &memDB{}}
	counted := TxHandlers{}
	for name, fn := range h {
		fn := fn
		counted[name] = func(ctx context.Context, tx Tx, c Call) (Answer, error) {
			r.mu.Lock()
			r.calls++
			r.mu.Unlock()
			return fn(ctx, tx, c)
		}
	}
	mux := http.NewServeMux()
	MountTx(mux, "/api/workflow", secrets, counted, r.db, Options{Now: func() time.Time { return clock }})
	r.srv = httptest.NewServer(mux)
	t.Cleanup(r.srv.Close)
	return r
}

func (r *txRig) post(t *testing.T, body, key string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest("POST", r.srv.URL+"/api/workflow/actions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key)
	webhooksig.SignRequest(req, secrets, []byte(body), clock)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

// publishing is a handler whose effect is one row, written through the tx.
func publishing(tx Tx, c Call) (Answer, error) {
	if _, err := tx.Exec(context.Background(), `UPDATE pages SET published_at = now() WHERE pid = $1`, c.Subject.PID); err != nil {
		return Answer{}, err
	}
	return Done(map[string]any{"published_at": "2026-09-30T10:00:00Z"}), nil
}

func TestTheTransactionalDoorCommitsTheEffectWithItsRecord(t *testing.T) {
	r := newTxRig(t, TxHandlers{"pages.publish": func(_ context.Context, tx Tx, c Call) (Answer, error) { return publishing(tx, c) }})
	status, out := r.post(t, publishCall, "run:r1:step:publish")
	if status != 200 || out["status"] != "done" {
		t.Fatalf("first delivery: %d %v", status, out)
	}
	if len(r.db.effects) != 1 || r.db.answers["run:r1:step:publish"].Status != 200 || r.db.commits != 1 {
		t.Fatalf("after one delivery: effects %v answers %v commits %d — the effect and its record land together", r.db.effects, r.db.answers, r.db.commits)
	}
	// Asked again: the same answer, no handler, no second effect.
	status, out = r.post(t, publishCall, "run:r1:step:publish")
	if status != 200 || out["status"] != "done" || r.calls != 1 || len(r.db.effects) != 1 {
		t.Fatalf("replay: %d %v, handler ran %d times, effects %v", status, out, r.calls, r.db.effects)
	}
	// A refusal commits too: the decision is remembered, and whatever the
	// handler wrote beside it (a row saying why) lands with it.
	r2 := newTxRig(t, TxHandlers{"pages.publish": func(_ context.Context, tx Tx, c Call) (Answer, error) {
		_, _ = tx.Exec(context.Background(), `INSERT INTO page_notes (pid, note) VALUES ($1, 'refused')`, c.Subject.PID)
		return Answer{Refusal: "The page was deleted.", Status: 410}, nil
	}})
	if status, out := r2.post(t, publishCall, "k"); status != 410 || out["refusal"] == nil {
		t.Fatalf("refusal: %d %v", status, out)
	}
	if r2.db.answers["k"].Status != 410 || len(r2.db.effects) != 1 {
		t.Fatalf("a refusal was not committed with its record: %v %v", r2.db.answers, r2.db.effects)
	}
}

func TestAFaultRollsTheEffectBackAndRemembersNothing(t *testing.T) {
	r := newTxRig(t, TxHandlers{"pages.publish": func(_ context.Context, tx Tx, c Call) (Answer, error) {
		_, _ = tx.Exec(context.Background(), `UPDATE pages SET published_at = now()`)
		return Answer{}, errors.New("the snapshot sha does not match")
	}})
	status, _ := r.post(t, publishCall, "k")
	if status != 500 {
		t.Fatalf("a fault -> %d, want 500 so the workflow service retries", status)
	}
	if len(r.db.effects) != 0 || len(r.db.answers) != 0 || r.db.commits != 0 {
		t.Fatalf("after a fault: effects %v answers %v commits %d — nothing may land", r.db.effects, r.db.answers, r.db.commits)
	}
	// The retry runs the handler again (nothing was remembered).
	r.post(t, publishCall, "k")
	if r.calls != 2 {
		t.Fatalf("handler ran %d times across a fault and its retry, want 2", r.calls)
	}
}

func TestACommitThatFailsIsAFaultNotADecision(t *testing.T) {
	r := newTxRig(t, TxHandlers{"pages.publish": func(_ context.Context, tx Tx, c Call) (Answer, error) { return publishing(tx, c) }})
	r.db.failNext = errors.New("connection reset by peer")
	status, out := r.post(t, publishCall, "k")
	if status != 500 || !strings.Contains(fmt.Sprint(out["error"]), "did not commit") {
		t.Fatalf("a failed commit -> %d %v, want 500 saying nothing was kept", status, out)
	}
	if len(r.db.effects) != 0 || len(r.db.answers) != 0 {
		t.Fatalf("a failed commit left %v %v", r.db.effects, r.db.answers)
	}
}

// Two deliveries of ONE key through two transactions at once: Door's
// post-hoc Put (ON CONFLICT DO NOTHING) would let both effects commit and
// silently drop the second record. The transactional door inserts plainly,
// so exactly one effect lands, exactly one answer is remembered, and the
// loser answers 5xx for the workflow service to retry into a replay of the winner.
func TestTwoDeliveriesOfOneKeyProduceOneEffect(t *testing.T) {
	gate := make(chan struct{})
	r := newTxRig(t, TxHandlers{"pages.publish": func(_ context.Context, tx Tx, c Call) (Answer, error) {
		<-gate // both handlers are inside their transactions before either commits
		return publishing(tx, c)
	}})
	type res struct {
		status int
	}
	results := make(chan res, 2)
	for i := 0; i < 2; i++ {
		go func() {
			status, _ := r.post(t, publishCall, "run:r1:step:publish")
			results <- res{status}
		}()
	}
	// Let both in, then release them together.
	deadline := time.After(5 * time.Second)
	for {
		r.mu.Lock()
		n := r.calls
		r.mu.Unlock()
		if n == 2 {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("only %d handler(s) started", n)
		case <-time.After(5 * time.Millisecond):
		}
	}
	close(gate)
	a, b := <-results, <-results
	codes := []int{a.status, b.status}
	sort.Ints(codes)
	if codes[0] != 200 || codes[1] != 500 {
		t.Fatalf("answers %v, want one 200 and one 500", codes)
	}
	if len(r.db.effects) != 1 || len(r.db.answers) != 1 || r.db.commits != 1 {
		t.Fatalf("effects %v answers %v commits %d — exactly one of each", r.db.effects, r.db.answers, r.db.commits)
	}
	// And the loser's retry is a replay of the winner.
	status, out := r.post(t, publishCall, "run:r1:step:publish")
	if status != 200 || out["status"] != "done" || r.calls != 2 {
		t.Fatalf("retry: %d %v, handler ran %d times", status, out, r.calls)
	}
}

func TestTheTransactionalDoorKeepsTheDoorsRefusals(t *testing.T) {
	r := newTxRig(t, TxHandlers{"pages.publish": func(_ context.Context, tx Tx, c Call) (Answer, error) { return publishing(tx, c) }})
	// Unknown action: a decided no, and no transaction is left open.
	status, out := r.post(t, strings.Replace(publishCall, "pages.publish", "pages.archive", 1), "k2")
	if status != 404 || out["refusal"] == nil || r.db.commits != 0 {
		t.Fatalf("unknown action: %d %v commits %d", status, out, r.db.commits)
	}
	// No key, bad signature: refused before any transaction opens.
	req, _ := http.NewRequest("POST", r.srv.URL+"/api/workflow/actions", strings.NewReader(publishCall))
	webhooksig.SignRequest(req, secrets, []byte(publishCall), clock)
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("no key -> %d", resp.StatusCode)
	}
	req, _ = http.NewRequest("POST", r.srv.URL+"/api/workflow/actions", strings.NewReader(publishCall))
	req.Header.Set("Idempotency-Key", "k")
	webhooksig.SignRequest(req, []string{"wrong"}, []byte(publishCall), clock)
	resp, _ = http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatalf("bad signature -> %d", resp.StatusCode)
	}
	// Only the admitted call (the unknown action) opened a transaction. A
	// refused signature or a missing key never touches the database.
	if r.db.begun != 1 {
		t.Fatalf("transactions begun: %d, want 1", r.db.begun)
	}
	// And a door with no store is closed, saying so.
	mux := http.NewServeMux()
	MountTx(mux, "/api/workflow", secrets, TxHandlers{}, nil, Options{Now: func() time.Time { return clock }})
	v := vectorCases()[0]
	v.Headers["X-Zavon-Timestamp"] = strconv.FormatInt(clock.Unix(), 10)
	v.Headers["X-Zavon-Signature"] = webhooksig.Header(v.Secrets, clock.Unix(), []byte(v.Body))
	if rec := replay(mux, v); rec.Code != 503 {
		t.Fatalf("no store -> %d, want 503", rec.Code)
	}
}

// The wire is the same through either door: every recorded vector produces
// the recorded answer through DoorTx too.
func TestTheTransactionalDoorAnswersEveryVectorTheSame(t *testing.T) {
	txh := TxHandlers{}
	for name, fn := range deciding() {
		fn := fn
		txh[name] = func(ctx context.Context, _ Tx, c Call) (Answer, error) { return fn(ctx, c) }
	}
	for _, v := range vectorCases() {
		raw, err := os.ReadFile(filepath.Join("..", "..", "contract", "callback", v.Name+".json"))
		if err != nil {
			t.Fatal(err)
		}
		var recorded Vector
		if err := json.Unmarshal(raw, &recorded); err != nil {
			t.Fatal(err)
		}
		mux := http.NewServeMux()
		MountTx(mux, "/api/workflow", secrets, txh, &memDB{}, Options{Now: func() time.Time { return clock }})
		rec := replay(mux, recorded)
		if rec.Code != recorded.Answer.Status || strings.TrimSpace(rec.Body.String()) != recorded.Answer.Body {
			t.Errorf("%s through DoorTx: %d %s, vector says %d %s", v.Name, rec.Code, rec.Body.String(), recorded.Answer.Status, recorded.Answer.Body)
		}
	}
}
