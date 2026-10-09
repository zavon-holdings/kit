package merge3

import (
	"encoding/json"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type vectorResolution struct {
	Description string              `json:"description"`
	Decisions   map[string]Decision `json:"decisions"`
	Options     *struct {
		DuplicateAsUnits bool `json:"duplicateAsUnits"`
	} `json:"options,omitempty"`
	Expect json.RawMessage `json:"expect,omitempty"`
}

type vector struct {
	Name        string             `json:"name"`
	Description string             `json:"description"`
	Base        Unit               `json:"base"`
	A           Unit               `json:"a"`
	B           Unit               `json:"b"`
	Expect      json.RawMessage    `json:"expect,omitempty"`
	Resolutions []vectorResolution `json:"resolutions,omitempty"`
}

func resultValue(r *Result) map[string]any {
	cs := make([]any, len(r.Conflicts))
	for i, c := range r.Conflicts {
		cs[i] = c.Value()
	}
	return map[string]any{"tree": r.Tree.Value(), "conflicts": cs}
}

func resolutionValue(r *Resolution, err error) map[string]any {
	if err != nil {
		return map[string]any{"error": true}
	}
	cs := make([]any, len(r.Conflicts))
	for i, c := range r.Conflicts {
		cs[i] = c.Value()
	}
	ids := map[string]any{}
	for k, v := range r.IDs {
		ids[k] = v
	}
	return map[string]any{"tree": r.Tree.Value(), "ids": ids, "conflicts": cs}
}

func canonRaw(t *testing.T, raw json.RawMessage) string {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return Canonical(v)
}

// KIT_WRITE_VECTORS=1 go test ./merge3 -run TestContractVectors writes each
// vector's expectations from this implementation; otherwise they are
// checked. The TypeScript twin checks the same files.
func TestContractVectors(t *testing.T) {
	dir := filepath.Join("..", "..", "contract", "merge3")
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil || len(files) < 30 {
		t.Fatalf("want at least 30 vectors in %s, have %d (%v)", dir, len(files), err)
	}
	write := os.Getenv("KIT_WRITE_VECTORS") == "1"
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var v vector
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		r, err := Merge(v.Base, v.A, v.B)
		if err != nil {
			t.Fatalf("%s: %v", v.Name, err)
		}
		got := resultValue(r)
		if write {
			v.Expect = json.RawMessage(Canonical(got))
		} else if Canonical(got) != canonRaw(t, v.Expect) {
			t.Errorf("%s:\n got %s\nwant %s", v.Name, Canonical(got), canonRaw(t, v.Expect))
		}
		for i, res := range v.Resolutions {
			opts := Options{}
			if res.Options != nil {
				opts.DuplicateAsUnits = res.Options.DuplicateAsUnits
			}
			out := resolutionValue(r.Resolve(res.Decisions, opts))
			if write {
				v.Resolutions[i].Expect = json.RawMessage(Canonical(out))
			} else if Canonical(out) != canonRaw(t, res.Expect) {
				t.Errorf("%s / %s:\n got %s\nwant %s", v.Name, res.Description, Canonical(out), canonRaw(t, res.Expect))
			}
			if tree, ok := out["tree"]; ok {
				var u Unit
				b, _ := json.Marshal(tree)
				_ = json.Unmarshal(b, &u)
				if err := Validate(u); err != nil {
					t.Errorf("%s / %s: %v", v.Name, res.Description, err)
				}
			}
		}
		if write {
			out, _ := json.MarshalIndent(v, "", "  ")
			if err := os.WriteFile(f, append(out, '\n'), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestCanonicalMatchesJavaScript(t *testing.T) {
	for in, want := range map[string]string{
		`{"b":1,"a":[true,null,"x"]}`:          `{"a":[true,null,"x"],"b":1}`,
		`[1e21, 1e-7, 0.000001, -0, 1.5, 100]`: `[1e+21,1e-7,0.000001,0,1.5,100]`,
		`"<a href=\"x\">&amp;</a>"`:            `"<a href=\"x\">&amp;</a>"`,
		`"tab\tline\nctl\u0001 \u2028 é"`:      "\"tab\\tline\\nctl\\u0001 \u2028 é\"",
	} {
		var v any
		if err := json.Unmarshal([]byte(in), &v); err != nil {
			t.Fatal(err)
		}
		if got := Canonical(v); got != want {
			t.Errorf("Canonical(%s) = %s, want %s", in, got, want)
		}
	}
}

type parityCase struct {
	Seed      int64               `json:"seed"`
	Base      Unit                `json:"base"`
	A         Unit                `json:"a"`
	B         Unit                `json:"b"`
	Decisions map[string]Decision `json:"decisions,omitempty"`
	Expect    json.RawMessage     `json:"expect,omitempty"`
	Resolved  json.RawMessage     `json:"resolved,omitempty"`
}

// The parity cases are random merges (the property tests' generator) that
// both twins replay, so the twins agree beyond the hand-written vectors:
// keyless matching, synthetic keys, cycles, copies. Written with
// KIT_WRITE_VECTORS=1 from seeds that produce conflicts.
func TestParityCases(t *testing.T) {
	file := filepath.Join("..", "..", "contract", "merge3", "parity", "random.json")
	if os.Getenv("KIT_WRITE_VECTORS") == "1" {
		var cases []parityCase
		quota := map[string]int{KindField: 15, KindDelete: 15, KindMove: 15, KindOrder: 15, "": 10, "synthetic": 10}
		for seed := int64(1); seed < 50000 && len(cases) < 80; seed++ {
			g := &gen{r: rand.New(rand.NewSource(seed))}
			o := g.tree()
			a := g.edit(o, "a", 2+g.r.Intn(6))
			b := g.edit(o, "b", 2+g.r.Intn(6))
			r, err := Merge(o, a, b)
			if err != nil {
				t.Fatal(err)
			}
			want := false
			if len(r.Conflicts) == 0 && quota[""] > 0 {
				quota[""]--
				want = true
			}
			for _, k := range r.Conflicts {
				if quota[k.Kind] > 0 {
					quota[k.Kind]--
					want = true
				}
				if strings.Contains(Canonical(k.Value()), "/+") && quota["synthetic"] > 0 {
					quota["synthetic"]--
					want = true
				}
			}
			if !want {
				continue
			}
			c := parityCase{Seed: seed, Base: o, A: a, B: b}
			if len(r.Conflicts) > 0 {
				c.Decisions = map[string]Decision{}
				for i, k := range r.Conflicts {
					choice := []string{ChooseA, ChooseB, ChooseBoth}[(i+int(seed))%3]
					if choice == ChooseBoth && (k.Kind == KindOrder || k.Key == Root) {
						choice = ChooseB
					}
					c.Decisions[k.ID] = Decision{Choice: choice}
				}
			}
			cases = append(cases, c)
		}
		raw, _ := json.MarshalIndent(cases, "", " ")
		_ = os.MkdirAll(filepath.Dir(file), 0o755)
		if err := os.WriteFile(file, append(raw, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var cases []parityCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	write := os.Getenv("KIT_WRITE_VECTORS") == "1"
	for i := range cases {
		c := &cases[i]
		r, err := Merge(c.Base, c.A, c.B)
		if err != nil {
			t.Fatalf("seed %d: %v", c.Seed, err)
		}
		got := Canonical(resultValue(r))
		var res string
		if c.Decisions != nil {
			res = Canonical(resolutionValue(r.Resolve(c.Decisions, Options{DuplicateAsUnits: true})))
		}
		if write {
			c.Expect = json.RawMessage(got)
			if res != "" {
				c.Resolved = json.RawMessage(res)
			}
			continue
		}
		if got != canonRaw(t, c.Expect) {
			t.Errorf("seed %d:\n got %s\nwant %s", c.Seed, got, canonRaw(t, c.Expect))
		}
		if res != "" && res != canonRaw(t, c.Resolved) {
			t.Errorf("seed %d resolved:\n got %s\nwant %s", c.Seed, res, canonRaw(t, c.Resolved))
		}
	}
	if write {
		raw, _ := json.Marshal(cases)
		if err := os.WriteFile(file, append(raw, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}
