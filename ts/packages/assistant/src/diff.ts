// Before and after of a proposal: a list of items (blocks, rows) or a set of
// plain fields. Pure, so a host can count changes without drawing them.

export type DiffKind = "added" | "removed" | "changed" | "unchanged";

export interface ItemDiff<T> {
  kind: DiffKind;
  /** The item before, for removed, changed and unchanged. */
  before?: T;
  /** The item after, for added, changed and unchanged. */
  after?: T;
  /** A stable key for drawing. */
  key: string;
}

export interface FieldDiff<V = unknown> {
  kind: DiffKind;
  field: string;
  before?: V;
  after?: V;
}

/** Deep equality for JSON-like values. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Compares two lists. With `keyOf`, items are matched by key: a key in both
 * is changed or unchanged, a key only before is removed, only after is
 * added. Without it, the longest run of equal items is kept and a removal
 * directly followed by an addition at the same place is one change.
 */
export function diffItems<T>(before: readonly T[], after: readonly T[], keyOf?: (item: T, index: number) => string): ItemDiff<T>[] {
  if (keyOf) return diffByKey(before, after, keyOf);
  const n = before.length;
  const m = after.length;
  // Longest common subsequence table, from the end.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = sameValue(before[i], after[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const raw: ItemDiff<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && sameValue(before[i], after[j])) {
      raw.push({ kind: "unchanged", before: before[i], after: after[j], key: `u${i}-${j}` });
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      raw.push({ kind: "added", after: after[j], key: `a${j}` });
      j++;
    } else {
      raw.push({ kind: "removed", before: before[i], key: `r${i}` });
      i++;
    }
  }
  // Pair removals with additions in the same gap as changes.
  const out: ItemDiff<T>[] = [];
  for (let k = 0; k < raw.length; ) {
    if (raw[k].kind === "unchanged") {
      out.push(raw[k++]);
      continue;
    }
    const removed: ItemDiff<T>[] = [];
    const added: ItemDiff<T>[] = [];
    while (k < raw.length && raw[k].kind !== "unchanged") {
      (raw[k].kind === "removed" ? removed : added).push(raw[k]);
      k++;
    }
    const pairs = Math.min(removed.length, added.length);
    for (let p = 0; p < pairs; p++) {
      out.push({ kind: "changed", before: removed[p].before, after: added[p].after, key: `c${removed[p].key}-${added[p].key}` });
    }
    out.push(...removed.slice(pairs), ...added.slice(pairs));
  }
  return out;
}

function diffByKey<T>(before: readonly T[], after: readonly T[], keyOf: (item: T, index: number) => string): ItemDiff<T>[] {
  const old = new Map<string, T>();
  before.forEach((item, i) => old.set(keyOf(item, i), item));
  const seen = new Set<string>();
  const out: ItemDiff<T>[] = [];
  after.forEach((item, j) => {
    const key = keyOf(item, j);
    seen.add(key);
    if (old.has(key)) {
      const was = old.get(key) as T;
      out.push({ kind: sameValue(was, item) ? "unchanged" : "changed", before: was, after: item, key });
    } else {
      out.push({ kind: "added", after: item, key });
    }
  });
  // A removed item goes after the item that came before it, or first.
  before.forEach((item, i) => {
    const key = keyOf(item, i);
    if (seen.has(key)) return;
    let at = 0;
    for (let p = i - 1; p >= 0; p--) {
      const prev = keyOf(before[p], p);
      const idx = out.findIndex((d) => d.key === prev);
      if (idx >= 0) {
        at = idx + 1;
        break;
      }
    }
    out.splice(at, 0, { kind: "removed", before: item, key });
  });
  return out;
}

/** Compares two sets of plain fields, in the order of `before`'s fields then the new ones. */
export function diffFields<V = unknown>(before: Readonly<Record<string, V>>, after: Readonly<Record<string, V>>): FieldDiff<V>[] {
  const fields = [...Object.keys(before), ...Object.keys(after).filter((k) => !(k in before))];
  return fields.map((field) => {
    const inBefore = Object.prototype.hasOwnProperty.call(before, field);
    const inAfter = Object.prototype.hasOwnProperty.call(after, field);
    if (!inBefore) return { kind: "added", field, after: after[field] };
    if (!inAfter) return { kind: "removed", field, before: before[field] };
    return { kind: sameValue(before[field], after[field]) ? "unchanged" : "changed", field, before: before[field], after: after[field] };
  });
}

/** Counts the changes in a diff. */
export function countChanges(diff: readonly { kind: DiffKind }[]): Record<DiffKind, number> {
  const out: Record<DiffKind, number> = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  for (const d of diff) out[d.kind]++;
  return out;
}
