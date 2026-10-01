// Package wfhandler is an app's door for core's workflow callbacks
// (admin/docs/workflow-engine-plan.md §7.4, §8.5).
//
// Core calls POST {base_url}{action.path} with the body below, signed with
// the app's callback secret (X-Zavon-Timestamp, X-Zavon-Signature) and an
// Idempotency-Key that is stable across retries. Mount enforces the app's
// four obligations so each app does not re-learn them:
//
//  1. verify the signature before reading the body as JSON;
//  2. dedupe on Idempotency-Key — the stored answer is replayed;
//  3. answer in the §7.4 shapes;
//  4. never call back into core synchronously inside the handler's
//     transaction (that one is the handler's to keep).
//
// Two doors. Door runs a Handler and then remembers its answer: the effect
// and the replay record are two writes, and a crash between them lets core's
// retry run the effect again (the log says so). DoorTx (v1.1.0) opens ONE
// transaction, hands it to the TxHandler, and writes the replay record inside
// it before committing — the effect and its record land together or not at
// all, which is the obligation Shop's workflow_actions was built to meet
// (admin/docs/workflow-engine-plan.md §7.4). New apps use DoorTx; Door stays
// for an app whose effect is not a database write.
//
// The shapes, as core reads them (admin app/workflow/call.go
// ClassifyAnswer):
//
//	200 {"status":"done","output":{…}}      the step completes
//	202 {"status":"accepted"}               async: finish later with wfclient.CompleteDelivery
//	4xx {"refusal":"sentence"}              a DECIDED no: the run pauses with the sentence
//	                                        (400/404/409/410/413/422 are the decided ones)
//	401/403                                 configuration (the secret); core retries then alerts
//	5xx                                     retried with the same key
package wfhandler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/zavon-holdings/kit/go/webhooksig"
)

// Call is what core sends.
type Call struct {
	Action   string         `json:"action"`
	Delivery string         `json:"delivery,omitempty"`
	Tenant   string         `json:"tenant"`
	Run      Run            `json:"run"`
	Step     Step           `json:"step"`
	Subject  Subject        `json:"subject"`
	Input    map[string]any `json:"input"`
	Vars     map[string]any `json:"vars,omitempty"`
	Attempt  int            `json:"attempt"`
	// IdempotencyKey is the header, copied here for the handler.
	IdempotencyKey string `json:"-"`
}

// Run is the run a call is for.
type Run struct {
	UID        string `json:"uid"`
	Definition string `json:"definition"`
	Version    int    `json:"version"`
	Kind       string `json:"kind"`
	Tenant     string `json:"tenant"`
	Property   string `json:"property"`
}

// Step is the step a call is for.
type Step struct {
	Code string `json:"code"`
	Kind string `json:"kind"`
}

// Subject is what the run is about.
type Subject struct {
	Property string            `json:"property"`
	Type     string            `json:"type"`
	PID      string            `json:"pid"`
	Label    string            `json:"label,omitempty"`
	URL      string            `json:"url,omitempty"`
	Vars     map[string]string `json:"vars,omitempty"`
}

// Answer is what a handler decides.
type Answer struct {
	// Done completes the step; Output is exposed to later steps.
	Output map[string]any
	// Accepted means the work continues; the app finishes it later with
	// wfclient.CompleteDelivery(delivery). Only for actions registered
	// mode: async.
	Accepted bool
	// Refusal is a decided no, in a sentence the run's screen shows verbatim.
	// Status picks the 4xx (default 422); it must be one core reads as a
	// decision, or it will be retried.
	Refusal string
	Status  int
}

// Done is the ordinary answer.
func Done(output map[string]any) Answer { return Answer{Output: output} }

// Accepted is the async answer.
func Accepted() Answer { return Answer{Accepted: true} }

// Refuse is a decided no.
func Refuse(sentence string) Answer {
	return Answer{Refusal: sentence, Status: http.StatusUnprocessableEntity}
}

// Resolver answers are Done(output) with these shapes:
//
//	<ns>.resolve_recipient   {"email","name"} or {"refused":true,"reason":"…"}
//	<ns>.render_email        {"subject","html","text"}
//	hook actions             any Done; the input carries {"event","state","outcome","pause_reason"}

// Handler answers one action. An error is a fault (500): core retries with
// the same key. A decision, including no, is an Answer.
type Handler func(ctx context.Context, call Call) (Answer, error)

// Handlers maps action names to handlers.
type Handlers map[string]Handler

// Stored is one answer kept against an Idempotency-Key.
type Stored struct {
	Action   string
	Status   int
	Response json.RawMessage
}

// ReplayStore keeps decided answers by key, in the SAME transaction as the
// effect when the app can (Shop's workflow_actions is the model). Get answers
// (nil, nil) for a key never seen.
type ReplayStore interface {
	Get(ctx context.Context, key string) (*Stored, error)
	Put(ctx context.Context, key string, s Stored) error
}

// decidedStatuses are the 4xx core reads as a decided no (call.go decidedNo).
var decidedStatuses = map[int]bool{400: true, 404: true, 409: true, 410: true, 413: true, 422: true}

// Options adjust Mount.
type Options struct {
	// Now is the clock the skew check uses; nil is time.Now.
	Now func() time.Time
	// Log hears faults. Nil is silent.
	Log func(msg string, err error)
}

// Mount registers the door on mux at prefix (usually "/api/workflow"): every
// action registered with path "/actions" arrives at prefix+"/actions", hooks at
// prefix+"/hooks". Both are served by the same handler; the action name in the
// body picks the Handler.
//
// secrets are the app's ZAVON_WORKFLOW_SECRET values (current, and previous
// during a rotation). With none, every request is 503: a missing secret fails
// closed, never open.
func Mount(mux *http.ServeMux, prefix string, secrets []string, h Handlers, store ReplayStore, opts ...Options) {
	door := Door(secrets, h, store, opts...)
	prefix = strings.TrimRight(prefix, "/")
	mux.Handle("POST "+prefix+"/actions", door)
	mux.Handle("POST "+prefix+"/hooks", door)
}

// Door is the handler Mount registers, for an app that routes its own.
func Door(secrets []string, h Handlers, store ReplayStore, opts ...Options) http.Handler {
	o := options(opts)
	admit := admitter(secrets, o)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		call, ok := admit(w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		if store != nil {
			prev, err := store.Get(ctx, call.IdempotencyKey)
			if err != nil {
				o.Log("wfhandler: reading a stored answer", err)
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "could not read this request's history"})
				return
			}
			if prev != nil {
				answerAgain(w, prev)
				return
			}
		}
		handler, ok := h[call.Action]
		if !ok {
			unknown(w, call)
			return
		}
		answer, err := handler(ctx, call)
		if err != nil {
			// A fault, not a decision: not stored, so core's retry runs the
			// handler again.
			o.Log("wfhandler: "+call.Action, err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		status, out := shape(answer)
		raw, _ := json.Marshal(out)
		if store != nil {
			if err := store.Put(ctx, call.IdempotencyKey, Stored{Action: call.Action, Status: status, Response: raw}); err != nil {
				// The work happened. Not remembering it means core's retry
				// runs it again — said in the log rather than swallowed.
				o.Log("wfhandler: remembering the answer for "+call.IdempotencyKey, err)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write(raw)
	})
}

/* ── the transactional door (v1.1.0) ── */

// Tx is the transaction a TxStore opens: the handler's effect and the replay
// record share it, and both land or neither does. A pgx.Tx satisfies it
// through a two-line adapter (Exec's first return is a CommandTag, which this
// takes as any); kit imports no driver.
type Tx interface {
	Querier
	Commit(ctx context.Context) error
	Rollback(ctx context.Context) error
}

// TxStore opens the transaction one call runs in. The replay table is read
// and written through the same transaction (SQLReplayStore on the Tx), so an
// app brings only Begin.
type TxStore interface {
	Begin(ctx context.Context) (Tx, error)
}

// TxHandler answers one action INSIDE tx. Its effect goes through tx; the
// door writes the replay record through the same tx and commits. An error is
// a fault: the transaction is rolled back, nothing is remembered, and core
// retries with the same key. A decision, including no, is an Answer — and
// a refusal's effect (if the handler made one) commits with it, which is the
// handler's choice: a refusal that leaves a row saying why is a refusal
// somebody can read.
//
// The handler must not call core inside tx (obligation 4): on a one-connection
// pool that is a deadlock, and on any pool it is a round trip holding a lock.
type TxHandler func(ctx context.Context, tx Tx, call Call) (Answer, error)

// TxHandlers maps action names to transactional handlers.
type TxHandlers map[string]TxHandler

// MountTx is Mount for the transactional door.
func MountTx(mux *http.ServeMux, prefix string, secrets []string, h TxHandlers, store TxStore, opts ...Options) {
	door := DoorTx(secrets, h, store, opts...)
	prefix = strings.TrimRight(prefix, "/")
	mux.Handle("POST "+prefix+"/actions", door)
	mux.Handle("POST "+prefix+"/hooks", door)
}

// DoorTx is the door whose replay record is written in the handler's own
// transaction. The sequence: verify, read the key, decode; Begin; look the key
// up through tx (a replay answers from the record and rolls back); run the
// handler; INSERT the record — a plain insert, so two deliveries of one key
// racing through two transactions end with the loser's insert refused at
// the unique key, its effect rolled back, and a 5xx that core retries into
// a replay of the winner's answer; Commit. A commit that fails is a fault:
// the effect did not happen, so nothing is remembered.
func DoorTx(secrets []string, h TxHandlers, store TxStore, opts ...Options) http.Handler {
	o := options(opts)
	admit := admitter(secrets, o)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		call, ok := admit(w, r)
		if !ok {
			return
		}
		if store == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "this door has no transaction store, so it cannot remember its answers"})
			return
		}
		ctx := r.Context()
		tx, err := store.Begin(ctx)
		if err != nil {
			o.Log("wfhandler: opening a transaction", err)
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "could not open a transaction for this request"})
			return
		}
		committed := false
		defer func() {
			if !committed {
				_ = tx.Rollback(ctx)
			}
		}()
		rs := SQLReplayStore{Q: tx}
		prev, err := rs.Get(ctx, call.IdempotencyKey)
		if err != nil {
			o.Log("wfhandler: reading a stored answer", err)
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "could not read this request's history"})
			return
		}
		if prev != nil {
			answerAgain(w, prev)
			return
		}
		handler, ok := h[call.Action]
		if !ok {
			unknown(w, call)
			return
		}
		answer, err := handler(ctx, tx, call)
		if err != nil {
			o.Log("wfhandler: "+call.Action, err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		status, out := shape(answer)
		raw, _ := json.Marshal(out)
		if err := rs.insert(ctx, call.IdempotencyKey, Stored{Action: call.Action, Status: status, Response: raw}); err != nil {
			// The key is taken (another delivery of the same call got there
			// first) or the write failed. Either way this effect must not
			// land: rolled back, and core's retry replays the winner.
			o.Log("wfhandler: remembering the answer for "+call.IdempotencyKey, err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not record this answer; the effect was rolled back"})
			return
		}
		if err := tx.Commit(ctx); err != nil {
			o.Log("wfhandler: committing "+call.Action, err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "the transaction did not commit; nothing was kept"})
			return
		}
		committed = true
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write(raw)
	})
}

/* ── shared by both doors ── */

// options fills in the defaults.
func options(opts []Options) Options {
	var o Options
	if len(opts) > 0 {
		o = opts[0]
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.Log == nil {
		o.Log = func(string, error) {}
	}
	return o
}

// admitter is the part of the door that is the same whatever happens next:
// closed without a secret, the signature before the body, the key, the
// decode. It answers the refusal itself and reports false.
func admitter(secrets []string, o Options) func(w http.ResponseWriter, r *http.Request) (Call, bool) {
	live := 0
	for _, s := range secrets {
		if strings.TrimSpace(s) != "" {
			live++
		}
	}
	return func(w http.ResponseWriter, r *http.Request) (Call, bool) {
		if live == 0 {
			// Fail closed: without a secret nothing can be verified, and
			// answering 503 tells core to retry once it is installed.
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "ZAVON_WORKFLOW_SECRET is not set, so this door is closed"})
			return Call{}, false
		}
		body, err := webhooksig.VerifyRequest(r, secrets, o.Now())
		switch {
		case errors.Is(err, webhooksig.ErrMismatch):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "signature does not match"})
			return Call{}, false
		case err != nil:
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return Call{}, false
		}
		key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
		if key == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "an Idempotency-Key is required: a retried request must be one action"})
			return Call{}, false
		}
		var call Call
		if err := json.Unmarshal(body, &call); err != nil || call.Action == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "the body is not a workflow call"})
			return Call{}, false
		}
		call.IdempotencyKey = key
		return call, true
	}
}

// answerAgain answers a call asked before: the same answer, and no handler runs.
func answerAgain(w http.ResponseWriter, prev *Stored) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(prev.Status)
	_, _ = w.Write(prev.Response)
}

// unknown is the decided no for an action this app does not have.
func unknown(w http.ResponseWriter, call Call) {
	writeJSON(w, http.StatusNotFound, map[string]string{"refusal": fmt.Sprintf("this app does not answer %s", call.Action)})
}

// shape turns an Answer into the §7.4 status and body.
func shape(a Answer) (int, any) {
	switch {
	case a.Refusal != "":
		status := a.Status
		if !decidedStatuses[status] {
			status = http.StatusUnprocessableEntity
		}
		return status, map[string]string{"refusal": a.Refusal}
	case a.Accepted:
		return http.StatusAccepted, map[string]string{"status": "accepted"}
	}
	out := map[string]any{"status": "done"}
	if a.Output != nil {
		out["output"] = a.Output
	}
	return http.StatusOK, out
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

/* ── a SQL replay store ── */

// DDL is the replay table an app keeps, modelled on Shop's workflow_actions
// (shop migration 0009): one row per Idempotency-Key, written in the same
// transaction as the effect where the app can.
const DDL = `CREATE TABLE IF NOT EXISTS workflow_actions (
  idempotency_key TEXT PRIMARY KEY,
  action          TEXT NOT NULL,
  status          INT NOT NULL,
  response        JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);`

// Row is one row as a Querier scans it.
type Row interface {
	Scan(dest ...any) error
}

// Querier is the least a store needs of a database: a pgx pool or
// transaction satisfies it. Kit imports no driver.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (any, error)
	QueryRow(ctx context.Context, sql string, args ...any) Row
}

// SQLReplayStore keeps answers in workflow_actions through a Querier.
// JSONB is passed as a string: under the simple protocol production runs,
// a []byte is a bytea literal a jsonb column refuses.
type SQLReplayStore struct{ Q Querier }

// Get reads a stored answer. A missing row is (nil, nil): the Querier's
// no-rows error is recognised by its text, since kit imports no driver.
func (s SQLReplayStore) Get(ctx context.Context, key string) (*Stored, error) {
	var out Stored
	var raw string
	err := s.Q.QueryRow(ctx, `SELECT action, status, response::text FROM workflow_actions WHERE idempotency_key = $1`, key).
		Scan(&out.Action, &out.Status, &raw)
	if err != nil {
		if isNoRows(err) {
			return nil, nil
		}
		return nil, err
	}
	out.Response = json.RawMessage(raw)
	return &out, nil
}

// Put remembers a decided answer. A 5xx is never stored: it is a fault the
// retry may resolve. ON CONFLICT DO NOTHING, because outside a transaction
// the first decision stands and a second Put for the same key is a late
// duplicate — the right rule for Door, and the WRONG one inside DoorTx's
// transaction, where it would let two racing effects both commit (insert).
func (s SQLReplayStore) Put(ctx context.Context, key string, st Stored) error {
	if st.Status >= 500 {
		return nil
	}
	_, err := s.Q.Exec(ctx, `INSERT INTO workflow_actions (idempotency_key, action, status, response)
		VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING`, key, st.Action, st.Status, string(st.Response))
	return err
}

// insert is Put with no ON CONFLICT: inside DoorTx's transaction the key being
// taken is the signal that another delivery's effect has already committed,
// and this one must roll back. A 5xx is never stored here either.
func (s SQLReplayStore) insert(ctx context.Context, key string, st Stored) error {
	if st.Status >= 500 {
		return nil
	}
	_, err := s.Q.Exec(ctx, `INSERT INTO workflow_actions (idempotency_key, action, status, response)
		VALUES ($1, $2, $3, $4::jsonb)`, key, st.Action, st.Status, string(st.Response))
	return err
}

// ErrNoRows is what a Querier may return for an empty QueryRow; pgx's
// ErrNoRows says "no rows in result set".
var ErrNoRows = errors.New("no rows in result set")

func isNoRows(err error) bool {
	return errors.Is(err, ErrNoRows) || strings.Contains(err.Error(), "no rows in result set")
}
