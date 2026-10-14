export interface Renderer {
  /** The one button. label is plain text (escape it); href is as it appeared in the HTML. */
  button(label: string, href: string): string;
  /** A later call to action. */
  link(label: string, href: string): string;
}

/** Gives body one button: the first call to action; later ones become accent links. */
export function apply(body: string, renderer: Renderer): string;

/** A renderer from two strings with {href} and {label} (the label escaped). */
export function templates(buttonHTML: string, linkHTML: string): Renderer;

/** The plain text of an HTML fragment. */
export function text(fragment: string): string;

/** Text made safe for HTML, as Go's html.EscapeString writes it. */
export function escape(s: string): string;
