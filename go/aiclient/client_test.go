package aiclient

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestTheTokenIsReadOnEveryRequest(t *testing.T) {
	var mu sync.Mutex
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen = append(seen, r.Header.Get("Authorization"))
		mu.Unlock()
		_, _ = io.WriteString(w, `{"state":"ready","tools":[]}`)
	}))
	defer srv.Close()

	t.Setenv("KIT_TEST_TOKEN", "")
	t.Setenv("KIT_TEST_OIDC", "first")
	c := New(srv.URL, EnvToken("KIT_TEST_TOKEN", "KIT_TEST_OIDC"))
	if _, err := c.Status(context.Background(), "org-a", "A@Example.test", ""); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KIT_TEST_OIDC", "rotated")
	if _, err := c.Status(context.Background(), "org-a", "a@example.test", ""); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KIT_TEST_TOKEN", "issued")
	if _, err := c.Status(context.Background(), "org-a", "a@example.test", ""); err != nil {
		t.Fatal(err)
	}
	want := []string{"Bearer first", "Bearer rotated", "Bearer issued"}
	if strings.Join(seen, "|") != strings.Join(want, "|") {
		t.Fatalf("authorization headers %v, want %v", seen, want)
	}
}

func TestInvokeSendsTheKeyAndTheBodyAndReadsTheAnswer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/ai/invoke" {
			t.Errorf("%s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Idempotency-Key") != "k-1" {
			t.Errorf("Idempotency-Key %q", r.Header.Get("Idempotency-Key"))
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var req InvokeRequest
		if err := dec.Decode(&req); err != nil {
			t.Errorf("body: %v", err)
		}
		w.Header().Set("Idempotent-Replay", "true")
		_, _ = io.WriteString(w, `{"result":{"text":"ok"},"credits_charged":1.4,"balance":10,"usage_event_id":"e1"}`)
	}))
	defer srv.Close()
	c := New(srv.URL, StaticToken("zvn_k.s"))
	res, meta, err := c.Invoke(context.Background(), "k-1", InvokeRequest{
		Tenant: "org-a", Actor: Actor{Email: "a@example.test"}, ToolKey: "reach.sms.optimise",
		Resource: "org/org-a", Input: json.RawMessage(`{"text":"x","max_segments":1,"merge_tags":[]}`),
	})
	if err != nil || !meta.Replayed || res.CreditsCharged != 1.4 || res.UsageEventID != "e1" || string(res.Result) != `{"text":"ok"}` {
		t.Fatalf("%+v %+v %v", res, meta, err)
	}
	if _, _, err := c.Invoke(context.Background(), "", InvokeRequest{}); err == nil {
		t.Fatal("an invoke with no Idempotency-Key was sent")
	}
}

func TestErrorsCarryTheirCodeAndStates(t *testing.T) {
	answers := map[string]struct {
		status int
		body   string
	}{
		"/off":     {503, `{"error":"off","code":"ai_off","layer":"org","credits_charged":0}`},
		"/nokey":   {503, `{"error":"not set up","code":"ai_not_configured"}`},
		"/down":    {503, `{"error":"down","code":"ai_unavailable"}`},
		"/broke":   {402, `{"error":"poor","code":"insufficient_credits","required":14,"balance":3.5}`},
		"/perm":    {403, `{"error":"no","code":"missing_permission","required":"pages:ai:use"}`},
		"/garbage": {502, `<html>bad gateway</html>`},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		a := answers[r.URL.Query().Get("tenant")]
		w.WriteHeader(a.status)
		_, _ = io.WriteString(w, a.body)
	}))
	defer srv.Close()
	c := New(srv.URL, StaticToken("t"))
	get := func(name string) error {
		_, err := c.Job(context.Background(), name, "j")
		return err
	}
	if err := get("/off"); !IsOff(err) || IsUnavailable(err) || IsNotConfigured(err) {
		t.Fatalf("off: %v", err)
	} else {
		var e *Error
		errors.As(err, &e)
		if e.Layer != "org" {
			t.Fatalf("layer %q", e.Layer)
		}
	}
	if err := get("/nokey"); !IsNotConfigured(err) || IsUnavailable(err) {
		t.Fatalf("nokey: %v", err)
	}
	if err := get("/down"); !IsUnavailable(err) {
		t.Fatalf("down: %v", err)
	}
	var e *Error
	if err := get("/broke"); !errors.As(err, &e) || e.RequiredCredits() != 14 || *e.Balance != 3.5 || e.Status != 402 {
		t.Fatalf("broke: %v", err)
	}
	if err := get("/perm"); !errors.As(err, &e) || e.RequiredPermission() != "pages:ai:use" {
		t.Fatalf("perm: %v", err)
	}
	if err := get("/garbage"); !errors.As(err, &e) || !strings.Contains(e.Message, "bad gateway") || !IsUnavailable(err) {
		t.Fatalf("garbage: %v", err)
	}
}

func TestAClientWithNothingConfiguredSaysSoWithoutCalling(t *testing.T) {
	c := New("", StaticToken(""))
	if c.Configured() {
		t.Fatal("configured with nothing")
	}
	if _, err := c.Status(context.Background(), "t", "a@x.test", ""); !IsNotConfigured(err) {
		t.Fatalf("%v", err)
	}
	if _, err := New("http://127.0.0.1:1", nil).Job(context.Background(), "t", "j"); !IsNotConfigured(err) {
		t.Fatalf("nil token: %v", err)
	}
	if _, err := New("http://127.0.0.1:1", StaticToken("t")).Job(context.Background(), "t", "j"); !IsUnavailable(err) || !errors.Is(err, ErrUnreachable) {
		t.Fatalf("unreachable: %v", err)
	}
}

func TestAnOperatorCredentialNamesItsProperty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("property") != "store-a" {
			t.Errorf("property %q", r.URL.Query().Get("property"))
		}
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer srv.Close()
	one := 1
	err := New(srv.URL, StaticToken("t"), WithProperty("store-a")).SendFeedback(context.Background(),
		Feedback{Tenant: "org-a", UsageEventID: "e", Rating: &one})
	if err != nil {
		t.Fatal(err)
	}
}
