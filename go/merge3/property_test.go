package merge3

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"testing"
)

// A random document: a root with a body of blocks; groups hold blocks in
// "items". Some blocks have no key.

var kinds = []string{"text", "heading", "image", "quote"}
var words = []string{"alpha", "beta", "gamma", "delta", "", "long text with spaces"}

type gen struct {
	r    *rand.Rand
	next int
}

func (g *gen) key() string {
	g.next++
	return fmt.Sprintf("u%d", g.next)
}

func (g *gen) leaf(keyed bool) Unit {
	u := Unit{Kind: kinds[g.r.Intn(len(kinds))], Fields: map[string]any{}}
	if keyed {
		u.Key = g.key()
	}
	if g.r.Intn(4) > 0 {
		u.Fields["text"] = words[g.r.Intn(len(words))]
	}
	if g.r.Intn(3) == 0 {
		u.Fields["level"] = float64(g.r.Intn(4))
	}
	return u
}

func (g *gen) block(depth int) Unit {
	if depth < 2 && g.r.Intn(4) == 0 {
		u := Unit{Key: g.key(), Kind: "group", Fields: map[string]any{"title": words[g.r.Intn(len(words))]}, Slots: map[string][]Unit{"items": {}}}
		for i := g.r.Intn(4); i > 0; i-- {
			u.Slots["items"] = append(u.Slots["items"], g.block(depth+1))
		}
		return u
	}
	return g.leaf(g.r.Intn(5) > 0)
}

func (g *gen) tree() Unit {
	root := Unit{Key: "doc", Kind: "document", Fields: map[string]any{"title": "Draft"}, Slots: map[string][]Unit{"body": {}}}
	for i := 1 + g.r.Intn(7); i > 0; i-- {
		root.Slots["body"] = append(root.Slots["body"], g.block(0))
	}
	return root
}

func cloneUnit(u Unit) Unit {
	raw, _ := json.Marshal(u)
	var out Unit
	if err := json.Unmarshal(raw, &out); err != nil {
		panic(err)
	}
	return out
}

type ref struct {
	u      *Unit
	parent *Unit
	slot   string
	index  int
}

// refs lists every unit with where it sits; the root has no parent.
func refs(root *Unit) []ref {
	out := []ref{{u: root}}
	var walk func(p *Unit)
	walk = func(p *Unit) {
		for _, s := range sortedKeys(p.Slots) {
			for i := range p.Slots[s] {
				c := &p.Slots[s][i]
				out = append(out, ref{u: c, parent: p, slot: s, index: i})
				walk(c)
			}
		}
	}
	walk(root)
	return out
}

func within(anc, u *Unit) bool {
	if anc == u {
		return true
	}
	for _, s := range anc.Slots {
		for i := range s {
			if within(&s[i], u) {
				return true
			}
		}
	}
	return false
}

// edit applies n random edits; tag marks values so two sides differ.
func (g *gen) edit(t Unit, tag string, n int) Unit {
	t = cloneUnit(t)
	for ; n > 0; n-- {
		rs := refs(&t)
		pick := rs[g.r.Intn(len(rs))]
		switch g.r.Intn(8) {
		case 0, 1:
			if pick.u.Fields == nil {
				pick.u.Fields = map[string]any{}
			}
			pick.u.Fields[[]string{"text", "level", "note"}[g.r.Intn(3)]] = tag + fmt.Sprint(g.r.Intn(3))
		case 2:
			for k := range pick.u.Fields {
				delete(pick.u.Fields, k)
				break
			}
		case 3:
			if pick.parent != nil {
				l := pick.parent.Slots[pick.slot]
				pick.parent.Slots[pick.slot] = append(l[:pick.index:pick.index], l[pick.index+1:]...)
			}
		case 4:
			if pick.u.Slots != nil {
				s := sortedKeys(pick.u.Slots)[0]
				l := pick.u.Slots[s]
				at := g.r.Intn(len(l) + 1)
				nu := g.leaf(g.r.Intn(4) > 0)
				if nu.Key != "" {
					nu.Key = tag + nu.Key
				}
				pick.u.Slots[s] = append(l[:at:at], append([]Unit{nu}, l[at:]...)...)
			}
		case 5:
			if pick.parent != nil && pick.u.Key != "" {
				var targets []*Unit
				for _, r := range rs {
					if r.u.Slots != nil && !within(pick.u, r.u) {
						targets = append(targets, r.u)
					}
				}
				moving := cloneUnit(*pick.u)
				dest := targets[g.r.Intn(len(targets))]
				destKey := dest.Key
				l := pick.parent.Slots[pick.slot]
				pick.parent.Slots[pick.slot] = append(l[:pick.index:pick.index], l[pick.index+1:]...)
				for _, r := range refs(&t) {
					if r.u.Key == destKey && r.u.Slots != nil {
						s := sortedKeys(r.u.Slots)[0]
						dl := r.u.Slots[s]
						at := g.r.Intn(len(dl) + 1)
						r.u.Slots[s] = append(dl[:at:at], append([]Unit{moving}, dl[at:]...)...)
						break
					}
				}
			}
		case 6:
			if pick.u.Slots != nil {
				s := sortedKeys(pick.u.Slots)[0]
				l := pick.u.Slots[s]
				g.r.Shuffle(len(l), func(i, j int) { l[i], l[j] = l[j], l[i] })
			}
		case 7:
			if pick.parent != nil && pick.u.Kind != "group" && g.r.Intn(3) == 0 {
				pick.u.Kind = kinds[g.r.Intn(len(kinds))]
			}
		}
	}
	return t
}

func canonUnit(u Unit) string { return Canonical(u.Value()) }

func conflictSet(cs []Conflict) string {
	var out []string
	for _, c := range cs {
		out = append(out, c.ID+"/"+c.Kind)
	}
	sort.Strings(out)
	return strings.Join(out, ",")
}

func mustMerge(t *testing.T, o, a, b Unit) *Result {
	t.Helper()
	r, err := Merge(o, a, b)
	if err != nil {
		t.Fatalf("merge: %v\nbase %s\na    %s\nb    %s", err, canonUnit(o), canonUnit(a), canonUnit(b))
	}
	if err := Validate(r.Tree); err != nil {
		t.Fatalf("merged tree invalid: %v", err)
	}
	return r
}

func keysOf(u Unit) map[string]bool {
	out := map[string]bool{}
	for _, r := range refs(&u) {
		if r.u.Key != "" {
			out[r.u.Key] = true
		}
	}
	return out
}

func checkProperties(t *testing.T, seed int64) {
	g := &gen{r: rand.New(rand.NewSource(seed))}
	o := g.tree()
	a := g.edit(o, "a", 1+g.r.Intn(5))
	b := g.edit(o, "b", 1+g.r.Intn(5))
	dump := func() string {
		return fmt.Sprintf("seed %d\nbase %s\na    %s\nb    %s", seed, canonUnit(o), canonUnit(a), canonUnit(b))
	}

	// One side unchanged takes the other, exactly.
	for _, c := range []struct {
		name    string
		x, y, w Unit
	}{{"merge(o,a,o)", a, o, a}, {"merge(o,o,b)", o, b, b}, {"merge(o,a,a)", a, a, a}} {
		r := mustMerge(t, o, c.x, c.y)
		if got := canonUnit(r.Tree); got != canonUnit(c.w) {
			t.Fatalf("%s:\n got %s\nwant %s\n%s", c.name, got, canonUnit(c.w), dump())
		}
		if len(r.Conflicts) != 0 {
			t.Fatalf("%s: conflicts %s\n%s", c.name, conflictSet(r.Conflicts), dump())
		}
	}

	ab := mustMerge(t, o, a, b)
	ba := mustMerge(t, o, b, a)
	if conflictSet(ab.Conflicts) != conflictSet(ba.Conflicts) {
		t.Fatalf("conflicts differ by direction:\n ab %s\n ba %s\n%s", conflictSet(ab.Conflicts), conflictSet(ba.Conflicts), dump())
	}

	// Nothing a side added, or kept while the other kept it too, is lost;
	// a unit one side deleted survives only if the other changed it.
	ko, ka, kb, km := keysOf(o), keysOf(a), keysOf(b), keysOf(ab.Tree)
	io, ia, ib := index(o, nil), (*side)(nil), (*side)(nil)
	ia, ib = index(a, io), index(b, io)
	mm := &merger{o: io, a: ia, b: ib}
	for k := range ka {
		if (kb[k] || !ko[k] || mm.touched(ia, k)) && !km[k] {
			t.Fatalf("lost %q from a\n%s", k, dump())
		}
	}
	for k := range kb {
		if (ka[k] || !ko[k] || mm.touched(ib, k)) && !km[k] {
			t.Fatalf("lost %q from b\n%s", k, dump())
		}
	}
	for k := range km {
		if !ka[k] && !kb[k] {
			t.Fatalf("invented %q\n%s", k, dump())
		}
	}

	checkDecisions(t, g, ab, dump)
}

// checkDecisions resolves every conflict with every choice combination
// (sampled when there are many) and checks the tree stays valid.
func checkDecisions(t *testing.T, g *gen, r *Result, dump func() string) {
	cs := r.Conflicts
	if len(cs) == 0 {
		return
	}
	choices := func(c Conflict) []Decision {
		out := []Decision{{Choice: ChooseA}, {Choice: ChooseB}}
		switch c.Kind {
		case KindField:
			out = append(out, Decision{Choice: ChooseBoth}, Decision{Choice: ChooseManual, Value: "manual", HasValue: true})
			if c.Path == "@kind" || c.Key == Root {
				out = out[:2]
			}
		case KindDelete:
			out = append(out, Decision{Choice: ChooseBoth}, Decision{Choice: ChooseManual, Value: false, HasValue: true})
		case KindMove:
			out = append(out, Decision{Choice: ChooseBoth}, Decision{Choice: ChooseManual, Value: c.A, HasValue: c.HasA})
		case KindOrder:
			rev := append([]any(nil), c.A.([]any)...)
			for i, j := 0, len(rev)-1; i < j; i, j = i+1, j-1 {
				rev[i], rev[j] = rev[j], rev[i]
			}
			out = append(out, Decision{Choice: ChooseManual, Value: rev, HasValue: true})
		}
		return out
	}
	total := 1
	for _, c := range cs {
		total *= len(choices(c))
		if total > 64 {
			break
		}
	}
	tries := total
	if total > 64 {
		tries = 64
	}
	for n := 0; n < tries; n++ {
		dec := map[string]Decision{}
		x := n
		for _, c := range cs {
			opts := choices(c)
			i := x % len(opts)
			if total > 64 {
				i = g.r.Intn(len(opts))
			}
			x /= len(opts)
			dec[c.ID] = opts[i]
		}
		res, err := r.Resolve(dec, Options{DuplicateAsUnits: true})
		if err != nil {
			t.Fatalf("resolve %v: %v\n%s", dec, err, dump())
		}
		if err := Validate(res.Tree); err != nil {
			t.Fatalf("resolved tree invalid: %v\n%s", err, dump())
		}
		for old, nk := range res.IDs {
			ks := keysOf(res.Tree)
			if !ks[old] && !ks[nk] {
				t.Fatalf("id map %s→%s names neither unit\n%s", old, nk, dump())
			}
		}
	}
}

// Disjoint edits — different units' fields, additions, one side's
// reorder, a deletion of an untouched leaf — merge with no conflicts and
// lose nothing.
func checkDisjoint(t *testing.T, seed int64) {
	g := &gen{r: rand.New(rand.NewSource(seed))}
	o := g.tree()
	a, b := cloneUnit(o), cloneUnit(o)
	type edit struct{ key, path, value string }
	var ea, eb []edit
	var deleted []string
	for i, r := range refs(&a) {
		if r.u.Key == "" || r.parent == nil {
			continue
		}
		switch {
		case i%2 == 0 && g.r.Intn(2) == 0:
			if r.u.Fields == nil {
				r.u.Fields = map[string]any{}
			}
			r.u.Fields["note"] = "a" + r.u.Key
			ea = append(ea, edit{r.u.Key, "note", "a" + r.u.Key})
		case i%2 == 0 && r.u.Slots == nil && g.r.Intn(4) == 0:
			deleted = append(deleted, r.u.Key)
		}
	}
	for i, r := range refs(&b) {
		if r.u.Key == "" || r.parent == nil || i%2 == 0 || g.r.Intn(2) == 0 {
			continue
		}
		if r.u.Fields == nil {
			r.u.Fields = map[string]any{}
		}
		r.u.Fields["note"] = "b" + r.u.Key
		eb = append(eb, edit{r.u.Key, "note", "b" + r.u.Key})
	}
	for _, k := range deleted {
		for _, r := range refs(&a) {
			if r.u.Key == k {
				l := r.parent.Slots[r.slot]
				r.parent.Slots[r.slot] = append(l[:r.index:r.index], l[r.index+1:]...)
				break
			}
		}
	}
	add := func(t *Unit, tag string) []string {
		var added []string
		for n := g.r.Intn(3); n > 0; n-- {
			var hosts []*Unit
			for _, r := range refs(t) {
				if r.u.Slots != nil {
					hosts = append(hosts, r.u)
				}
			}
			h := hosts[g.r.Intn(len(hosts))]
			s := sortedKeys(h.Slots)[0]
			nu := Unit{Key: tag + g.key(), Kind: "text", Fields: map[string]any{"text": tag}}
			at := g.r.Intn(len(h.Slots[s]) + 1)
			h.Slots[s] = append(h.Slots[s][:at:at], append([]Unit{nu}, h.Slots[s][at:]...)...)
			added = append(added, nu.Key)
		}
		return added
	}
	added := append(add(&a, "a"), add(&b, "b")...)
	if g.r.Intn(2) == 0 {
		l := a.Slots["body"]
		g.r.Shuffle(len(l), func(i, j int) { l[i], l[j] = l[j], l[i] })
	}
	r := mustMerge(t, o, a, b)
	dump := fmt.Sprintf("seed %d\nbase %s\na    %s\nb    %s\ngot  %s", seed, canonUnit(o), canonUnit(a), canonUnit(b), canonUnit(r.Tree))
	if len(r.Conflicts) != 0 {
		t.Fatalf("disjoint edits conflict: %s\n%s", conflictSet(r.Conflicts), dump)
	}
	byKey := map[string]*Unit{}
	for _, x := range refs(&r.Tree) {
		byKey[x.u.Key] = x.u
	}
	for _, e := range append(ea, eb...) {
		if byKey[e.key] == nil || byKey[e.key].Fields[e.path] != e.value {
			t.Fatalf("edit %v lost\n%s", e, dump)
		}
	}
	for _, k := range added {
		if byKey[k] == nil {
			t.Fatalf("addition %s lost\n%s", k, dump)
		}
	}
	for _, k := range deleted {
		if byKey[k] != nil {
			t.Fatalf("deletion of %s undone\n%s", k, dump)
		}
	}
}

func TestProperties(t *testing.T) {
	for seed := int64(1); seed <= 1500; seed++ {
		checkProperties(t, seed)
		checkDisjoint(t, seed)
	}
}

func FuzzMerge(f *testing.F) {
	for seed := int64(0); seed < 32; seed++ {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, seed int64) { checkProperties(t, seed) })
}

func FuzzDisjoint(f *testing.F) {
	for seed := int64(0); seed < 32; seed++ {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, seed int64) { checkDisjoint(t, seed) })
}
