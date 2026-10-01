/**
 * Undo and redo, as a pure value. The editor is controlled, so history is a
 * list of whole graphs the host was handed: undo hands the previous one back
 * through the same onChange every other edit uses, and the host never needs
 * to know an edit was an undo.
 *
 * Typing is one edit per keystroke. Edits that say they belong together (the
 * same `key` — "name:review", "config:review") within COALESCE_MS of each
 * other are one step of history, so undo takes back a word, not a letter.
 */

export const MAX_HISTORY = 100;
export const COALESCE_MS = 1000;

export type History<T> = {
  past: T[];
  future: T[];
  /** The coalescing key and time of the last recorded edit. */
  lastKey?: string;
  lastAt?: number;
};

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [] };
}

/**
 * Records that `before` was replaced by an edit. An edit with the same key
 * as the last one, soon after it, extends that step instead of adding one.
 * Any new edit clears what could be redone.
 */
export function record<T>(h: History<T>, before: T, key: string | undefined, now: number): History<T> {
  const coalesce = key !== undefined && key === h.lastKey && h.lastAt !== undefined && now - h.lastAt <= COALESCE_MS && h.past.length > 0;
  const past = coalesce ? h.past : [...h.past, before].slice(-MAX_HISTORY);
  return { past, future: [], lastKey: key, lastAt: now };
}

/** The graph to go back to, and the history after going there; null when there is none. */
export function undo<T>(h: History<T>, present: T): { history: History<T>; value: T } | null {
  if (h.past.length === 0) return null;
  const value = h.past[h.past.length - 1];
  return { value, history: { past: h.past.slice(0, -1), future: [present, ...h.future].slice(0, MAX_HISTORY) } };
}

/** The graph to go forward to again; null when nothing was undone. */
export function redo<T>(h: History<T>, present: T): { history: History<T>; value: T } | null {
  if (h.future.length === 0) return null;
  const [value, ...future] = h.future;
  return { value, history: { past: [...h.past, present].slice(-MAX_HISTORY), future } };
}
