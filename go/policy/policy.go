// Package policy decides "may this person do this to that?".
//
// One evaluator and one vocabulary, so every service that decides does so
// with identical bytes:
//
//	action     <app>:<type>:<verb>          mail:message:send
//	resource   org/<slug>/<app>/<type>/<id> org/org-a/mail/message/Q3ZkY5o2QI2f1o8rP9sJ6w
//
// Deny beats Allow; nothing matching is Deny. Ids in resources are PUBLIC ids.
package policy

import (
	"encoding/json"
	"fmt"
	"strings"
)

type Effect string

const (
	Allow Effect = "Allow"
	Deny  Effect = "Deny"
)

type Statement struct {
	Sid       string   `json:"sid,omitempty"`
	Effect    Effect   `json:"effect"`
	Actions   []string `json:"actions"`
	Resources []string `json:"resources"`
}

type Document struct {
	Statements []Statement `json:"statements"`
}

// Parse validates a document at save time: a statement that can never match,
// or an effect that is neither, is refused rather than stored.
func Parse(raw json.RawMessage) (Document, error) {
	var d Document
	if err := json.Unmarshal(raw, &d); err != nil {
		return d, fmt.Errorf("policy: not a document: %w", err)
	}
	if len(d.Statements) == 0 {
		return d, fmt.Errorf("policy: a document needs at least one statement")
	}
	for i, s := range d.Statements {
		if s.Effect != Allow && s.Effect != Deny {
			return d, fmt.Errorf("policy: statement %d: effect must be Allow or Deny", i+1)
		}
		if len(s.Actions) == 0 || len(s.Resources) == 0 {
			return d, fmt.Errorf("policy: statement %d: actions and resources must both be non-empty", i+1)
		}
		for _, a := range s.Actions {
			if a != "*" && strings.Count(a, ":") != 2 {
				return d, fmt.Errorf("policy: statement %d: action %q is not app:type:verb", i+1, a)
			}
		}
	}
	return d, nil
}

// Decision is the answer and why.
type Decision struct {
	Allowed bool
	// Sid of the statement that decided it, for the audit line.
	By string
}

// Decide applies the algorithm to every statement reachable for a principal.
func Decide(stmts []Statement, action, resource string) Decision {
	var allow *Statement
	for i := range stmts {
		s := &stmts[i]
		if !matchesAny(s.Actions, action) || !matchesAny(s.Resources, resource) {
			continue
		}
		if s.Effect == Deny {
			return Decision{Allowed: false, By: s.Sid}
		}
		if allow == nil {
			allow = s
		}
	}
	if allow != nil {
		return Decision{Allowed: true, By: allow.Sid}
	}
	return Decision{}
}

func matchesAny(patterns []string, s string) bool {
	for _, p := range patterns {
		if Match(p, s) {
			return true
		}
	}
	return false
}

// Match is the original evaluator's: "*" matches anything; otherwise segments split on ":"
// (actions) or "/" (resources) match one by one, "*" inside a segment is a
// glob, and a trailing "*" segment swallows the rest.
func Match(pattern, s string) bool {
	if pattern == "*" {
		return true
	}
	sep := ":"
	if strings.Contains(pattern, "/") {
		sep = "/"
	}
	return matchSegments(strings.Split(pattern, sep), strings.Split(s, sep))
}

func matchSegments(pp, ss []string) bool {
	if len(pp) != len(ss) {
		if len(pp) > 0 && pp[len(pp)-1] == "*" && len(ss) >= len(pp)-1 {
			head := pp[:len(pp)-1]
			return matchSegments(head, ss[:len(head)])
		}
		return false
	}
	for i := range pp {
		if !segMatch(pp[i], ss[i]) {
			return false
		}
	}
	return true
}

func segMatch(pat, s string) bool {
	if pat == "*" {
		return true
	}
	if !strings.Contains(pat, "*") {
		return pat == s
	}
	parts := strings.Split(pat, "*")
	idx := 0
	for i, p := range parts {
		if p == "" {
			continue
		}
		j := strings.Index(s[idx:], p)
		if j < 0 {
			return false
		}
		if i == 0 && j != 0 {
			return false // anchored start
		}
		idx += j + len(p)
	}
	if last := parts[len(parts)-1]; last != "" && !strings.HasSuffix(s, last) {
		return false // anchored end
	}
	return true
}
