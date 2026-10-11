package aiclient

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// The AI wire vectors: the bodies a property sends and the answers the
// gateway gives, as this client marshals and reads them. The gateway's CI
// replays them against its handlers; a consumer's CI against its vendored
// kit. A vector changing is a wire change.
//
// KIT_WRITE_VECTORS=1 go test ./aiclient -run TestAIContractVectors rewrites
// contract/ai/*.json (not contract/ai/tools, which are written by hand);
// otherwise the files are checked.

type vector struct {
	path string
	body any
}

func ptrB(b bool) *bool       { return &b }
func ptrF(f float64) *float64 { return &f }
func ptrI(i int) *int         { return &i }
func ptrI64(i int64) *int64   { return &i }

func aiVectors() []vector {
	in := json.RawMessage(`{"question":"How do I add a page?","product":"pages"}`)
	return []vector{
		{"invoke-request.json", InvokeRequest{
			Tenant: "org-a", Actor: Actor{Email: "editor@example.test", Sub: "u_101"},
			ToolKey: "platform.docs.answer", Resource: "org/org-a", Input: in,
		}},
		{"invoke-response.json", InvokeResult{
			Result:         json.RawMessage(`{"answer":"Open Pages and select New page.","citations":[{"title":"Pages","url":"https://www.zavonpages.com/docs/pages"}]}`),
			CreditsCharged: 0, Balance: 98.5, UsageEventID: "6f1c2b9e-1a7d-4c51-9a0e-6c3f1d2b8a10",
		}},
		{"status-ready.json", Status{
			State: StateReady, BalanceTenths: 985, MonthlyCapTenths: 5000, MonthlyCap: 500, MonthUsedTenths: 140,
			Tools: []ToolStatus{
				{Key: "pages.section.generate", Credits: 14, PricingMode: PricingFixed, Allowed: true},
				{Key: "pages.page.generate", Credits: 40, PricingMode: PricingMetered, Allowed: true},
				{Key: "platform.docs.answer", Credits: 0, PricingMode: PricingFree, Allowed: true},
			},
		}},
		{"status-not-configured.json", Status{State: StateNotConfigured, Tools: []ToolStatus{}}},
		{"status-off.json", Status{State: StateOff, Layer: "org", Tools: []ToolStatus{}}},
		{"status-no-permission.json", Status{
			State: StateNoPermission, BalanceTenths: 985,
			Tools: []ToolStatus{
				{Key: "pages.section.generate", Credits: 14, PricingMode: PricingFixed, Allowed: false, Reason: "missing_permission"},
				{Key: "platform.docs.answer", Credits: 0, PricingMode: PricingFree, Allowed: true},
			},
		}},
		{"jobs-accepted.json", JobAccepted{JobID: "0c9a7f5e-3b1d-4e2a-8f6b-2d4c6e8a0b1c", Status: JobQueued}},
		{"job-done.json", Job{
			ID: "0c9a7f5e-3b1d-4e2a-8f6b-2d4c6e8a0b1c", Status: JobDone,
			Result:         json.RawMessage(`{"title":"About us","blocks":[{"type":"heading","data":{"text":"About us"}}],"summary":"One heading."}`),
			CreditsCharged: 12.5, Balance: 86, UsageEventID: "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b",
		}},
		{"feedback.json", Feedback{
			Tenant: "org-a", UsageEventID: "6f1c2b9e-1a7d-4c51-9a0e-6c3f1d2b8a10",
			Accepted: ptrB(true), EditRatio: ptrF(0.12), Rating: ptrI(1), Comment: "Useful.",
		}},
		{"org-summary.json", OrgSummary{
			Tenant: "org-a", State: StateReady,
			Features:      map[string]bool{"ai": true, "ai.pages": true, "ai.reach": false, "ai.shop": false},
			BalanceTenths: 985, MonthlyCapTenths: 5000, MonthUsedTenths: 140,
			PopiaNoticeAcceptedAt: "2026-10-12T08:00:00Z", PopiaNoticeAcceptedBy: "admin@example.test",
			Widgets: map[string]json.RawMessage{
				"AIU-02": json.RawMessage(`{"rows":[{"tool_key":"pages.section.generate","calls":3,"tokens":12000,"credits_tenths":420}]}`),
			},
			Ledger: []LedgerLine{{At: "2026-10-12T08:05:00Z", DeltaTenths: -140, Reason: "debit", Ref: "6f1c2b9e-1a7d-4c51-9a0e-6c3f1d2b8a10", Actor: "editor@example.test"}},
		}},
		{"org-settings.json", OrgSettings{
			Actor: Actor{Email: "admin@example.test", Sub: "u_7"}, MonthlyCapTenths: ptrI64(5000), AcceptPopiaNotice: ptrB(true),
		}},
		{filepath.Join("errors", "insufficient-credits.json"), map[string]any{
			"error": "There are not enough credits for this.", "code": CodeInsufficientCredits,
			"required": 14, "balance": 3.5, "required_tenths": 140, "balance_tenths": 35, "credits_charged": 0,
		}},
		{filepath.Join("errors", "missing-permission.json"), map[string]any{
			"error": "You do not have the permission this needs.", "code": CodeMissingPermission,
			"required": "pages:ai:use", "credits_charged": 0,
		}},
		{filepath.Join("errors", "off.json"), map[string]any{
			"error": "AI assistance is off.", "code": CodeOff, "layer": "org", "credits_charged": 0,
		}},
		{filepath.Join("errors", "not-configured.json"), map[string]any{
			"error": "AI assistance is not set up on this platform.", "code": CodeNotConfigured, "credits_charged": 0,
		}},
		{filepath.Join("errors", "invalid-body.json"), map[string]any{
			"error": "The body is not what this route takes: json: unknown field \"permission\"", "code": CodeInvalidBody, "credits_charged": 0,
		}},
	}
}

func TestAIContractVectors(t *testing.T) {
	root := filepath.Join("..", "..", "contract", "ai")
	if os.Getenv("KIT_WRITE_VECTORS") == "1" {
		for _, v := range aiVectors() {
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
	for _, v := range aiVectors() {
		raw, err := os.ReadFile(filepath.Join(root, v.path))
		if err != nil {
			t.Fatalf("%s: %v (run with KIT_WRITE_VECTORS=1)", v.path, err)
		}
		want, _ := json.MarshalIndent(v.body, "", "  ")
		if !bytes.Equal(bytes.TrimSpace(raw), want) {
			t.Errorf("%s differs from what this client marshals:\n%s\nwant\n%s", v.path, raw, want)
		}
	}

	// The answers read back into the client's types.
	var e Error
	raw, _ := os.ReadFile(filepath.Join(root, "errors", "insufficient-credits.json"))
	if err := json.Unmarshal(raw, &e); err != nil || e.Code != CodeInsufficientCredits || e.RequiredCredits() != 14 || *e.Balance != 3.5 {
		t.Fatalf("errors/insufficient-credits: %+v %v", e, err)
	}
	e = Error{}
	raw, _ = os.ReadFile(filepath.Join(root, "errors", "missing-permission.json"))
	if err := json.Unmarshal(raw, &e); err != nil || e.RequiredPermission() != "pages:ai:use" {
		t.Fatalf("errors/missing-permission: %+v %v", e, err)
	}
	var st Status
	raw, _ = os.ReadFile(filepath.Join(root, "status-ready.json"))
	if err := json.Unmarshal(raw, &st); err != nil || !st.Shown() {
		t.Fatalf("status-ready: %+v %v", st, err)
	}
	if tool, ok := st.Tool("pages.page.generate"); !ok || tool.PricingMode != PricingMetered || tool.Credits != 40 {
		t.Fatalf("status-ready tool: %+v", tool)
	}
	raw, _ = os.ReadFile(filepath.Join(root, "status-not-configured.json"))
	st = Status{}
	if err := json.Unmarshal(raw, &st); err != nil || st.Shown() {
		t.Fatalf("status-not-configured is shown: %+v %v", st, err)
	}
}

// The request has no permission field and no price field, and it never
// will: the gateway holds both. A field added here by mistake would be a
// wire change the gateway refuses with a 400.
func TestInvokeRequestCarriesNoPermissionOrPrice(t *testing.T) {
	raw, _ := json.Marshal(InvokeRequest{})
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if got := strings.Join(keys, ","); got != "actor,input,resource,tenant,tool_key" {
		t.Fatalf("InvokeRequest fields are %s", got)
	}
}

// The tool vectors (contract/ai/tools/<key>.json) are written by hand:
// {"tool_key", "mode", "input", "result"}. Each must be an object pair, and
// every tool the contract names must have one.
func TestToolVectorsAreComplete(t *testing.T) {
	want := []string{
		"pages.block.tweak", "pages.section.generate", "pages.page.generate", "pages.brand.suggest", "pages.seo.meta",
		"reach.issue.draft", "reach.issue.polish", "reach.subject.variants", "reach.sms.optimise",
		"reach.audience.suggest", "reach.comms.check",
		"shop.product.details", "shop.catalogue.enrich", "platform.docs.answer",
	}
	dir := filepath.Join("..", "..", "contract", "ai", "tools")
	for _, key := range want {
		raw, err := os.ReadFile(filepath.Join(dir, key+".json"))
		if err != nil {
			t.Errorf("%s: %v", key, err)
			continue
		}
		var v struct {
			ToolKey string                     `json:"tool_key"`
			Mode    string                     `json:"mode"`
			Input   map[string]json.RawMessage `json:"input"`
			Result  map[string]json.RawMessage `json:"result"`
		}
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Errorf("%s: %v", key, err)
			continue
		}
		if v.ToolKey != key || (v.Mode != "inline" && v.Mode != "job") || len(v.Input) == 0 || len(v.Result) == 0 {
			t.Errorf("%s: incomplete vector %+v", key, v)
		}
	}
}
