/**
 * A condition as rows a person can edit: field, operator, value, joined by
 * "all" or "any". The condition language has more (not, nesting); a
 * condition that uses it is not flattened here — the builder shows it as
 * JSON instead, so nothing is lost by opening it.
 */

export type Row = { field: string; op: string; value: string };
export type Rows = { join: "all" | "any"; rows: Row[] };

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Operators that take no value. */
export const NO_VALUE = new Set(["exists", "missing"]);
/** Operators that take a list. */
export const LIST_VALUE = new Set(["in", "not_in"]);

function leaf(v: unknown): Row | null {
  if (!isObject(v)) return null;
  const keys = Object.keys(v);
  if (!keys.every((k) => k === "field" || k === "op" || k === "value")) return null;
  if (typeof v.field !== "string") return null;
  const op = typeof v.op === "string" && v.op ? v.op : "is";
  return { field: v.field, op, value: "value" in v ? valueText(v.value, op) : "" };
}

/** The rows a condition is, or null when it needs more than rows can say. */
export function toRows(when: unknown): Rows | null {
  if (when === undefined || when === null) return { join: "all", rows: [] };
  if (Array.isArray(when)) {
    const rows = when.map(leaf);
    return rows.every(Boolean) ? { join: "all", rows: rows as Row[] } : null;
  }
  if (!isObject(when)) return null;
  if (Object.keys(when).length === 0) return { join: "all", rows: [] };
  for (const join of ["all", "any"] as const) {
    if (join in when && Object.keys(when).length === 1) {
      const list = when[join];
      if (!Array.isArray(list)) return null;
      const rows = list.map(leaf);
      return rows.every(Boolean) ? { join, rows: rows as Row[] } : null;
    }
  }
  const one = leaf(when);
  return one ? { join: "all", rows: [one] } : null;
}

/** The condition rows write. No rows is the empty condition, {}. */
export function fromRows(r: Rows): unknown {
  const leaves = r.rows.map((row) => {
    const out: Record<string, unknown> = { field: row.field.trim(), op: row.op };
    if (!NO_VALUE.has(row.op)) out.value = parseValue(row.value, row.op);
    return out;
  });
  if (leaves.length === 0) return {};
  if (leaves.length === 1 && r.join === "all") return leaves[0];
  return { [r.join]: leaves };
}

function scalar(text: string): unknown {
  const t = text.trim();
  if (t === "") return "";
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if ((t.startsWith('"') && t.endsWith('"')) || t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(t);
    } catch {
      return text;
    }
  }
  return text;
}

/** A typed value from what was typed: numbers, true/false, quoted text, JSON; a list for in/not_in. */
export function parseValue(text: string, op: string): unknown {
  if (LIST_VALUE.has(op)) {
    const t = text.trim();
    if (t.startsWith("[")) {
      try {
        const v = JSON.parse(t);
        if (Array.isArray(v)) return v;
      } catch {
        /* fall through to commas */
      }
    }
    return t === "" ? [] : t.split(",").map((s) => scalar(s.trim()));
  }
  return scalar(text);
}

/** What a value is typed as, so typing it back gives the same value. */
export function valueText(v: unknown, op = "is"): string {
  if (LIST_VALUE.has(op) && Array.isArray(v) && v.every((x) => typeof x !== "object" || x === null)) {
    return v.map((x) => (typeof x === "string" ? (typeof scalar(x) === "string" && !x.includes(",") ? x : JSON.stringify(x)) : String(x))).join(", ");
  }
  if (typeof v === "string") return typeof scalar(v) === "string" ? v : JSON.stringify(v);
  if (v === undefined) return "";
  return JSON.stringify(v);
}
