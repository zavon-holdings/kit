// One button per email. The twin of kit/go/emailcta, held to the same vectors
// (contract/emailcta): the patterns use the same explicit white space as RE2
// (" \t\n\f\r"), never JavaScript's wider \s, so both read a body alike.

const W = "[ \\t\\n\\f\\r]";
const DATA = `\\b[^>]*\\bdata-cta${W}*=${W}*"button"[^>]*>[\\s\\S]*?`;
const CALL_TO_ACTION =
  `<table${DATA}</table>|<div${DATA}</div>|<a${DATA}</a>` +
  `|<p\\b[^>]*>${W}*(?:<(?:strong|b)>${W}*)?<a\\b[^>]*?\\bhref${W}*=${W}*"([^"]+)"[^>]*>([\\s\\S]*?)</a>${W}*(?:</(?:strong|b)>${W}*)?</p>`;
const ANCHOR = new RegExp(`<a\\b[^>]*?\\bhref${W}*=${W}*"([^"]+)"[^>]*>([\\s\\S]*?)</a>`, "i");
const EMAIL_LIKE = /^[^@ \t\n\f\r]+@[^@ \t\n\f\r]+\.[^@ \t\n\f\r]+$/;
const ENTITY = /&(#[0-9]+|#[xX][0-9a-fA-F]+|amp|lt|gt|quot|apos|nbsp);/g;
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** The plain text of an HTML fragment: tags dropped, common entities read, white space collapsed. */
export function text(fragment) {
  let s = fragment.replace(/<[^>]*>/g, "");
  s = s.replace(ENTITY, (e, name) => {
    if (name in NAMED) return NAMED[name];
    const n = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return e;
    return String.fromCodePoint(n);
  });
  return s.replace(/[ \t\n\f\r]+/g, " ").replace(/^ +| +$/g, "");
}

/** Text made safe for HTML, written as Go's html.EscapeString writes it. */
export function escape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;").replace(/"/g, "&#34;");
}

/** A renderer from two strings with {href} and {label}. */
export function templates(buttonHTML, linkHTML) {
  const fill = (s, label, href) => s.replace(/\{href\}|\{label\}/g, (m) => (m === "{href}" ? href : escape(label)));
  return {
    button: (label, href) => fill(buttonHTML, label, href),
    link: (label, href) => fill(linkHTML, label, href),
  };
}

/** Gives body one button: the first call to action; later ones become links. */
export function apply(body, renderer) {
  let placed = false;
  return body.replace(new RegExp(CALL_TO_ACTION, "gi"), (match, pHref, pInner) => {
    let href = pHref ?? "";
    let inner = pInner ?? "";
    if (href === "") {
      const a = ANCHOR.exec(match);
      if (!a) return match;
      href = a[1];
      inner = a[2];
    }
    const label = text(inner);
    const lower = href.replace(/^[ \t\n\f\r]+|[ \t\n\f\r]+$/g, "").toLowerCase();
    if (label === "" || lower.startsWith("mailto:") || lower.startsWith("tel:") || EMAIL_LIKE.test(label)) return match;
    if (!placed) {
      placed = true;
      return renderer.button(label, href);
    }
    return renderer.link(label, href);
  });
}
