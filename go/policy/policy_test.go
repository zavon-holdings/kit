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
		{"mail:publication:send", "mail:publication:send", true},
		{"mail:publication:*", "mail:publication:send", true},
		{"mail:*:read", "mail:audience:read", true},
		{"mail:*:read", "mail:audience:send", false},
		{"cms:page:*", "mail:page:read", false},
		{"org/org-a/mail/publication/*", "org/org-a/mail/publication/Q3ZkY5o2", true},
		{"org/org-a/mail/*", "org/org-a/mail/publication/Q3ZkY5o2", true},        // trailing * swallows
		{"org/org-a/cms/page/news-*", "org/org-a/cms/page/news-2026-09", true},   // glob in a segment
		{"org/org-a/cms/page/news-*", "org/org-a/cms/page/events-news-1", false}, // anchored
		{"org/org-a/mail/publication/*", "org/org-b/mail/publication/Q3ZkY5o2", false},
		{"org/org-a/mail/publication/A", "org/org-a/mail/publication/AB", false},
	} {
		if got := Match(tc.pat, tc.s); got != tc.want {
			t.Errorf("Match(%q, %q) = %v, want %v", tc.pat, tc.s, got, tc.want)
		}
	}
}

// Deny beats Allow; nothing matching is Deny. The audit gets the deciding sid.
func TestDecide(t *testing.T) {
	stmts := []Statement{
		{Sid: "editor", Effect: Allow, Actions: []string{"mail:publication:*"}, Resources: []string{"org/org-a/mail/publication/*"}},
		{Sid: "no-send", Effect: Deny, Actions: []string{"mail:publication:send"}, Resources: []string{"org/org-a/mail/publication/locked"}},
	}
	for _, tc := range []struct {
		action, resource string
		want             bool
		by               string
	}{
		{"mail:publication:edit", "org/org-a/mail/publication/a", true, "editor"},
		{"mail:publication:send", "org/org-a/mail/publication/a", true, "editor"},
		{"mail:publication:send", "org/org-a/mail/publication/locked", false, "no-send"},
		{"mail:publication:edit", "org/org-b/mail/publication/a", false, ""},
		{"mail:audience:read", "org/org-a/mail/audience/students", false, ""},
	} {
		d := Decide(stmts, tc.action, tc.resource)
		if d.Allowed != tc.want || d.By != tc.by {
			t.Errorf("Decide(%s, %s) = %+v, want allowed=%v by=%q", tc.action, tc.resource, d, tc.want, tc.by)
		}
	}
	if Decide(nil, "mail:publication:edit", "org/org-a/mail/publication/a").Allowed {
		t.Error("no statements must be Deny")
	}
}

func TestParseRefusesWhatCannotMatch(t *testing.T) {
	for _, raw := range []string{
		`{}`, `{"statements":[]}`,
		`{"statements":[{"effect":"Maybe","actions":["a:b:c"],"resources":["*"]}]}`,
		`{"statements":[{"effect":"Allow","actions":[],"resources":["*"]}]}`,
		`{"statements":[{"effect":"Allow","actions":["mail:send"],"resources":["*"]}]}`,
	} {
		if _, err := Parse(json.RawMessage(raw)); err == nil {
			t.Errorf("Parse(%s) = nil error", raw)
		}
	}
	if _, err := Parse(json.RawMessage(`{"statements":[{"effect":"Allow","actions":["*"],"resources":["*"]}]}`)); err != nil {
		t.Errorf("a full-access document must parse: %v", err)
	}
}
