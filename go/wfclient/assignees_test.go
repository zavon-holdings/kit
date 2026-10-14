package wfclient

import (
	"context"
	"strings"
	"testing"
)

// Run assignees and template install: path, verb and body, pinned.
func TestAssigneesAndTemplateInstall(t *testing.T) {
	ctx := context.Background()
	f, c := newFakeCore(t)
	actor := &Actor{Email: "lead@example.test"}

	f.status, f.answer = 201, `{"uid":"r1","assignees":[{"email":"ana@example.test","source":"manual","assigned_by":{},"assigned_at":"2026-10-14T08:00:00Z"}]}`
	run, res, err := c.StartRun(ctx, StartRun{Tenant: "org-a", Definition: "follow-up",
		Subject: SubjectRef{Property: "site-a", Type: "person", PID: "p1"}, Assignees: []TaskPerson{{Email: "ana@example.test"}}}, "k1")
	if err != nil || res.Status != 201 || len(run.Assignees) != 1 {
		t.Fatal(run, res, err)
	}
	f.expect("POST", "/api/workflows/runs")
	if !strings.Contains(f.last.body, `"assignees":[{"email":"ana@example.test"}]`) {
		t.Errorf("body %s", f.last.body)
	}

	f.status, f.answer = 200, `{"assignees":[],"added":[],"removed":["ana@example.test"]}`
	ch, err := c.SetRunAssignees(ctx, "r1", nil, actor)
	if err != nil || len(ch.Removed) != 1 {
		t.Fatal(ch, err)
	}
	f.expect("PUT", "/api/workflows/runs/r1/assignees")
	if !strings.Contains(f.last.body, `"assignees":[]`) {
		t.Errorf("an empty list is sent, not null: %s", f.last.body)
	}

	f.answer = `{"assignees":[{"email":"ben@example.test","source":"manual","assigned_by":{},"assigned_at":"2026-10-14T08:00:00Z"}]}`
	got, err := c.RunAssignees(ctx, "r1")
	if err != nil || len(got) != 1 || got[0].Email != "ben@example.test" {
		t.Fatal(got, err)
	}
	f.expect("GET", "/api/workflows/runs/r1/assignees")

	f.answer = `{"uid":"d1","code":"follow-up"}`
	def, res, err := c.InstallTemplate(ctx, "follow-up", "org-a", "i1", actor)
	if err != nil || res.Status != 200 || def.Code != "follow-up" {
		t.Fatal(def, res, err)
	}
	f.expect("POST", "/api/workflows/templates/follow-up/install")
	if f.bodyField("tenant") != "org-a" || f.last.headers.Get("Idempotency-Key") != "i1" {
		t.Errorf("body %s headers %v", f.last.body, f.last.headers)
	}
}
