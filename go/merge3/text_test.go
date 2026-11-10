package merge3

import (
	"encoding/json"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func randText(r *rand.Rand) string {
	words := []string{"one", "two", "three", " ", "  ", "\n", "*", "_", "(", ")", "é", "4"}
	var sb strings.Builder
	for i := r.Intn(12); i > 0; i-- {
		sb.WriteString(words[r.Intn(len(words))])
	}
	return sb.String()
}

func editText(r *rand.Rand, s string) string {
	t := Tokens(s)
	for n := r.Intn(4); n > 0; n-- {
		i := 0
		if len(t) > 0 {
			i = r.Intn(len(t) + 1)
		}
		switch r.Intn(3) {
		case 0:
			t = append(t[:i], append([]string{randText(r)}, t[i:]...)...)
		case 1:
			if i < len(t) {
				t = append(t[:i], t[i+1:]...)
			}
		default:
			if i < len(t) {
				t[i] = randText(r)
			}
		}
	}
	return strings.Join(t, "")
}

// The text merge's own laws, over random edits: one side unchanged takes
// the other; both the same takes it; the chunks' ancestors spell the
// ancestor and each side's words spell that side; a merge with no clash
// is what both choices give.
func TestTextMergeLaws(t *testing.T) {
	r := rand.New(rand.NewSource(7))
	for n := 0; n < 4000; n++ {
		o := randText(r)
		a, b := editText(r, o), editText(r, o)
		if got := MergeText(o, a, o); got.Conflict || got.Join(ChooseA) != a {
			t.Fatalf("o=%q a=%q: B unchanged gave %q", o, a, got.Join(ChooseA))
		}
		if got := MergeText(o, o, b); got.Conflict || got.Join(ChooseA) != b {
			t.Fatalf("o=%q b=%q: A unchanged gave %q", o, b, got.Join(ChooseA))
		}
		if got := MergeText(o, a, a); got.Conflict || got.Join(ChooseA) != a {
			t.Fatalf("o=%q a=%q: the same edit gave %q", o, a, got.Join(ChooseA))
		}
		m := MergeText(o, a, b)
		var so, sa, sb strings.Builder
		for _, c := range m.Chunks {
			co, ca, cb := c.sides()
			so.WriteString(co)
			sa.WriteString(ca)
			sb.WriteString(cb)
		}
		if so.String() != o || sa.String() != a || sb.String() != b {
			t.Fatalf("o=%q a=%q b=%q: chunks spell %q / %q / %q", o, a, b, so.String(), sa.String(), sb.String())
		}
		if !m.Conflict && m.Join(ChooseA) != m.Join(ChooseB) {
			t.Fatalf("no clash, yet the choices differ")
		}
	}
}

// The random text cases both twins replay (contract/merge3/text/random.json),
// so the token merge agrees beyond the hand-written vectors. Written with
// KIT_WRITE_VECTORS=1.
func TestTextParity(t *testing.T) {
	file := filepath.Join("..", "..", "contract", "merge3", "text", "random.json")
	type tcase struct {
		Base   string          `json:"base"`
		A      string          `json:"a"`
		B      string          `json:"b"`
		Expect json.RawMessage `json:"expect"`
	}
	value := func(r TextResult) string {
		cs := make([]any, len(r.Chunks))
		for i, c := range r.Chunks {
			cs[i] = c.Value()
		}
		return Canonical(map[string]any{"chunks": cs, "conflict": r.Conflict})
	}
	if os.Getenv("KIT_WRITE_VECTORS") == "1" {
		r := rand.New(rand.NewSource(11))
		var cases []tcase
		for len(cases) < 200 {
			o := randText(r)
			a, b := editText(r, o), editText(r, o)
			cases = append(cases, tcase{Base: o, A: a, B: b, Expect: json.RawMessage(value(MergeText(o, a, b)))})
		}
		raw, _ := json.MarshalIndent(cases, "", " ")
		if err := os.WriteFile(file, append(raw, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var cases []tcase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		if got := value(MergeText(c.Base, c.A, c.B)); got != canonRaw(t, c.Expect) {
			t.Errorf("%q / %q / %q:\n got %s\nwant %s", c.Base, c.A, c.B, got, c.Expect)
		}
	}
}
