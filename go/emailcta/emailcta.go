// Package emailcta gives an email exactly one button: the first call to
// action. Later calls to action become accent links, so a message never
// offers two competing buttons, whoever wrote its body — a template, a
// rich-text editor, or code. Held to the vectors in contract/emailcta; the
// twin of @zavon/emailcta.
//
// A call to action is either a button a host already built — an element
// (table, div or a) carrying data-cta="button" — or a paragraph that is
// nothing but one link (optionally in <strong> or <b>). An email address is
// never a button: a mailto: or tel: link, or link text that is an address,
// stays as it is. A link inside a sentence is not a call to action at all.
//
// Each shell applies this as its last step, with its own button and link
// markup. The button markup should carry data-cta="button" on its outer
// element, so applying the rule twice changes nothing.
package emailcta

import (
	"regexp"
	"strconv"
	"strings"
)

// Renderer draws the host's button and accent link. Label is plain text
// (escape it); href is as it appeared in the HTML (already attribute-safe).
type Renderer interface {
	Button(label, href string) string
	Link(label, href string) string
}

// Templates is a Renderer from two strings with {href} and {label}: the
// label is escaped, the href is put in as it was.
type Templates struct {
	ButtonHTML string
	LinkHTML   string
}

func (t Templates) fill(s, label, href string) string {
	return strings.NewReplacer("{href}", href, "{label}", Escape(label)).Replace(s)
}

// Button draws the one button.
func (t Templates) Button(label, href string) string { return t.fill(t.ButtonHTML, label, href) }

// Link draws a later call to action.
func (t Templates) Link(label, href string) string { return t.fill(t.LinkHTML, label, href) }

var (
	callToAction = regexp.MustCompile(`(?is)<table\b[^>]*\bdata-cta[ \t\n\f\r]*=[ \t\n\f\r]*"button"[^>]*>.*?</table>|<div\b[^>]*\bdata-cta[ \t\n\f\r]*=[ \t\n\f\r]*"button"[^>]*>.*?</div>|<a\b[^>]*\bdata-cta[ \t\n\f\r]*=[ \t\n\f\r]*"button"[^>]*>.*?</a>` +
		`|<p\b[^>]*>[ \t\n\f\r]*(?:<(?:strong|b)>[ \t\n\f\r]*)?<a\b[^>]*?\bhref[ \t\n\f\r]*=[ \t\n\f\r]*"([^"]+)"[^>]*>(.*?)</a>[ \t\n\f\r]*(?:</(?:strong|b)>[ \t\n\f\r]*)?</p>`)
	anchor    = regexp.MustCompile(`(?is)<a\b[^>]*?\bhref[ \t\n\f\r]*=[ \t\n\f\r]*"([^"]+)"[^>]*>(.*?)</a>`)
	tag       = regexp.MustCompile(`<[^>]*>`)
	space     = regexp.MustCompile(`[ \t\n\f\r]+`)
	emailLike = regexp.MustCompile(`^[^@ \t\n\f\r]+@[^@ \t\n\f\r]+\.[^@ \t\n\f\r]+$`)
	entity    = regexp.MustCompile(`&(#[0-9]+|#[xX][0-9a-fA-F]+|amp|lt|gt|quot|apos|nbsp);`)
)

// Apply gives body one button.
func Apply(body string, r Renderer) string {
	placed := false
	return callToAction.ReplaceAllStringFunc(body, func(match string) string {
		sm := callToAction.FindStringSubmatch(match)
		href, inner := sm[1], sm[2]
		if href == "" {
			a := anchor.FindStringSubmatch(match)
			if a == nil {
				return match
			}
			href, inner = a[1], a[2]
		}
		label := Text(inner)
		lower := strings.ToLower(strings.Trim(href, " \t\n\f\r"))
		if label == "" || strings.HasPrefix(lower, "mailto:") || strings.HasPrefix(lower, "tel:") || emailLike.MatchString(label) {
			return match
		}
		if !placed {
			placed = true
			return r.Button(label, href)
		}
		return r.Link(label, href)
	})
}

// Text is the plain text of an HTML fragment: tags dropped, the common
// entities read, white space collapsed.
func Text(fragment string) string {
	s := tag.ReplaceAllString(fragment, "")
	s = entity.ReplaceAllStringFunc(s, func(e string) string {
		name := e[1 : len(e)-1]
		switch name {
		case "amp":
			return "&"
		case "lt":
			return "<"
		case "gt":
			return ">"
		case "quot":
			return `"`
		case "apos":
			return "'"
		case "nbsp":
			return " "
		}
		var n int64
		var err error
		if strings.HasPrefix(name, "#x") || strings.HasPrefix(name, "#X") {
			n, err = strconv.ParseInt(name[2:], 16, 32)
		} else {
			n, err = strconv.ParseInt(name[1:], 10, 32)
		}
		if err != nil || n <= 0 || n > 0x10FFFF {
			return e
		}
		return string(rune(n))
	})
	return strings.Trim(space.ReplaceAllString(s, " "), " ")
}

// Escape is text made safe for HTML, the five characters Go's html package
// escapes, written the same way.
func Escape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `'`, "&#39;", `"`, "&#34;").Replace(s)
}
