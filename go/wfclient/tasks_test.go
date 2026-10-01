package wfclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// The task vectors (contract/tasks) are generated from core's live answers
// (admin/backend/app/api, TestTaskVectors). Here they are decoded STRICTLY
// into this client's types: a field core answers that the client does not
// know, or one the client expects that core no longer sends, fails here.

func strict(t *testing.T, rel string, into any) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "contract", rel))
	if err != nil {
		t.Fatalf("%s: %v", rel, err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		t.Fatalf("%s does not decode strictly into the client's type: %v", rel, err)
	}
	return raw
}

func TestTaskVectorsDecodeIntoTheClientsTypes(t *testing.T) {
	var task Task
	strict(t, "tasks/task.json", &task)
	if task.TaskType != "approval" || task.Mode != "all" || len(task.Assignees) != 3 || len(task.Decisions) != 1 ||
		task.Counts.Approved != 1 || task.Counts.Needed != 2 || task.Decisions[0].Actor.Email != "a@x.org" {
		t.Fatalf("task = %+v", task)
	}
	var inbox struct {
		Tasks []Task `json:"tasks"`
		Page
	}
	strict(t, "tasks/inbox.json", &inbox)
	if len(inbox.Tasks) != 1 || inbox.Tasks[0].Assignees[2].Email != "b@x.org" || inbox.Tasks[0].Assignees[2].State != "pending" {
		t.Fatalf("inbox = %+v", inbox)
	}
	var d Decide
	raw := strict(t, "tasks/decide-request.json", &d)
	again, _ := json.Marshal(d)
	var a, b map[string]any
	_ = json.Unmarshal(raw, &a)
	_ = json.Unmarshal(again, &b)
	if ja, jb := mustJSON(a), mustJSON(b); ja != jb {
		t.Fatalf("the client marshals a decision differently from the vector:\n%s\n%s", jb, ja)
	}
}

func mustJSON(v any) string { raw, _ := json.Marshal(v); return string(raw) }

func TestTaskRefusalsArriveAsErrorsWithTheirCodes(t *testing.T) {
	var refusals []struct {
		Status int             `json:"status"`
		Body   json.RawMessage `json:"body"`
	}
	strict(t, "tasks/refusals.json", &refusals)
	want := []string{"not_an_assignee", "self_approval", "subject_changed", "already_decided", "task_closed"}
	if len(refusals) != len(want) {
		t.Fatalf("%d refusals, want %d", len(refusals), len(want))
	}
	for i, r := range refusals {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			_, _ = io.Copy(io.Discard, req.Body)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(r.Status)
			_, _ = w.Write(r.Body)
		}))
		_, err := New(srv.URL, "zvn_x.y").DecideTask(context.Background(), "t1", Decide{Actor: Actor{Email: "a@x.org"}, Decision: "approve"}, "k")
		srv.Close()
		var e *Error
		if !errors.As(err, &e) || e.Code != want[i] || e.Status != r.Status {
			t.Errorf("refusal %d -> %v, want %s", i, err, want[i])
		}
	}
}

func TestTheTaskCallsSayWhatTheyAreAndNameThePerson(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		got = append(got, r.Method+" "+r.URL.Path+"?"+r.URL.RawQuery+" "+r.Header.Get("Idempotency-Key")+" "+string(body))
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet && r.URL.Path == "/api/workflows/tasks" {
			_, _ = w.Write([]byte(`{"tasks":[],"next_cursor":""}`))
			return
		}
		_, _ = w.Write([]byte(`{"uid":"t1"}`))
	}))
	defer srv.Close()
	c := New(srv.URL, "zvn_x.y")
	ctx := context.Background()
	me := Actor{Email: "a@x.org"}
	if _, _, err := c.ListTasks(ctx, TaskFilter{Tenant: "shofar", Assignee: "a@x.org", Status: "open", Kind: "approval"}); err != nil {
		t.Fatal(err)
	}
	_, _ = c.GetTask(ctx, "t1", "a@x.org")
	_, _ = c.DecideTask(ctx, "t1", Decide{Actor: me, Decision: "approve", SubjectSHA256: "abc"}, "review:1:a")
	_, _ = c.ClaimTask(ctx, "t1", me, false)
	_, _ = c.ClaimTask(ctx, "t1", me, true)
	_, _ = c.DelegateTask(ctx, "t1", me, TaskPerson{Email: "b@x.org"}, "away", "d1")
	_, _ = c.ReassignTask(ctx, "t1", me, []TaskPerson{{Email: "c@x.org"}}, nil, "Easter", "r1")
	_, _ = c.EscalateTask(ctx, "t1", me, "away", "e1")
	_, _ = c.RemindTask(ctx, "t1")
	_, _ = c.CompleteTask(ctx, "t1", Completion{Actor: me, Outcome: "ok"}, "c1")
	want := []string{
		"GET /api/workflows/tasks?assignee=a%40x.org&kind=approval&status=open&tenant=shofar  ",
		"GET /api/workflows/tasks/t1?as=a%40x.org  ",
		`POST /api/workflows/tasks/t1/decide? review:1:a {"actor":{"email":"a@x.org"},"decision":"approve","permits_version":0,"subject_sha256":"abc"}`,
		`POST /api/workflows/tasks/t1/claim?  {"actor":{"email":"a@x.org"}}`,
		`POST /api/workflows/tasks/t1/release?  {"actor":{"email":"a@x.org"}}`,
		`POST /api/workflows/tasks/t1/delegate? d1 {"actor":{"email":"a@x.org"},"note":"away","to":{"email":"b@x.org"}}`,
		`POST /api/workflows/tasks/t1/reassign? r1 {"actor":{"email":"a@x.org"},"add":[{"email":"c@x.org"}],"reason":"Easter","remove":null}`,
		`POST /api/workflows/tasks/t1/escalate? e1 {"actor":{"email":"a@x.org"},"reason":"away"}`,
		"POST /api/workflows/tasks/t1/remind?  {}",
		`POST /api/workflows/tasks/t1/complete? c1 {"actor":{"email":"a@x.org"},"outcome":"ok"}`,
	}
	if len(got) != len(want) {
		t.Fatalf("calls = %d: %q", len(got), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("call %d:\n got %s\nwant %s", i, got[i], want[i])
		}
	}
}
