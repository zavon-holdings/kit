package merge3

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// node is a unit flattened: its children by key.
type node struct {
	key       string
	kind      string
	fields    map[string]any
	slots     map[string][]string
	place     Place
	synthetic bool
	hash      string // content hash of the unit as given (keyless units)
}

type side struct {
	nodes   map[string]*node
	rootKey string
	sigs    map[string]string
}

func unitHash(u Unit) string { return hash(Canonical(u.Value()))[:16] }

// index flattens a tree. With base nil it is the ancestor, whose keyless
// units are named by position; otherwise keyless units are matched to the
// ancestor's.
func index(u Unit, base *side) *side {
	s := &side{nodes: map[string]*node{}, rootKey: u.Key, sigs: map[string]string{}}
	s.add(u, Root, Place{}, base)
	return s
}

func (s *side) add(u Unit, key string, place Place, base *side) {
	n := &node{key: key, kind: u.Kind, fields: map[string]any{}, slots: map[string][]string{}, place: place,
		synthetic: strings.HasPrefix(key, "~")}
	for k, v := range u.Fields {
		n.fields[k] = cloneValue(normalize(v))
	}
	if n.synthetic && key != Root {
		n.hash = unitHash(u)
	}
	s.nodes[key] = n
	for _, name := range sortedKeys(u.Slots) {
		kids := u.Slots[name]
		keys := assign(key, name, kids, base)
		n.slots[name] = keys
		for i, kid := range kids {
			s.add(kid, keys[i], Place{Parent: key, Slot: name}, base)
		}
	}
}

func assign(parent, slot string, kids []Unit, base *side) []string {
	keys := make([]string, len(kids))
	var loose []int
	hashes := make([]string, len(kids))
	for i, k := range kids {
		if k.Key != "" {
			keys[i] = k.Key
		} else {
			loose = append(loose, i)
			hashes[i] = unitHash(k)
		}
	}
	prefix := "~" + parent + "/" + slot + "/"
	if base == nil {
		for _, i := range loose {
			keys[i] = prefix + strconv.Itoa(i)
		}
		return keys
	}
	var cands []string
	if bn := base.nodes[parent]; bn != nil {
		for _, c := range bn.slots[slot] {
			if base.nodes[c].synthetic {
				cands = append(cands, c)
			}
		}
	}
	claimed := map[string]bool{}
	var rest []int
	for _, i := range loose {
		found := ""
		for _, c := range cands {
			if !claimed[c] && base.nodes[c].hash == hashes[i] {
				found = c
				break
			}
		}
		if found != "" {
			claimed[found] = true
			keys[i] = found
		} else {
			rest = append(rest, i)
		}
	}
	var q []string
	for _, c := range cands {
		if !claimed[c] {
			q = append(q, c)
		}
	}
	for _, p := range lcs(len(rest), len(q), func(x, y int) bool { return kids[rest[x]].Kind == base.nodes[q[y]].kind }) {
		keys[rest[p[0]]] = q[p[1]]
	}
	count := map[string]int{}
	for _, i := range rest {
		if keys[i] == "" {
			n := count[hashes[i]]
			count[hashes[i]] = n + 1
			keys[i] = prefix + "+" + hashes[i] + "#" + strconv.Itoa(n)
		}
	}
	return keys
}

// lcs pairs indexes of two sequences along a longest common subsequence;
// ties skip from the first sequence.
func lcs(n, m int, eq func(i, j int) bool) [][2]int {
	dp := make([][]int, n+1)
	for i := range dp {
		dp[i] = make([]int, m+1)
	}
	for i := n - 1; i >= 0; i-- {
		for j := m - 1; j >= 0; j-- {
			if eq(i, j) {
				dp[i][j] = dp[i+1][j+1] + 1
			} else if dp[i+1][j] >= dp[i][j+1] {
				dp[i][j] = dp[i+1][j]
			} else {
				dp[i][j] = dp[i][j+1]
			}
		}
	}
	var out [][2]int
	i, j := 0, 0
	for i < n && j < m {
		if eq(i, j) && dp[i][j] == dp[i+1][j+1]+1 {
			out = append(out, [2]int{i, j})
			i++
			j++
		} else if dp[i+1][j] >= dp[i][j+1] {
			i++
		} else {
			j++
		}
	}
	return out
}

// sig is a digest of a unit and everything beneath it.
func (s *side) sig(k string) string {
	if v, ok := s.sigs[k]; ok {
		return v
	}
	n := s.nodes[k]
	slots := map[string]any{}
	for name, kids := range n.slots {
		slots[name] = normalize(kids)
	}
	var sb strings.Builder
	sb.WriteString(Canonical(map[string]any{"k": n.kind, "f": n.fields, "s": slots}))
	for _, name := range sortedKeys(n.slots) {
		for _, c := range n.slots[name] {
			sb.WriteString(s.sig(c))
		}
	}
	v := hash(sb.String())
	s.sigs[k] = v
	return v
}

func (s *side) has(k string) bool { return s.nodes[k] != nil }

func (s *side) isAncestor(anc, k string) bool {
	for p := s.nodes[k].place.Parent; p != ""; p = s.nodes[p].place.Parent {
		if p == anc {
			return true
		}
		if p == Root {
			return false
		}
	}
	return false
}

type merged struct {
	kind   string
	fields map[string]any
	place  Place
	names  map[string]bool
}

type dup struct {
	id    string
	kind  string
	key   string
	path  string
	value any
	has   bool
	place Place
}

type merger struct {
	o, a, b   *side
	dec       map[string]Decision
	opts      Options
	conflicts map[string]*Conflict
	keep      map[string]int8
	units     map[string]*merged
	dups      []dup
	err       error
}

type output struct {
	tree      Unit
	conflicts []Conflict
	ids       map[string]string
}

func run(base, a, b Unit, dec map[string]Decision, opts Options) (*output, error) {
	o := index(base, nil)
	m := &merger{o: o, a: index(a, o), b: index(b, o), dec: dec, opts: opts,
		conflicts: map[string]*Conflict{}, keep: map[string]int8{}, units: map[string]*merged{}}
	return m.run()
}

func (m *merger) fail(format string, args ...any) {
	if m.err == nil {
		m.err = fmt.Errorf("merge3: "+format, args...)
	}
}

func (m *merger) conflict(c Conflict) {
	if _, ok := m.conflicts[c.ID]; !ok {
		cc := c
		m.conflicts[c.ID] = &cc
	}
}

func (m *merger) decision(id string) (Decision, bool) {
	d, ok := m.dec[id]
	return d, ok
}

func (m *merger) touched(s *side, k string) bool {
	return s.sig(k) != m.o.sig(k) || s.nodes[k].place != m.o.nodes[k].place
}

// survives says whether k is in the merged tree.
func (m *merger) survives(k string) bool {
	switch m.keep[k] {
	case 1:
		return true
	case 2:
		return false
	}
	v := m.decide(k)
	if v {
		m.keep[k] = 1
	} else {
		m.keep[k] = 2
	}
	return v
}

func (m *merger) decide(k string) bool {
	if k == Root {
		return true
	}
	inO, inA, inB := m.o.has(k), m.a.has(k), m.b.has(k)
	switch {
	case !inA && !inB:
		return false
	case inA && inB:
		return true
	case !inO:
		return true
	}
	have, lack, deleter := m.a, m.b, ChooseB
	if inB {
		have, lack, deleter = m.b, m.a, ChooseA
	}
	r := k
	for {
		p := m.o.nodes[r].place.Parent
		if lack.has(p) {
			break
		}
		r = p
	}
	if r != k && have.isAncestor(r, k) {
		return m.survives(r)
	}
	if !m.touched(have, k) {
		return false
	}
	id := KindDelete + ":" + k
	m.conflict(Conflict{ID: id, Kind: KindDelete, Key: k, Side: deleter})
	d, ok := m.decision(id)
	if !ok {
		return true
	}
	switch d.Choice {
	case deleter:
		return false
	case ChooseManual:
		keep, isBool := d.Value.(bool)
		if !isBool {
			m.fail("%s: manual needs true (keep) or false (delete)", id)
		}
		return keep
	default:
		return true
	}
}

type val struct {
	v  any
	ok bool
}

func same(x, y val) bool {
	if x.ok != y.ok {
		return false
	}
	return !x.ok || Canonical(x.v) == Canonical(y.v)
}

// three merges one value; conflict reports both sides changed it apart.
func three(o, a, b val) (val, bool) {
	switch {
	case same(a, o):
		return b, false
	case same(b, o):
		return a, false
	case same(a, b):
		return a, false
	}
	return a, true
}

func fieldVal(n *node, path string) val {
	if n == nil {
		return val{}
	}
	if path == "@kind" {
		return val{n.kind, true}
	}
	v, ok := n.fields[path]
	return val{v, ok}
}

// mergeValue merges a field (or "@kind") of k and applies a decision.
func (m *merger) mergeValue(k, path string, on, an, bn *node) val {
	o, a, b := fieldVal(on, path), fieldVal(an, path), fieldVal(bn, path)
	v, clash := three(o, a, b)
	if !clash {
		return v
	}
	id := KindField + ":" + k + ":" + path
	m.conflict(Conflict{ID: id, Kind: KindField, Key: k, Path: path,
		Base: o.v, HasBase: o.ok, A: a.v, HasA: a.ok, B: b.v, HasB: b.ok})
	d, ok := m.decision(id)
	if !ok {
		return a
	}
	switch d.Choice {
	case ChooseB:
		return b
	case ChooseManual:
		if path == "@kind" {
			if s, isStr := d.Value.(string); isStr {
				return val{s, true}
			}
			m.fail("%s: a kind is a string", id)
			return a
		}
		return val{normalize(d.Value), true}
	case ChooseBoth:
		m.dups = append(m.dups, dup{id: id, kind: KindField, key: k, path: path, value: b.v, has: b.ok})
	}
	return a
}

func placeVal(n *node) val {
	if n == nil {
		return val{}
	}
	return val{n.place.value(), true}
}

func toPlace(v any) (Place, bool) {
	mm, ok := v.(map[string]any)
	if !ok {
		return Place{}, false
	}
	p, ok1 := mm["parent"].(string)
	s, ok2 := mm["slot"].(string)
	return Place{p, s}, ok1 && ok2
}

func (m *merger) moveConflict(k string) string {
	id := KindMove + ":" + k
	o, a, b := placeVal(m.o.nodes[k]), placeVal(m.a.nodes[k]), placeVal(m.b.nodes[k])
	m.conflict(Conflict{ID: id, Kind: KindMove, Key: k, Path: "@parent",
		Base: o.v, HasBase: o.ok, A: a.v, HasA: a.ok, B: b.v, HasB: b.ok})
	return id
}

// decidedPlace applies a decision on a move conflict.
func (m *merger) decidedPlace(id, k string) (Place, bool) {
	d, ok := m.decision(id)
	if !ok {
		return Place{}, false
	}
	switch d.Choice {
	case ChooseA, ChooseBoth:
		if n := m.a.nodes[k]; n != nil {
			return n.place, true
		}
	case ChooseB:
		if n := m.b.nodes[k]; n != nil {
			return n.place, true
		}
	case ChooseManual:
		p, ok := toPlace(normalize(d.Value))
		if !ok {
			m.fail("%s: manual needs {parent, slot}", id)
			return Place{}, false
		}
		return p, true
	}
	return Place{}, false
}

func (m *merger) run() (*output, error) {
	keys := map[string]bool{}
	for _, s := range []*side{m.o, m.a, m.b} {
		for k := range s.nodes {
			keys[k] = true
		}
	}
	all := sortedKeys(keys)
	var alive []string
	for _, k := range all {
		if m.survives(k) {
			alive = append(alive, k)
		}
	}
	if m.err != nil {
		return nil, m.err
	}
	decided := map[string]bool{}
	for _, k := range alive {
		on, an, bn := m.o.nodes[k], m.a.nodes[k], m.b.nodes[k]
		u := &merged{fields: map[string]any{}, names: map[string]bool{}}
		m.units[k] = u
		if an != nil && bn != nil {
			paths := map[string]bool{}
			for _, n := range []*node{on, an, bn} {
				if n != nil {
					for p := range n.fields {
						paths[p] = true
					}
				}
			}
			for _, p := range sortedKeys(paths) {
				if v := m.mergeValue(k, p, on, an, bn); v.ok {
					u.fields[p] = cloneValue(v.v)
				}
			}
			kv := m.mergeValue(k, "@kind", on, an, bn)
			u.kind, _ = kv.v.(string)
			names := map[string]bool{}
			for _, n := range []*node{on, an, bn} {
				if n != nil {
					for s := range n.slots {
						names[s] = true
					}
				}
			}
			for s := range names {
				has := func(n *node) bool {
					if n == nil {
						return false
					}
					_, ok := n.slots[s]
					return ok
				}
				pa, pb, po := has(an), has(bn), has(on)
				if pa == po {
					if pb {
						u.names[s] = true
					}
				} else if pa {
					u.names[s] = true
				}
			}
			if k != Root {
				o, a, b := placeVal(on), placeVal(an), placeVal(bn)
				v, clash := three(o, a, b)
				u.place, _ = toPlace(v.v)
				if clash {
					id := m.moveConflict(k)
					if p, ok := m.decidedPlace(id, k); ok {
						u.place = p
						decided[k] = true
						if d, _ := m.decision(id); d.Choice == ChooseBoth {
							m.dups = append(m.dups, dup{id: id, kind: KindMove, key: k, place: bn.place})
						}
					}
				}
			}
		} else {
			n := an
			if n == nil {
				n = bn
			}
			u.kind = n.kind
			for p, v := range n.fields {
				u.fields[p] = cloneValue(v)
			}
			for s := range n.slots {
				u.names[s] = true
			}
			u.place = n.place
		}
	}
	if m.err != nil {
		return nil, m.err
	}
	live := map[string]bool{}
	for _, k := range alive {
		live[k] = true
	}
	if err := m.settlePlaces(alive, live, decided); err != nil {
		return nil, err
	}
	if m.err != nil {
		return nil, m.err
	}
	// Children of each parent and slot, unordered.
	group := map[string]map[string][]string{}
	for _, k := range alive {
		if !live[k] || k == Root {
			continue
		}
		p := m.units[k].place
		if group[p.Parent] == nil {
			group[p.Parent] = map[string][]string{}
		}
		group[p.Parent][p.Slot] = append(group[p.Parent][p.Slot], k)
	}
	order := map[string]map[string][]string{}
	for _, k := range alive {
		if !live[k] {
			continue
		}
		u := m.units[k]
		for s := range group[k] {
			u.names[s] = true
		}
		order[k] = map[string][]string{}
		for _, s := range sortedKeys(u.names) {
			order[k][s] = m.orderSlot(k, s, group[k][s])
		}
	}
	if m.err != nil {
		return nil, m.err
	}
	ids, err := m.duplicate(order, live)
	if err != nil {
		return nil, err
	}
	rootKey := m.a.rootKey
	if m.a.rootKey == m.o.rootKey {
		rootKey = m.b.rootKey
	}
	var build func(k string) Unit
	build = func(k string) Unit {
		u := m.units[k]
		out := Unit{Kind: u.kind}
		if k == Root {
			out.Key = rootKey
		} else if !strings.HasPrefix(k, "~") {
			out.Key = k
		}
		if len(u.fields) > 0 {
			out.Fields = u.fields
		}
		if len(order[k]) > 0 {
			out.Slots = map[string][]Unit{}
			for s, kids := range order[k] {
				arr := make([]Unit, 0, len(kids))
				for _, c := range kids {
					arr = append(arr, build(c))
				}
				out.Slots[s] = arr
			}
		}
		return out
	}
	tree := build(Root)
	cs := make([]Conflict, 0, len(m.conflicts))
	for _, id := range sortedKeys(m.conflicts) {
		cs = append(cs, *m.conflicts[id])
	}
	return &output{tree: tree, conflicts: cs, ids: ids}, nil
}

// settlePlaces puts every unit whose parent is gone somewhere that exists,
// and undoes moves that would make a unit its own ancestor.
func (m *merger) settlePlaces(alive []string, live, decided map[string]bool) error {
	tried := map[string]bool{}
	for k := range decided {
		tried[k] = true
	}
	for iter := 0; iter <= 4*len(alive)+4; iter++ {
		changed := false
		for _, k := range alive {
			if !live[k] || k == Root {
				continue
			}
			u := m.units[k]
			if live[u.place.Parent] {
				continue
			}
			moved := false
			for _, s := range []*side{m.a, m.b, m.o} {
				if n := s.nodes[k]; n != nil && live[n.place.Parent] {
					u.place = n.place
					moved = true
					break
				}
			}
			if !moved {
				live[k] = false
			}
			changed = true
		}
		for _, k := range alive {
			if !live[k] || k == Root {
				continue
			}
			cycle := m.cycleFrom(k, live)
			if cycle == nil {
				continue
			}
			// First a decision (or A, the tentative side) for a move not
			// yet settled; then A's place; then the ancestor's, whose
			// edges cannot make a cycle.
			fixed := false
			for pass := 0; pass < 3 && !fixed; pass++ {
				for _, c := range cycle {
					on, an, bn := m.o.nodes[c], m.a.nodes[c], m.b.nodes[c]
					if on == nil || !((an != nil && an.place != on.place) || (bn != nil && bn.place != on.place)) {
						continue
					}
					id := m.moveConflict(c)
					u := m.units[c]
					target := u.place
					switch pass {
					case 0:
						if tried[c] {
							continue
						}
						tried[c] = true
						if p, ok := m.decidedPlace(id, c); ok {
							target = p
						} else if an != nil {
							target = an.place
						}
					case 1:
						target = on.place
						if an != nil {
							target = an.place
						}
					case 2:
						target = on.place
					}
					if target != u.place {
						u.place = target
						fixed = true
					}
				}
			}
			if !fixed {
				return fmt.Errorf("merge3: the moves around %q cannot be settled", k)
			}
			changed = true
			break
		}
		if !changed {
			return nil
		}
	}
	return fmt.Errorf("merge3: places did not settle")
}

// cycleFrom returns the units of a cycle reached by walking up from k.
func (m *merger) cycleFrom(k string, live map[string]bool) []string {
	pos := map[string]int{}
	var path []string
	for cur := k; cur != Root; cur = m.units[cur].place.Parent {
		if i, seen := pos[cur]; seen {
			cyc := append([]string(nil), path[i:]...)
			sort.Strings(cyc)
			return cyc
		}
		pos[cur] = len(path)
		path = append(path, cur)
		if !live[cur] {
			return nil
		}
	}
	return nil
}

func equalSeq(x, y []string) bool {
	if len(x) != len(y) {
		return false
	}
	for i := range x {
		if x[i] != y[i] {
			return false
		}
	}
	return true
}

func (s *side) list(parent, slot string) []string {
	if n := s.nodes[parent]; n != nil {
		return n.slots[slot]
	}
	return nil
}

type item struct {
	key string
	src byte // 'c' common, 'a', 'b', 'o'
}

// orderSlot orders the units merged into a parent's slot.
func (m *merger) orderSlot(parent, slot string, set []string) []string {
	in := map[string]bool{}
	for _, k := range set {
		in[k] = true
	}
	lo, la, lb := m.o.list(parent, slot), m.a.list(parent, slot), m.b.list(parent, slot)
	member := func(l []string) map[string]bool {
		s := map[string]bool{}
		for _, k := range l {
			s[k] = true
		}
		return s
	}
	mo, ma, mb := member(lo), member(la), member(lb)
	common := map[string]bool{}
	for _, k := range set {
		if mo[k] && ma[k] && mb[k] {
			common[k] = true
		}
	}
	project := func(l []string) []string {
		out := []string{}
		for _, k := range l {
			if common[k] {
				out = append(out, k)
			}
		}
		return out
	}
	po, pa, pb := project(lo), project(la), project(lb)
	var seq []string
	switch {
	case equalSeq(pa, po):
		seq = pb
	case equalSeq(pb, po):
		seq = pa
	case equalSeq(pa, pb):
		seq = pa
	default:
		seq = pa
		id := KindOrder + ":" + parent + ":" + slot
		m.conflict(Conflict{ID: id, Kind: KindOrder, Key: parent, Path: slot,
			Base: normalize(po), HasBase: true, A: normalize(pa), HasA: true, B: normalize(pb), HasB: true})
		if d, ok := m.decision(id); ok {
			switch d.Choice {
			case ChooseB:
				seq = pb
			case ChooseManual:
				arr, ok := normalize(d.Value).([]any)
				var keys []string
				valid := ok && len(arr) == len(pa)
				seen := map[string]bool{}
				for _, e := range arr {
					s, isStr := e.(string)
					if !isStr || !common[s] || seen[s] {
						valid = false
						break
					}
					seen[s] = true
					keys = append(keys, s)
				}
				if !valid {
					m.fail("%s: manual needs the keys %v in some order", id, pa)
				} else {
					seq = keys
				}
			}
		}
	}
	out := make([]item, 0, len(set))
	placed := map[string]bool{}
	for _, k := range seq {
		out = append(out, item{k, 'c'})
		placed[k] = true
	}
	insert := func(l []string, src byte, skip string) {
		for i, k := range l {
			if !in[k] || placed[k] {
				continue
			}
			pos := 0
			for j := i - 1; j >= 0; j-- {
				if placed[l[j]] {
					for x := range out {
						if out[x].key == l[j] {
							pos = x + 1
						}
					}
					break
				}
			}
			for pos < len(out) && strings.IndexByte(skip, out[pos].src) >= 0 {
				pos++
			}
			out = append(out, item{})
			copy(out[pos+1:], out[pos:])
			out[pos] = item{k, src}
			placed[k] = true
		}
	}
	insert(la, 'a', "")
	insert(lb, 'b', "a")
	insert(lo, 'o', "ab")
	var rest []string
	for _, k := range set {
		if !placed[k] {
			rest = append(rest, k)
		}
	}
	sort.Strings(rest)
	result := make([]string, 0, len(set))
	for _, it := range out {
		result = append(result, it.key)
	}
	return append(result, rest...)
}

// duplicate carries out "both": a copy of the unit, with fresh keys, after
// the original (a field) or where B put it (a move).
func (m *merger) duplicate(order map[string]map[string][]string, live map[string]bool) (map[string]string, error) {
	ids := map[string]string{}
	if len(m.dups) == 0 {
		return ids, nil
	}
	sort.SliceStable(m.dups, func(i, j int) bool { return m.dups[i].id < m.dups[j].id })
	taken := func(k string) bool { return m.units[k] != nil }
	mint := m.opts.MintKey
	if mint == nil {
		mint = func(old string, taken func(string) bool) string {
			k := old + "~b"
			for n := 2; taken(k); n++ {
				k = old + "~b" + strconv.Itoa(n)
			}
			return k
		}
	}
	var clone func(k string, place Place) (string, error)
	clone = func(k string, place Place) (string, error) {
		nk := mint(k, taken)
		if nk == "" || taken(nk) || nk == Root {
			return "", fmt.Errorf("merge3: the key minted for a copy of %q is empty or taken", k)
		}
		if !strings.HasPrefix(k, "~") {
			ids[k] = nk
		}
		src := m.units[k]
		u := &merged{kind: src.kind, fields: map[string]any{}, place: place, names: map[string]bool{}}
		for p, v := range src.fields {
			u.fields[p] = cloneValue(v)
		}
		for s := range src.names {
			u.names[s] = true
		}
		m.units[nk] = u
		live[nk] = true
		order[nk] = map[string][]string{}
		for _, s := range sortedKeys(order[k]) {
			var kids []string
			for _, c := range order[k][s] {
				ck, err := clone(c, Place{Parent: nk, Slot: s})
				if err != nil {
					return "", err
				}
				kids = append(kids, ck)
			}
			if kids == nil {
				kids = []string{}
			}
			order[nk][s] = kids
		}
		return nk, nil
	}
	for _, d := range m.dups {
		if !live[d.key] {
			continue
		}
		u := m.units[d.key]
		switch d.kind {
		case KindField:
			nk, err := clone(d.key, u.place)
			if err != nil {
				return nil, err
			}
			c := m.units[nk]
			if d.path == "@kind" {
				c.kind, _ = d.value.(string)
			} else if d.has {
				c.fields[d.path] = cloneValue(d.value)
			} else {
				delete(c.fields, d.path)
			}
			l := order[u.place.Parent][u.place.Slot]
			for i, k := range l {
				if k == d.key {
					l = append(l[:i+1], append([]string{nk}, l[i+1:]...)...)
					break
				}
			}
			order[u.place.Parent][u.place.Slot] = l
		case KindMove:
			if !live[d.place.Parent] || d.place == u.place {
				continue
			}
			nk, err := clone(d.key, d.place)
			if err != nil {
				return nil, err
			}
			l := order[d.place.Parent][d.place.Slot]
			bl := m.b.list(d.place.Parent, d.place.Slot)
			pos := 0
			for i, k := range bl {
				if k != d.key {
					continue
				}
				for j := i - 1; j >= 0 && pos == 0; j-- {
					for x, have := range l {
						if have == bl[j] {
							pos = x + 1
							break
						}
					}
				}
				break
			}
			l = append(l[:pos], append([]string{nk}, l[pos:]...)...)
			order[d.place.Parent][d.place.Slot] = l
			m.units[d.place.Parent].names[d.place.Slot] = true
		}
	}
	return ids, nil
}
