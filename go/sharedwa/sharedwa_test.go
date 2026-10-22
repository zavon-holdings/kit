package sharedwa

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func server(t *testing.T, code int, body string, got *map[string]any) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer T" {
			t.Errorf("no credential")
		}
		raw, _ := io.ReadAll(r.Body)
		if got != nil && len(raw) > 0 {
			_ = json.Unmarshal(raw, got)
		}
		w.WriteHeader(code)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return New(srv.URL, func(r *http.Request) error { r.Header.Set("Authorization", "Bearer T"); return nil })
}

func TestSendWire(t *testing.T) {
	var got map[string]any
	c := server(t, 200, `{"message_id":"wamid.1","status":"sent"}`, &got)
	at := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	out, err := c.Send(context.Background(), Message{Tenant: "shofar", To: "+27825550101", Template: Ticket,
		Params: Params{Attendee: "Nomsa", Org: "Shofar", Event: "AMP CAMP"}, Image: "https://x/t.png",
		ConsentedAt: at, Ref: "eventcomms:1", Fallback: &Fallback{Email: "n@x.org", Subject: "s", Text: "t"}})
	if err != nil || out.MessageID != "wamid.1" {
		t.Fatalf("%+v %v", out, err)
	}
	p := got["params"].(map[string]any)
	if got["template"] != "booking_ticket" || p["attendee"] != "Nomsa" || got["consented_at"] != "2026-10-01T09:00:00Z" ||
		got["fallback"].(map[string]any)["email"] != "n@x.org" {
		t.Errorf("wire: %v", got)
	}
}

func TestRefusals(t *testing.T) {
	ctx := context.Background()
	if _, err := server(t, 409, `{"error":"stopped"}`, nil).Send(ctx, Message{}); !errors.Is(err, ErrStopped) {
		t.Errorf("409 stopped = %v", err)
	}
	for _, code := range []string{CodeUnconfigured, CodeNotApproved} {
		if _, err := server(t, 503, `{"error":"`+code+`"}`, nil).Send(ctx, Message{}); !errors.Is(err, ErrUnconfigured) {
			t.Errorf("503 %s = %v", code, err)
		}
	}
	_, err := server(t, 502, `{"error":"meta_refused","detail":"(#131026) undeliverable"}`, nil).Send(ctx, Message{})
	var e *Error
	if !errors.As(err, &e) || e.Code != CodeMetaRefused || e.Detail == "" {
		t.Errorf("502 = %v", err)
	}
	if _, err := (*Client)(nil).State(ctx); !errors.Is(err, ErrUnconfigured) {
		t.Errorf("nil client = %v", err)
	}
}

func TestReady(t *testing.T) {
	s := Shared{Configured: true, Templates: map[string]string{Ticket: "APPROVED", Reminder: "PENDING"}}
	if !s.Ready(Ticket) || s.Ready(Reminder) || s.Ready(Update) || (Shared{Templates: s.Templates}).Ready(Ticket) {
		t.Error("ready")
	}
}
