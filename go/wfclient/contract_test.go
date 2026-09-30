package wfclient

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The public-wire vectors: the bodies an app sends and the answers core
// gives, as this client marshals and reads them. Core's CI replays them
// against its handlers (a guard in admin/backend/app/api); a consumer's CI
// against its vendored kit. A vector changing is a wire change.
//
// KIT_WRITE_VECTORS=1 go test ./wfclient -run TestContractVectors rewrites
// contract/{events,runs,errors}/*.json; otherwise the files are checked.

type vector struct {
	path string
	body any
}

func vectors() []vector {
	at := time.Date(2026, 9, 30, 10, 0, 0, 0, time.UTC)
	return []vector{
		{filepath.Join("events", "request.json"), Event{
			Type: "shop.order.paid", Ref: "ord_1001", Tenant: "shofar", OccurredAt: &at,
			Subject: &SubjectRef{Property: "zavon-shop", Type: "order", PID: "ord_1001", Label: "Order #1001", URL: "https://example.test/orders/1001"},
			Vars:    map[string]any{"total_cents": 12500, "currency": "ZAR"},
		}},
		{filepath.Join("events", "response.json"), EventResult{EventUID: "ev_01J9", Matched: 1, Advanced: true}},
		{filepath.Join("events", "batch-response.json"), struct {
			Results []EventResult `json:"results"`
		}{[]EventResult{
			{Index: 0, Status: 202, EventUID: "ev_01J9", Matched: 1, Advanced: true},
			{Index: 1, Status: 403, Error: "shofar's shop.* events are not this property's to raise", Code: "namespace"},
		}}},
		{filepath.Join("runs", "start.json"), StartRun{
			Tenant: "shofar", Definition: "page-review",
			Subject: SubjectRef{Property: "pages-by-zavon", Type: "page", PID: "p_42", Label: "Easter", URL: "https://example.test/pages/p_42"},
			Vars:    map[string]any{"scope": "site"},
		}},
		{filepath.Join("errors", "shape.json"), struct {
			Error  string          `json:"error"`
			Code   string          `json:"code"`
			Detail json.RawMessage `json:"detail,omitempty"`
		}{"That page already has a live review.", "run_already_live", json.RawMessage(`{"run_uid":"r_7"}`)}},
	}
}

func TestContractVectors(t *testing.T) {
	root := filepath.Join("..", "..", "contract")
	if os.Getenv("KIT_WRITE_VECTORS") == "1" {
		for _, v := range vectors() {
			raw, err := json.MarshalIndent(v.body, "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			p := filepath.Join(root, v.path)
			if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(p, append(raw, '\n'), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, v := range vectors() {
		raw, err := os.ReadFile(filepath.Join(root, v.path))
		if err != nil {
			t.Fatalf("%s: %v (run with KIT_WRITE_VECTORS=1)", v.path, err)
		}
		want, _ := json.MarshalIndent(v.body, "", "  ")
		if !bytes.Equal(bytes.TrimSpace(raw), want) {
			t.Errorf("%s differs from what this client marshals:\n%s\nwant\n%s", v.path, raw, want)
		}
	}

	// The recorded answers read back into the client's types.
	raw, _ := os.ReadFile(filepath.Join(root, "events", "response.json"))
	var ev EventResult
	if err := json.Unmarshal(raw, &ev); err != nil || ev.EventUID != "ev_01J9" || ev.Matched != 1 || !ev.Advanced {
		t.Fatalf("events/response: %+v %v", ev, err)
	}
	raw, _ = os.ReadFile(filepath.Join(root, "errors", "shape.json"))
	var e Error
	if err := json.Unmarshal(raw, &e); err != nil || e.Code != "run_already_live" || e.Message == "" || len(e.Detail) == 0 {
		t.Fatalf("errors/shape: %+v %v", e, err)
	}
	raw, _ = os.ReadFile(filepath.Join(root, "runs", "start.json"))
	var sr StartRun
	if err := json.Unmarshal(raw, &sr); err != nil || sr.Subject.PID != "p_42" || sr.Definition != "page-review" {
		t.Fatalf("runs/start: %+v %v", sr, err)
	}
}
