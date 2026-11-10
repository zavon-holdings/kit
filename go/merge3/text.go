package merge3

import (
	"strings"
	"unicode"
)

// Text merging (MergeOptions.Text): a field named there whose ancestor and
// both edits are strings is merged three ways over TOKENS, not as one value,
// when both sides changed it differently. Two people changing different
// words of one paragraph is then no conflict at all, and two changing the
// same words is a conflict narrowed to those words.
//
// Tokens are runs of letters, digits and combining marks (Unicode L, N, M);
// runs of spaces (space, tab, form feed, vertical tab, Unicode Zs, Zl, Zp);
// and every other character on its own — a line break ("\n", "\r") among
// them, so lines are where a merge finds its footing, and so are marks like
// "*", "_" and ")". The TypeScript twin tokenises by the same classes.
//
// The merge is diff3's: each edit is matched to the ancestor along a longest
// common subsequence of tokens (lcs, with its tie rule); a stretch where the
// ancestor's tokens are matched by both edits is stable; between two stable
// stretches lies a chunk where at least one side differs. A chunk only one
// side changed takes that side; both changing it identically takes the
// change; otherwise it is a conflict. An insertion right at the edge of the
// other side's change falls into the same chunk and so is a conflict, as in
// diff3 and git: "We will go" with "not " inserted before "go" on one side
// and "go" changed to "stay" on the other is a sentence neither side wrote
// ("We will not stay"), and nothing short of reading it can tell that from
// a harmless pair. Contract vector text-boundary-insertion.json holds it.
//
// A text conflict carries the merge as chunks (TextChunk) and resolves per
// clashing chunk: "a" takes A's words in every clash and the merged words
// elsewhere (also the tentative outcome), "b" B's, "both" A's then B's —
// never a copy of the unit — and "manual" the value given, whole.

// Text chunk operations.
const (
	TextSame     = "same"     // nobody changed it
	TextA        = "a"        // only A changed it
	TextB        = "b"        // only B changed it
	TextBoth     = "both"     // both changed it the same way
	TextConflict = "conflict" // both changed it differently
)

// MaxTextCells bounds the work matching two tokenised strings: past it (the
// product of the two token counts, once a common start and end are set
// aside) nothing in between is matched, and the middle is one chunk.
const MaxTextCells = 1 << 20

// TextChunk is one stretch of a text merge. Same: Text. A: Base and A. B:
// Base and B. Both: Base and Text. Conflict: Base, A and B.
type TextChunk struct {
	Op   string
	Text string
	Base string
	A    string
	B    string
}

// Value is the chunk as plain JSON values.
func (c TextChunk) Value() map[string]any {
	m := map[string]any{"op": c.Op}
	switch c.Op {
	case TextSame:
		m["text"] = c.Text
	case TextA:
		m["base"], m["a"] = c.Base, c.A
	case TextB:
		m["base"], m["b"] = c.Base, c.B
	case TextBoth:
		m["base"], m["text"] = c.Base, c.Text
	default:
		m["base"], m["a"], m["b"] = c.Base, c.A, c.B
	}
	return m
}

// MarshalJSON writes the chunk canonically.
func (c TextChunk) MarshalJSON() ([]byte, error) { return []byte(Canonical(c.Value())), nil }

// TextResult is a text merge: its chunks in order, and whether any clashed.
type TextResult struct {
	Chunks   []TextChunk
	Conflict bool
}

// Join writes the merge out, choosing each clash with pick ("a", "b" or
// "both": A's then B's).
func (t TextResult) Join(pick string) string {
	var sb strings.Builder
	for _, c := range t.Chunks {
		switch c.Op {
		case TextSame, TextBoth:
			sb.WriteString(c.Text)
		case TextA:
			sb.WriteString(c.A)
		case TextB:
			sb.WriteString(c.B)
		default:
			switch pick {
			case ChooseB:
				sb.WriteString(c.B)
			case ChooseBoth:
				sb.WriteString(c.A)
				sb.WriteString(c.B)
			default:
				sb.WriteString(c.A)
			}
		}
	}
	return sb.String()
}

func tokenClass(r rune) int {
	switch {
	case unicode.In(r, unicode.L, unicode.N, unicode.M):
		return 1
	case r == ' ' || r == '\t' || r == '\f' || r == '\v' || unicode.In(r, unicode.Zs, unicode.Zl, unicode.Zp):
		return 2
	}
	return 0
}

// Tokens splits a string as the text merge does.
func Tokens(s string) []string {
	var out []string
	start, cls := -1, -1
	for i, r := range s {
		c := tokenClass(r)
		if start >= 0 && c != 0 && c == cls {
			continue
		}
		if start >= 0 {
			out = append(out, s[start:i])
		}
		start, cls = i, c
	}
	if start >= 0 {
		out = append(out, s[start:])
	}
	return out
}

// matchTo maps each token of x to the token of y it is matched to along a
// longest common subsequence, or -1.
func matchTo(x, y []string) []int {
	out := make([]int, len(x))
	for i := range out {
		out[i] = -1
	}
	p := 0
	for p < len(x) && p < len(y) && x[p] == y[p] {
		out[p] = p
		p++
	}
	s := 0
	for s < len(x)-p && s < len(y)-p && x[len(x)-1-s] == y[len(y)-1-s] {
		out[len(x)-1-s] = len(y) - 1 - s
		s++
	}
	xm, ym := x[p:len(x)-s], y[p:len(y)-s]
	if len(xm) == 0 || len(ym) == 0 || len(xm)*len(ym) > MaxTextCells {
		return out
	}
	for _, pr := range lcs(len(xm), len(ym), func(i, j int) bool { return xm[i] == ym[j] }) {
		out[p+pr[0]] = p + pr[1]
	}
	return out
}

// MergeText merges two edits of a string, token by token.
func MergeText(base, a, b string) TextResult {
	o, ta, tb := Tokens(base), Tokens(a), Tokens(b)
	ma, mb := matchTo(o, ta), matchTo(o, tb)
	var res TextResult
	add := func(c TextChunk) {
		if n := len(res.Chunks); n > 0 && c.Op == TextSame && res.Chunks[n-1].Op == TextSame {
			res.Chunks[n-1].Text += c.Text
			return
		}
		res.Chunks = append(res.Chunks, c)
	}
	join := func(t []string) string { return strings.Join(t, "") }
	i, ja, jb := 0, 0, 0
	for {
		start := i
		for i < len(o) && ma[i] == ja && mb[i] == jb {
			i, ja, jb = i+1, ja+1, jb+1
		}
		if i > start {
			add(TextChunk{Op: TextSame, Text: join(o[start:i])})
		}
		if i == len(o) && ja == len(ta) && jb == len(tb) {
			break
		}
		k := i
		for k < len(o) && (ma[k] < 0 || mb[k] < 0) {
			k++
		}
		ea, eb := len(ta), len(tb)
		if k < len(o) {
			ea, eb = ma[k], mb[k]
		}
		add(classify(join(o[i:k]), join(ta[ja:ea]), join(tb[jb:eb])))
		i, ja, jb = k, ea, eb
	}
	res.Chunks = absorbSpaces(res.Chunks)
	res.Conflict = false
	for _, c := range res.Chunks {
		if c.Op == TextConflict {
			res.Conflict = true
		}
	}
	if res.Chunks == nil {
		res.Chunks = []TextChunk{}
	}
	return res
}

// sides is what each side has for a chunk.
func (c TextChunk) sides() (o, a, b string) {
	switch c.Op {
	case TextSame:
		return c.Text, c.Text, c.Text
	case TextA:
		return c.Base, c.A, c.Base
	case TextB:
		return c.Base, c.Base, c.B
	case TextBoth:
		return c.Base, c.Text, c.Text
	}
	return c.Base, c.A, c.B
}

func (c TextChunk) changedBy(side string) bool {
	return c.Op == TextConflict || c.Op == TextBoth || c.Op == side
}

func classify(o, a, b string) TextChunk {
	switch {
	case a == o && b == o:
		return TextChunk{Op: TextSame, Text: o}
	case a == o:
		return TextChunk{Op: TextB, Base: o, B: b}
	case b == o:
		return TextChunk{Op: TextA, Base: o, A: a}
	case a == b:
		return TextChunk{Op: TextBoth, Base: o, Text: a}
	}
	return TextChunk{Op: TextConflict, Base: o, A: a, B: b}
}

// absorbSpaces joins two changed chunks with only spaces between them into
// one when the same side changed both: a side that rewrote "working from
// home" word by word rewrote the phrase, and the spaces the rewrite happened
// to keep are no footing for the other side's change. Two neighbouring
// changes by DIFFERENT sides stay apart, so A's word and B's next word both
// stand.
func absorbSpaces(in []TextChunk) []TextChunk {
	out := make([]TextChunk, 0, len(in))
	for i := 0; i < len(in); i++ {
		c := in[i]
		n := len(out)
		if c.Op == TextSame && n > 0 && i+1 < len(in) && out[n-1].Op != TextSame && in[i+1].Op != TextSame &&
			strings.TrimFunc(c.Text, func(r rune) bool { return tokenClass(r) == 2 }) == "" &&
			((out[n-1].changedBy(TextA) && in[i+1].changedBy(TextA)) || (out[n-1].changedBy(TextB) && in[i+1].changedBy(TextB))) {
			po, pa, pb := out[n-1].sides()
			no, na, nb := in[i+1].sides()
			out[n-1] = classify(po+c.Text+no, pa+c.Text+na, pb+c.Text+nb)
			i++
			continue
		}
		out = append(out, c)
	}
	return out
}
