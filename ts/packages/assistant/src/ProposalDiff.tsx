// Before and after of a proposal, as a list. Each change has a text label
// (Added, Removed, Changed), so colour is never the only sign; a changed item
// shows what it was and what it becomes.
import type { ReactNode } from "react";
import { countChanges, diffFields, diffItems, type DiffKind } from "./diff.js";

export interface ProposalDiffCopy {
  added: string;
  removed: string;
  changed: string;
  unchanged: string;
  before: string;
  after: string;
  /** Said when nothing changes. */
  noChanges: string;
  /** The count line, for example "1 added, 2 changed, 0 removed". */
  summary: (counts: Record<DiffKind, number>) => string;
  /** The list's name. */
  label: string;
}

export const DEFAULT_PROPOSAL_DIFF_COPY: ProposalDiffCopy = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
  unchanged: "Unchanged",
  before: "Before",
  after: "After",
  noChanges: "No changes.",
  summary: (c) => `${c.added} added, ${c.changed} changed, ${c.removed} removed`,
  label: "Proposed changes",
};

type Fields = Record<string, unknown>;

export interface ProposalDiffProps<T = unknown> {
  /** A list of items (blocks, rows), or an object of plain fields. */
  before: readonly T[] | Fields;
  /** The same shape as `before`. */
  after: readonly T[] | Fields;
  /** Draws one item or field value. The default draws text, a block's text, or JSON. */
  renderItem?: (item: T, side: "before" | "after") => ReactNode;
  /** Matches list items by key; without it, items are matched by content and place. */
  keyOf?: (item: T, index: number) => string;
  /** Names for plain fields, by field. */
  fieldLabels?: Record<string, string>;
  /** Leaves out what does not change. */
  hideUnchanged?: boolean;
  copy?: Partial<ProposalDiffCopy>;
  className?: string;
}

/** The text of a value: a string or number, an item's `text`, a block's `data.text`, or JSON. */
export function defaultItemText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.text === "string") return v.text;
    const data = v.data as Record<string, unknown> | undefined;
    if (data && typeof data === "object" && typeof data.text === "string") return data.text;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function ProposalDiff<T = unknown>({
  before,
  after,
  renderItem,
  keyOf,
  fieldLabels,
  hideUnchanged = false,
  copy,
  className,
}: ProposalDiffProps<T>) {
  const c = { ...DEFAULT_PROPOSAL_DIFF_COPY, ...copy };
  const draw = (v: unknown, side: "before" | "after"): ReactNode => (renderItem ? renderItem(v as T, side) : defaultItemText(v));
  const isList = Array.isArray(before) && Array.isArray(after);

  type Row = { key: string; kind: DiffKind; before?: unknown; after?: unknown; name?: string };
  const rows: Row[] = isList
    ? diffItems(before as readonly T[], after as readonly T[], keyOf)
    : diffFields((Array.isArray(before) ? {} : before) as Fields, (Array.isArray(after) ? {} : after) as Fields).map((d) => ({
        ...d,
        key: d.field,
        name: fieldLabels?.[d.field] ?? d.field,
      }));
  const counts = countChanges(rows);
  const shown = hideUnchanged ? rows.filter((r) => r.kind !== "unchanged") : rows;
  const label: Record<DiffKind, string> = { added: c.added, removed: c.removed, changed: c.changed, unchanged: c.unchanged };
  const nothing = counts.added + counts.removed + counts.changed === 0;

  return (
    <div className={["zai-diff", className ?? ""].filter(Boolean).join(" ")}>
      <p className="zai-diff__summary">{nothing ? c.noChanges : c.summary(counts)}</p>
      {shown.length > 0 ? (
        <ol className="zai-diff__list" aria-label={c.label}>
          {shown.map((r) => (
            <li key={r.key} className={`zai-diff__item zai-diff__item--${r.kind}`} data-kind={r.kind}>
              <span className="zai-diff__mark">{label[r.kind]}</span>
              {r.name !== undefined ? <span className="zai-diff__field">{r.name}</span> : null}
              {r.kind === "changed" ? (
                <span className="zai-diff__pair">
                  <span className="zai-diff__side">
                    <span className="zai-diff__side-label">{c.before}</span>
                    <del className="zai-diff__before">{draw(r.before, "before")}</del>
                  </span>
                  <span className="zai-diff__side">
                    <span className="zai-diff__side-label">{c.after}</span>
                    <ins className="zai-diff__after">{draw(r.after, "after")}</ins>
                  </span>
                </span>
              ) : r.kind === "added" ? (
                <ins className="zai-diff__after">{draw(r.after, "after")}</ins>
              ) : r.kind === "removed" ? (
                <del className="zai-diff__before">{draw(r.before, "before")}</del>
              ) : (
                <span className="zai-diff__same">{draw(r.after, "after")}</span>
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
