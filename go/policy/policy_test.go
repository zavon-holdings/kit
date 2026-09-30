package policy

import (
	"encoding/json"
	"testing"
)

func TestMatch(t *testing.T) {
	for _, tc := range []struct {
		pat, s string
		want   bool
	}{
		{"*", "anything:at:all", true},
		{"reach:publication:send", "reach:publication:send", true},
		{"reach:publication:*", "reach:publication:send", true},
		{"reach:*:read", "reach:audience:read", true},
		{"reach:*:read", "reach:audience:send", false},
		{"pages:page:*", "reach:page:read", false},
		{"org/shofar/reach/publication/*", "org/shofar/reach/publication/Q3ZkY5o2", true},
		{"org/shofar/reach/*", "org/shofar/reach/publication/Q3ZkY5o2", true},          // trailing * swallows
		{"org/shofar/pages/page/news-*", "org/shofar/pages/page/news-2026-09", true},   // glob in a segment
		{"org/shofar/pages/page/news-*", "org/shofar/pages/page/events-news-1", false}, // anchored
		{"org/shofar/reach/publication/*", "org/doxadeo/reach/publication/Q3ZkY5o2", false},
		{"org/shofar/reach/publication/A", "org/shofar/reach/publication/AB", false},
	} {
		if got := Match(tc.pat, tc.s); got != tc.want {
			t.Errorf("Match(%q, %q) = %v, want %v", tc.pat, tc.s, got, tc.want)
		}
	}
}

// Deny beats Allow; nothing matching is Deny. The audit gets the deciding sid.
func TestDecide(t *testing.T) {
	stmts := []Statement{
		{Sid: "editor", Effect: Allow, Actions: []string{"reach:publication:*"}, Resources: []string{"org/shofar/reach/publication/*"}},
		{Sid: "no-send", Effect: Deny, Actions: []string{"reach:publication:send"}, Resources: []string{"org/shofar/reach/publication/locked"}},
	}
	for _, tc := range []struct {
		action, resource string
		want             bool
		by               string
	}{
		{"reach:publication:edit", "org/shofar/reach/publication/a", true, "editor"},
		{"reach:publication:send", "org/shofar/reach/publication/a", true, "editor"},
		{"reach:publication:send", "org/shofar/reach/publication/locked", false, "no-send"},
		{"reach:publication:edit", "org/doxadeo/reach/publication/a", false, ""},
		{"reach:audience:read", "org/shofar/reach/audience/students", false, ""},
	} {
		d := Decide(stmts, tc.action, tc.resource)
		if d.Allowed != tc.want || d.By != tc.by {
			t.Errorf("Decide(%s, %s) = %+v, want allowed=%v by=%q", tc.action, tc.resource, d, tc.want, tc.by)
		}
	}
	if Decide(nil, "reach:publication:edit", "org/shofar/reach/publication/a").Allowed {
		t.Error("no statements must be Deny")
	}
}

func TestParseRefusesWhatCannotMatch(t *testing.T) {
	for _, raw := range []string{
		`{}`, `{"statements":[]}`,
		`{"statements":[{"effect":"Maybe","actions":["a:b:c"],"resources":["*"]}]}`,
		`{"statements":[{"effect":"Allow","actions":[],"resources":["*"]}]}`,
		`{"statements":[{"effect":"Allow","actions":["reach:send"],"resources":["*"]}]}`,
	} {
		if _, err := Parse(json.RawMessage(raw)); err == nil {
			t.Errorf("Parse(%s) = nil error", raw)
		}
	}
	if _, err := Parse(json.RawMessage(`{"statements":[{"effect":"Allow","actions":["*"],"resources":["*"]}]}`)); err != nil {
		t.Errorf("a full-access document must parse: %v", err)
	}
}
