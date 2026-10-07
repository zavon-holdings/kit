/**
 * The editor's icons: small inline strokes in currentColor, decorative only
 * (every icon sits beside words or inside a control with its own name).
 */
import type { ReactNode } from "react";
import type { NodeCategory } from "../design.js";

const P = (d: string) => <path d={d} />;

const SHAPES: Record<string, ReactNode> = {
  // Node types
  start: <path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none" />,
  end: (
    <>
      {P("M5 21V4")}
      {P("M5 4h11l-2 4 2 4H5")}
    </>
  ),
  condition: P("M12 3l8.5 9L12 21l-8.5-9z"),
  decision: (
    <>
      {P("M12 21v-7")}
      {P("M12 14L5 7")}
      {P("M12 14l7-7")}
      {P("M5 11V7h4")}
      {P("M19 11V7h-4")}
    </>
  ),
  fork: (
    <>
      {P("M12 21v-6")}
      {P("M12 15c0-4-5-5-5-10")}
      {P("M12 15c0-4 5-5 5-10")}
      {P("M4.5 7.5 7 5l2.5 2.5")}
      {P("M14.5 7.5 17 5l2.5 2.5")}
    </>
  ),
  join: (
    <>
      {P("M6 3v3a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3")}
      {P("M12 12v9")}
      {P("M9 18l3 3 3-3")}
    </>
  ),
  loop: (
    <>
      {P("M17 2l3 3-3 3")}
      {P("M4 11v-1a5 5 0 0 1 5-5h11")}
      {P("M7 22l-3-3 3-3")}
      {P("M20 13v1a5 5 0 0 1-5 5H4")}
    </>
  ),
  sub_workflow: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <rect x="8" y="8" width="8" height="8" rx="2" />
    </>
  ),
  review: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2.5" />
      {P("M9 4V2.8h6V4")}
      {P("M9 12.5l2 2 4-4.5")}
    </>
  ),
  form: (
    <>
      {P("M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z")}
      {P("M14 3v5h5")}
      {P("M9 13h6")}
      {P("M9 17h4")}
    </>
  ),
  approval: (
    <>
      {P("M12 2.8l7.5 3v5.4c0 4.8-3.3 8.4-7.5 10-4.2-1.6-7.5-5.2-7.5-10V5.8z")}
      {P("M8.8 12l2.3 2.3 4.2-4.6")}
    </>
  ),
  todo: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      {P("M8.5 12l2.5 2.5 4.5-5")}
    </>
  ),
  email: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      {P("M3.5 7l8.5 6 8.5-6")}
    </>
  ),
  notification: (
    <>
      {P("M6 9a6 6 0 0 1 12 0c0 6.5 2.5 8 2.5 8h-17S6 15.5 6 9")}
      {P("M10.3 20.5a2 2 0 0 0 3.4 0")}
    </>
  ),
  payment_request: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      {P("M2.5 10h19")}
      {P("M6.5 15h4")}
    </>
  ),
  invoice: (
    <>
      {P("M6 2.5h12v19l-3-2-3 2-3-2-3 2z")}
      {P("M9 7.5h6")}
      {P("M9 11.5h6")}
      {P("M9 15.5h3")}
    </>
  ),
  delay: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P("M12 7v5l3.2 2")}
    </>
  ),
  wait_event: (
    <>
      {P("M6 2.5h12")}
      {P("M6 21.5h12")}
      {P("M7.5 2.5v3.5l4.5 6-4.5 6v3.5")}
      {P("M16.5 2.5v3.5l-4.5 6 4.5 6v3.5")}
    </>
  ),
  call: P("M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z"),
  webhook: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P("M3 12h18")}
      {P("M12 3a13.5 13.5 0 0 1 0 18")}
      {P("M12 3a13.5 13.5 0 0 0 0 18")}
    </>
  ),
  set_var: (
    <>
      {P("M8 3.5H7a2 2 0 0 0-2 2V10a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4.5a2 2 0 0 0 2 2h1")}
      {P("M16 3.5h1a2 2 0 0 1 2 2V10a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4.5a2 2 0 0 1-2 2h-1")}
    </>
  ),
  // Categories
  "cat-logic": P("M12 3l8.5 9L12 21l-8.5-9z"),
  "cat-people": (
    <>
      <circle cx="9" cy="8" r="3.5" />
      {P("M2.5 20a6.5 6.5 0 0 1 13 0")}
      {P("M16 4.6a3.5 3.5 0 0 1 0 6.8")}
      {P("M18.5 14.5a6.5 6.5 0 0 1 3 5.5")}
    </>
  ),
  "cat-structure": <path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none" />,
  // Interface
  undo: (
    <>
      {P("M9 14 4 9l5-5")}
      {P("M4 9h11a5 5 0 0 1 0 10h-3")}
    </>
  ),
  redo: (
    <>
      {P("m15 14 5-5-5-5")}
      {P("M20 9H9a5 5 0 0 0 0 10h3")}
    </>
  ),
  tidy: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="8.5" y="14" width="7" height="7" rx="1.5" />
      {P("M6.5 10v2h11v-2")}
      {P("M12 12v2")}
    </>
  ),
  note: (
    <>
      {P("M15 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z")}
      {P("M15 21v-6h6")}
    </>
  ),
  plus: (
    <>
      {P("M12 5v14")}
      {P("M5 12h14")}
    </>
  ),
  minus: P("M5 12h14"),
  fit: (
    <>
      {P("M4 9V5a1 1 0 0 1 1-1h4")}
      {P("M15 4h4a1 1 0 0 1 1 1v4")}
      {P("M20 15v4a1 1 0 0 1-1 1h-4")}
      {P("M9 20H5a1 1 0 0 1-1-1v-4")}
    </>
  ),
  map: (
    <>
      {P("M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z")}
      {P("M9 4v14")}
      {P("M15 6v14")}
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      {P("M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9")}
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      {P("m20 20-3.6-3.6")}
    </>
  ),
  trash: (
    <>
      {P("M4 7h16")}
      {P("M9.5 7V4.5h5V7")}
      {P("M6 7l1 13h10l1-13")}
    </>
  ),
  check: P("M5 12.5l4.5 4.5L19 7.5"),
  x: (
    <>
      {P("M6 6l12 12")}
      {P("M18 6 6 18")}
    </>
  ),
  alert: (
    <>
      {P("M12 3.5 2.5 20h19z")}
      {P("M12 10v4.5")}
      {P("M12 17.5h.01")}
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2.5" />
      {P("M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3")}
    </>
  ),
  grip: (
    <>
      {P("M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01")}
    </>
  ),
};

const CATEGORY_SHAPE: Record<NodeCategory, string> = {
  logic: "cat-logic",
  people: "cat-people",
  messages: "email",
  money: "payment_request",
  timing: "delay",
  apps: "call",
  structure: "cat-structure",
};

/** An icon by node type, category ("cat-…") or interface name. Unknown names draw a dot. */
export function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const shape = SHAPES[name] ?? <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />;
  return (
    <svg
      className={className ? `zwf-icon ${className}` : "zwf-icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shape}
    </svg>
  );
}

export function CategoryIcon({ category, size }: { category: NodeCategory; size?: number }) {
  return <Icon name={CATEGORY_SHAPE[category]} size={size} />;
}
