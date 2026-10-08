package wfclient

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// The graph half of a definition (v1.7.0): what an app's editor saves beside
// the steps, what it reads back, and the dry walk. Pinned against the same
// recording fake as every other call.

func TestASaveCarriesTheGraphTheMigrationMapAndTheInterrupts(t *testing.T) {
	ctx := context.Background()
	f, c := newFakeCore(t)
	graph := json.RawMessage(`{"format":"workflow.graph/1","nodes":[{"id":"start","type":"start"}],"edges":[]}`)
	f.answer = `{"definition":{"uid":"d1","etag":"\"v2-x\""},"version":2,"versioned":true,"live_on_previous":{}}`
	saved, err := c.SaveDefinition(ctx, "d1", DefinitionInput{
		Tenant: "org-a", Code: "welcome", Name: "Welcome",
		Trigger:           TriggerInput{Kind: "manual"},
		Graph:             graph,
		MigrationMap:      map[string]string{"old": "new"},
		OnEvent:           json.RawMessage(`[{"event":"acme.thing.cancelled","goto":"end"}]`),
		OverrideScenarios: true,
	}, `"v1-abc"`)
	if err != nil || saved.Version != 2 {
		t.Fatal(saved, err)
	}
	f.expect("PUT", "/api/workflows/definitions/d1")
	if got := f.last.headers.Get("If-Match"); got != `"v1-abc"` {
		t.Errorf("If-Match = %q", got)
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal([]byte(f.last.body), &body); err != nil {
		t.Fatal(err)
	}
	if string(body["graph"]) != string(graph) {
		t.Errorf("the graph was not sent as written: %s", body["graph"])
	}
	if string(body["migration_map"]) != `{"old":"new"}` {
		t.Errorf("migration_map = %s", body["migration_map"])
	}
	if !strings.Contains(string(body["on_event"]), "acme.thing.cancelled") {
		t.Errorf("on_event = %s", body["on_event"])
	}
	if string(body["override_scenarios"]) != "true" {
		t.Errorf("override_scenarios = %s", body["override_scenarios"])
	}
}

func TestAStepsOnlySaveSendsNoGraphKeys(t *testing.T) {
	// A save from an app that has no drawing must not send "graph": null —
	// the service would read a present-but-empty graph as one to compile.
	ctx := context.Background()
	f, c := newFakeCore(t)
	f.answer = `{"definition":{"uid":"d1"},"version":1}`
	if _, err := c.SaveDefinition(ctx, "d1", DefinitionInput{Tenant: "org-a", Code: "c", Name: "C",
		Steps:   []StepInput{{Code: "a", Name: "A", Kind: "delay", Config: json.RawMessage(`{"value":1,"unit":"days"}`)}},
		Trigger: TriggerInput{Kind: "manual"}}, `"v1"`); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"graph", "migration_map", "on_event", "override_scenarios"} {
		if strings.Contains(f.last.body, `"`+key+`"`) {
			t.Errorf("a steps-only save sent %q: %s", key, f.last.body)
		}
	}
}

func TestADefinitionReadsBackItsDrawing(t *testing.T) {
	ctx := context.Background()
	f, c := newFakeCore(t)
	f.answer = `{"uid":"d1","tenant":"org-a","etag":"\"v3-q\"","graph":{"format":"workflow.graph/1","nodes":[],"edges":[]},"graph_source":"drawn","on_event":[{"event":"x.y","goto":"z"}]}`
	d, err := c.GetDefinition(ctx, "d1")
	if err != nil {
		t.Fatal(err)
	}
	if d.GraphSource != "drawn" || !strings.Contains(string(d.Graph), "workflow.graph/1") || !strings.Contains(string(d.OnEvent), "x.y") {
		t.Errorf("read %+v", d)
	}
	f.answer = `{"uid":"d2","graph_error":"a loop cannot be drawn yet"}`
	d, err = c.GetDefinition(ctx, "d2")
	if err != nil || d.GraphError != "a loop cannot be drawn yet" || len(d.Graph) != 0 {
		t.Errorf("read %+v, %v", d, err)
	}
}

func TestARefusedGraphNamesItsNodeAndEdge(t *testing.T) {
	ctx := context.Background()
	f, c := newFakeCore(t)
	f.answer = `{"problems":[{"code":"unreachable","node":"mail-2","message":"Nothing leads here."},{"code":"no_default","edge":{"from":"pick","to":"a"},"message":"One way out must be the default."}]}`
	problems, err := c.Validate(ctx, "d1", &DefinitionInput{Tenant: "org-a", Code: "c", Name: "C",
		Graph: json.RawMessage(`{"format":"workflow.graph/1"}`), Trigger: TriggerInput{Kind: "manual"}})
	if err != nil || len(problems) != 2 {
		t.Fatal(problems, err)
	}
	f.expect("POST", "/api/workflows/definitions/d1/validate")
	if problems[0].Node != "mail-2" || !strings.Contains(string(problems[1].Edge), `"from":"pick"`) {
		t.Errorf("problems %+v", problems)
	}

	// A refused save carries them in the error's detail, with the code.
	f.status = 422
	f.answer = `{"error":"Nothing leads here.","code":"invalid_graph","detail":{"problems":[{"code":"unreachable","node":"mail-2","message":"Nothing leads here."}]}}`
	_, err = c.SaveDefinition(ctx, "d1", DefinitionInput{Tenant: "org-a"}, `"v1"`)
	var e *Error
	if !errors.As(err, &e) || e.Code != "invalid_graph" || !strings.Contains(string(e.Detail), "mail-2") || IsUnavailable(err) {
		t.Errorf("refusal %v", err)
	}
}

func TestSimulateSendsTheSampleAndHandsBackTheWalk(t *testing.T) {
	ctx := context.Background()
	f, c := newFakeCore(t)
	f.answer = `{"path":["start","welcome"],"steps":[],"recipients":["a@example.test"],"stopped":null,"ended":{"outcome":"completed","at":"2026-01-01T00:00:00Z"},"vars":{}}`
	out, err := c.Simulate(ctx, "d1", Simulation{
		Graph:     json.RawMessage(`{"format":"workflow.graph/1"}`),
		Subject:   SubjectRef{Property: "acme", Type: "person", PID: "sample-1"},
		Decisions: map[string]string{"review": "approved"},
	})
	if err != nil {
		t.Fatal(err)
	}
	f.expect("POST", "/api/workflows/definitions/d1/simulate")
	if f.bodyField("decisions") == nil || !strings.Contains(f.last.body, `"pid":"sample-1"`) {
		t.Errorf("body %s", f.last.body)
	}
	if f.last.headers.Get("Idempotency-Key") != "" {
		t.Error("a simulation writes nothing and carries no idempotency key")
	}
	if !strings.Contains(string(out), `"path":["start","welcome"]`) {
		t.Errorf("walk %s", out)
	}
}

func TestTheCalendarIsReadAndWrittenWhole(t *testing.T) {
	ctx := context.Background()
	f, c := newFakeCore(t)
	f.answer = `{"tenant":"org-a","timezone":"Africa/Johannesburg","workweek":[2,3,4,5,6],"work_hours":{"start":"08:00","end":"16:00"},"holiday_region":"ZA","closures":[{"on":"2026-12-28","reason":"Shutdown"}]}`
	s, err := c.GetSettings(ctx, "org-a")
	if err != nil {
		t.Fatal(err)
	}
	f.expect("GET", "/api/workflows/settings")
	if f.last.query != "tenant=org-a" {
		t.Errorf("query %q", f.last.query)
	}
	if s.HolidayRegion != "ZA" || len(s.Closures) != 1 || s.Closures[0].Reason != "Shutdown" || s.Workweek[0] != 2 {
		t.Errorf("read %+v", s)
	}
	f.answer = `{}`
	if err := c.PutSettings(ctx, Settings{Tenant: "org-a", HolidayRegion: "ZA", QuietHours: map[string]string{"start": "20:00", "end": "07:00"},
		Closures: []Closure{{On: "2026-12-28", Reason: "Shutdown"}}}); err != nil {
		t.Fatal(err)
	}
	f.expect("PUT", "/api/workflows/settings")
	for _, want := range []string{`"holiday_region":"ZA"`, `"quiet_hours":{"end":"07:00","start":"20:00"}`, `"closures":[{"on":"2026-12-28","reason":"Shutdown"}]`} {
		if !strings.Contains(f.last.body, want) {
			t.Errorf("body %s lacks %s", f.last.body, want)
		}
	}
}

func TestATriggersConditionTreeSurvivesARoundTrip(t *testing.T) {
	// A trigger read with its tree and saved back must carry the tree: a
	// client struct without the field would clear somebody's filter on the
	// next save of anything else.
	ctx := context.Background()
	f, c := newFakeCore(t)
	f.answer = `{"uid":"d1","trigger":{"kind":"event","event_type":"acme.thing.made","filter":{"any":[{"field":"location","op":"is","value":"North"},{"field":"location","op":"is","value":"South"}]}}}`
	d, err := c.GetDefinition(ctx, "d1")
	if err != nil || d.Trigger == nil || !strings.Contains(string(d.Trigger.Filter), `"any"`) {
		t.Fatalf("read %+v %v", d.Trigger, err)
	}
	f.answer = `{"definition":{"uid":"d1"},"version":1}`
	if _, err := c.SaveDefinition(ctx, "d1", DefinitionInput{Tenant: "org-a", Code: "c", Name: "C", Trigger: *d.Trigger}, `"v1"`); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(f.last.body, `"filter":{"any":[`) {
		t.Errorf("the tree was not sent back: %s", f.last.body)
	}
	if strings.Contains(f.last.body, `"conditions"`) {
		t.Errorf("rows were sent beside the tree, which the service refuses: %s", f.last.body)
	}
}
