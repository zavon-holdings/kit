package merge3

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"
	"unicode/utf8"
)

// Canonical writes a JSON value with object keys sorted and no spaces,
// numbers and strings as JavaScript's JSON.stringify writes them, so the
// TypeScript twin produces the same text.
func Canonical(v any) string {
	var sb strings.Builder
	writeCanon(&sb, normalize(v))
	return sb.String()
}

// normalize turns any Go value into plain JSON values (float64, string,
// bool, nil, []any, map[string]any).
func normalize(v any) any {
	switch x := v.(type) {
	case nil, bool, float64, string:
		return x
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = normalize(e)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, e := range x {
			out[k] = normalize(e)
		}
		return out
	case []string:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = e
		}
		return out
	case Unit:
		return x.Value()
	case Place:
		return x.value()
	default:
		raw, err := json.Marshal(x)
		if err != nil {
			return nil
		}
		var back any
		if json.Unmarshal(raw, &back) != nil {
			return nil
		}
		return back
	}
}

func writeCanon(sb *strings.Builder, v any) {
	switch x := v.(type) {
	case nil:
		sb.WriteString("null")
	case bool:
		if x {
			sb.WriteString("true")
		} else {
			sb.WriteString("false")
		}
	case float64:
		if x == 0 {
			sb.WriteString("0")
			return
		}
		raw, err := json.Marshal(x)
		if err != nil {
			sb.WriteString("null")
			return
		}
		sb.Write(raw)
	case string:
		writeString(sb, x)
	case []any:
		sb.WriteByte('[')
		for i, e := range x {
			if i > 0 {
				sb.WriteByte(',')
			}
			writeCanon(sb, e)
		}
		sb.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		sb.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				sb.WriteByte(',')
			}
			writeString(sb, k)
			sb.WriteByte(':')
			writeCanon(sb, x[k])
		}
		sb.WriteByte('}')
	default:
		writeCanon(sb, normalize(x))
	}
}

const hexDigits = "0123456789abcdef"

func writeString(sb *strings.Builder, s string) {
	sb.WriteByte('"')
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		switch {
		case r == '"':
			sb.WriteString(`\"`)
		case r == '\\':
			sb.WriteString(`\\`)
		case r == '\b':
			sb.WriteString(`\b`)
		case r == '\f':
			sb.WriteString(`\f`)
		case r == '\n':
			sb.WriteString(`\n`)
		case r == '\r':
			sb.WriteString(`\r`)
		case r == '\t':
			sb.WriteString(`\t`)
		case r < 0x20:
			sb.WriteString(`\u00`)
			sb.WriteByte(hexDigits[r>>4])
			sb.WriteByte(hexDigits[r&0xf])
		default:
			sb.WriteString(s[i : i+size])
		}
		i += size
	}
	sb.WriteByte('"')
}

func hash(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func cloneValue(v any) any {
	switch x := v.(type) {
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = cloneValue(e)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, e := range x {
			out[k] = cloneValue(e)
		}
		return out
	default:
		return x
	}
}
