// Package merge3 is a three-way merge of ordered trees: a document of
// blocks, an outline of sections, any structure that is a tree of keyed
// units with fields and named child lists.
//
// A Unit has a key, a kind, fields (path → JSON value) and slots (name →
// ordered child units). Merge takes the common ancestor and two edited
// copies and returns the merged tree with the conflicts it could not
// decide; Resolve applies a decision per conflict. The TypeScript twin is
// @zavon/merge3; both replay the vectors in contract/merge3.
//
// The rules, in brief:
//
//   - Units are matched by key. A unit without a key is matched to a
//     keyless unit of the ancestor under the same parent and slot: first
//     by identical kind and content, then by a longest common subsequence
//     of kinds. Keys beginning with "~" are reserved.
//   - Fields merge one path at a time: one side unchanged takes the other,
//     both the same takes it, otherwise a "field" conflict (tentatively A).
//     The kind is merged as the field "@kind".
//   - A unit deleted on one side and changed on the other (its fields, its
//     place or anything beneath it) is a "delete" conflict and is
//     tentatively kept. A unit deleted on one side and untouched on the
//     other is deleted.
//   - A unit's place (parent and slot) merges like a field, "@parent"; two
//     different moves are a "move" conflict (tentatively A). Moves that
//     would make a unit its own ancestor are "move" conflicts too.
//   - The order of each slot merges three ways over the units both sides
//     kept there; two different reorders are an "order" conflict
//     (tentatively A). Additions are placed after their nearest surviving
//     earlier sibling, A's before B's at the same place.
package merge3

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Root is the key conflicts use for the root unit's place.
const Root = "~"

// Unit is one node of the tree.
type Unit struct {
	Key    string            `json:"key,omitempty"`
	Kind   string            `json:"kind"`
	Fields map[string]any    `json:"fields,omitempty"`
	Slots  map[string][]Unit `json:"slots,omitempty"`
}

// MarshalJSON writes the unit canonically: object keys sorted, an empty
// key, fields or slots map left out.
func (u Unit) MarshalJSON() ([]byte, error) { return []byte(Canonical(u.Value())), nil }

// Value is the unit as plain JSON values (map[string]any, []any, …).
func (u Unit) Value() map[string]any {
	m := map[string]any{"kind": u.Kind}
	if u.Key != "" {
		m["key"] = u.Key
	}
	if len(u.Fields) > 0 {
		f := make(map[string]any, len(u.Fields))
		for k, v := range u.Fields {
			f[k] = normalize(v)
		}
		m["fields"] = f
	}
	if len(u.Slots) > 0 {
		s := make(map[string]any, len(u.Slots))
		for name, kids := range u.Slots {
			arr := make([]any, len(kids))
			for i, k := range kids {
				arr[i] = k.Value()
			}
			s[name] = arr
		}
		m["slots"] = s
	}
	return m
}

// Place is where a unit sits: its parent's key and the slot's name.
type Place struct {
	Parent string `json:"parent"`
	Slot   string `json:"slot"`
}

func (p Place) value() any { return map[string]any{"parent": p.Parent, "slot": p.Slot} }

// Conflict kinds.
const (
	KindField  = "field"
	KindDelete = "delete"
	KindMove   = "move"
	KindOrder  = "order"
)

// Conflict is one thing the merge could not decide. ID is stable: the
// kind, the unit's key and the path. Base, A and B hold each side's value
// where the side has one (HasBase, HasA, HasB): a field's value, a place
// ({parent, slot}) or an order (the keys both sides kept, in order).
type Conflict struct {
	ID      string
	Kind    string
	Key     string
	Path    string
	Side    string // delete: the side that deleted, "a" or "b"
	Base    any
	A       any
	B       any
	HasBase bool
	HasA    bool
	HasB    bool
}

// Value is the conflict as plain JSON values.
func (c Conflict) Value() map[string]any {
	m := map[string]any{"id": c.ID, "kind": c.Kind, "key": c.Key}
	if c.Kind != KindDelete {
		m["path"] = c.Path
	}
	if c.Side != "" {
		m["side"] = c.Side
	}
	if c.HasBase {
		m["base"] = c.Base
	}
	if c.HasA {
		m["a"] = c.A
	}
	if c.HasB {
		m["b"] = c.B
	}
	return m
}

// MarshalJSON writes the conflict canonically.
func (c Conflict) MarshalJSON() ([]byte, error) { return []byte(Canonical(c.Value())), nil }

// Choices for a Decision.
const (
	ChooseA      = "a"
	ChooseB      = "b"
	ChooseBoth   = "both"
	ChooseManual = "manual"
)

// Decision settles one conflict. Value is required for "manual": a field's
// value, true or false (keep) for a delete, a Place for a move, the keys in
// order for an order.
type Decision struct {
	Choice   string
	Value    any
	HasValue bool
}

// UnmarshalJSON reads {"choice": …, "value": …}; a present value, even
// null, sets HasValue.
func (d *Decision) UnmarshalJSON(b []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	if c, ok := raw["choice"]; ok {
		if err := json.Unmarshal(c, &d.Choice); err != nil {
			return err
		}
	}
	if v, ok := raw["value"]; ok {
		d.HasValue = true
		if err := json.Unmarshal(v, &d.Value); err != nil {
			return err
		}
	}
	return nil
}

// MarshalJSON writes {"choice", "value"?}.
func (d Decision) MarshalJSON() ([]byte, error) {
	m := map[string]any{"choice": d.Choice}
	if d.HasValue {
		m["value"] = d.Value
	}
	return []byte(Canonical(m)), nil
}

// Options shape Resolve.
type Options struct {
	// DuplicateAsUnits lets "both" settle a field conflict by keeping the
	// unit twice: A's value, then a copy with B's value and a fresh key.
	DuplicateAsUnits bool
	// MintKey names a copy. It must return a key for which taken is
	// false. The default appends "~b", then "~b2", "~b3", ….
	MintKey func(old string, taken func(string) bool) string
}

// Result is a merge: the tree with every conflict tentatively settled, and
// the conflicts, sorted by ID.
type Result struct {
	Tree       Unit
	Conflicts  []Conflict
	base, a, b Unit
}

// Resolution is a resolved merge. IDs maps the key of every unit "both"
// copied to its copy's key. Conflicts lists the ones no decision settled
// (they keep their tentative outcome).
type Resolution struct {
	Tree      Unit
	IDs       map[string]string
	Conflicts []Conflict
}

// ErrInvalid wraps every refusal of an input tree.
var ErrInvalid = errors.New("merge3: invalid tree")

// Validate checks a tree: every key unique and not reserved, slots hold
// units.
func Validate(root Unit) error {
	seen := map[string]bool{}
	var walk func(u Unit, path string) error
	walk = func(u Unit, path string) error {
		if u.Key != "" {
			if strings.HasPrefix(u.Key, "~") {
				return fmt.Errorf("%w: %s: key %q begins with the reserved \"~\"", ErrInvalid, path, u.Key)
			}
			if seen[u.Key] {
				return fmt.Errorf("%w: %s: key %q appears twice", ErrInvalid, path, u.Key)
			}
			seen[u.Key] = true
		}
		for _, name := range sortedKeys(u.Slots) {
			for i, k := range u.Slots[name] {
				if err := walk(k, fmt.Sprintf("%s.%s[%d]", path, name, i)); err != nil {
					return err
				}
			}
		}
		return nil
	}
	return walk(root, "root")
}

// Merge merges a and b, two edits of base.
func Merge(base, a, b Unit) (*Result, error) {
	for _, t := range []Unit{base, a, b} {
		if err := Validate(t); err != nil {
			return nil, err
		}
	}
	out, err := run(base, a, b, nil, Options{})
	if err != nil {
		return nil, err
	}
	return &Result{Tree: out.tree, Conflicts: out.conflicts, base: base, a: a, b: b}, nil
}

// Resolve settles the conflicts named in decisions and rebuilds the tree.
// A decision for a conflict the merge did not report is an error, as is
// "both" on an order, "both" on a field without DuplicateAsUnits, and
// "manual" without a value.
func (r *Result) Resolve(decisions map[string]Decision, opts Options) (*Resolution, error) {
	byID := map[string]Conflict{}
	for _, c := range r.Conflicts {
		byID[c.ID] = c
	}
	for id, d := range decisions {
		c, ok := byID[id]
		if !ok {
			return nil, fmt.Errorf("merge3: no conflict %q", id)
		}
		switch d.Choice {
		case ChooseA, ChooseB:
		case ChooseManual:
			if !d.HasValue {
				return nil, fmt.Errorf("merge3: %s: manual needs a value", id)
			}
		case ChooseBoth:
			switch c.Kind {
			case KindOrder:
				return nil, fmt.Errorf("merge3: %s: an order has no \"both\"", id)
			case KindField:
				if !opts.DuplicateAsUnits {
					return nil, fmt.Errorf("merge3: %s: a field has no \"both\"; duplicate the unit or decide by hand", id)
				}
				if c.Key == Root {
					return nil, fmt.Errorf("merge3: %s: the root cannot be duplicated", id)
				}
			}
		default:
			return nil, fmt.Errorf("merge3: %s: unknown choice %q", id, d.Choice)
		}
	}
	out, err := run(r.base, r.a, r.b, decisions, opts)
	if err != nil {
		return nil, err
	}
	var left []Conflict
	for _, c := range out.conflicts {
		if _, ok := decisions[c.ID]; !ok {
			left = append(left, c)
		}
	}
	return &Resolution{Tree: out.tree, IDs: out.ids, Conflicts: left}, nil
}
