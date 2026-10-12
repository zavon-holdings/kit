/**
 * Step requirements and snooze, the client half.
 *
 * Step requirements: a step can name fields that must be filled before an
 * item moves FORWARD out of it. Moving back, or to a step that closes the
 * item, is never blocked. A key the catalogue does not hold is never filled.
 * The server enforces this; a screen uses these functions only to explain it
 * before the click and to ask for the values.
 *
 * Snooze: "not now, ask me later". A count and a unit, or a date, resolved to
 * one instant. A snooze in the past has lapsed and the item is awake again.
 *
 * Every function is pure and held to contract/stepgates.
 */

/** The 422 body's stable code. */
export const FIELDS_REQUIRED = "stage_fields_required";

/** Whether one stored value counts as filled. Zero and false are answers. */
export function isFilled(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

/**
 * The required fields of `from` that block a move to `to`.
 * from/to: {order, closing, required}. filled: a Set or array of keys, or a
 * function(key) → boolean. catalogue: the keys a step may require; omit it
 * when the caller has already checked them.
 */
export function missingFields(from, to, filled, catalogue) {
  if (!from || !to) return [];
  const required = from.required ?? [];
  if (required.length === 0) return [];
  if (!(to.order > from.order) || to.closing) return [];
  const has =
    typeof filled === "function"
      ? filled
      : (k) => (filled instanceof Set ? filled.has(k) : (filled ?? []).includes(k));
  const known = catalogue ? new Set(catalogue) : null;
  return required.filter((k) => (known && !known.has(k)) || !has(k));
}

/** "Score", "Score and Reviewer", "Score, Reviewer and Start date". */
export function joinLabels(labels) {
  const l = labels.filter(Boolean);
  if (l.length <= 1) return l.join("");
  return `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}`;
}

/** The editor's preview of a step's requirements. Empty when there are none. */
export function requirementSentence(stage, labels) {
  if (!labels.length) return "";
  const verb = labels.length === 1 ? "is" : "are";
  return `Items can't leave ${stage} until ${joinLabels(labels)} ${verb} filled.`;
}

/** What a refused move says. Empty when nothing is missing. */
export function blockedMessage(stage, labels) {
  if (!labels.length) return "";
  return `Fill in ${joinLabels(labels)} to move this item out of ${stage}.`;
}

/**
 * Reads a refused move. Returns {stage, fields, labels, message} for a 422
 * with code stage_fields_required, and null for anything else.
 */
export function parseFieldsRequired(status, body) {
  if (status !== 422 || !body || typeof body !== "object") return null;
  const b = body.error && typeof body.error === "object" && !body.code ? body.error : body;
  if (b.code !== FIELDS_REQUIRED || !Array.isArray(b.fields)) return null;
  return {
    stage: typeof b.stage === "string" ? b.stage : "",
    fields: b.fields.filter((f) => typeof f === "string"),
    labels: b.labels && typeof b.labels === "object" ? b.labels : {},
    message: typeof b.message === "string" ? b.message : "",
  };
}

/* ── snooze ── */

export const SNOOZE_UNITS = ["days", "weeks", "months"];
export const MAX_AHEAD_DAYS = 730;
const DAY = 86_400_000;

/** The quick choices a Snooze menu offers; "A date…" is the menu's own. */
export const SNOOZE_PRESETS = [
  { key: "tomorrow", label: "Tomorrow", count: 1, unit: "days" },
  { key: "next_week", label: "Next week", count: 1, unit: "weeks" },
  { key: "two_weeks", label: "2 weeks", count: 2, unit: "weeks" },
];

/** A refused snooze. code is one of empty, both_forms, unit, count, unreadable, past, too_far. */
export class SnoozeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SnoozeError";
    this.code = code;
  }
}

const SNOOZE_MESSAGES = {
  empty: "Choose how long to snooze for, or a date.",
  both_forms: "Give a date or a length of time, not both.",
  unit: "Snooze for days, weeks or months.",
  count: "Snooze for at least one day, week or month.",
  unreadable: "Give the date as a full date and time.",
  past: "That time has already passed.",
  too_far: "Snooze for two years or less.",
};

const fail = (code) => {
  throw new SnoozeError(code, SNOOZE_MESSAGES[code]);
};

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Resolves {count, unit} or {until} to a Date, or throws SnoozeError. */
export function resolveSnooze(req, now = new Date()) {
  const until = typeof req?.until === "string" ? req.until.trim() : "";
  const unit = typeof req?.unit === "string" ? req.unit.trim().toLowerCase() : "";
  const count = Number(req?.count ?? 0);
  const hasUntil = until !== "";
  const hasEvery = count !== 0 || unit !== "";
  if (hasUntil && hasEvery) fail("both_forms");
  if (!hasUntil && !hasEvery) fail("empty");
  let at;
  if (hasUntil) {
    if (!RFC3339.test(until)) fail("unreadable");
    at = new Date(until);
    if (Number.isNaN(at.getTime())) fail("unreadable");
  } else {
    if (!Number.isInteger(count) || count < 1) fail("count");
    at = new Date(now.getTime());
    if (unit === "days") at.setUTCDate(at.getUTCDate() + count);
    else if (unit === "weeks") at.setUTCDate(at.getUTCDate() + 7 * count);
    else if (unit === "months") at.setUTCMonth(at.getUTCMonth() + count);
    else fail("unit");
  }
  if (at.getTime() <= now.getTime()) fail("past");
  if (at.getTime() - now.getTime() > MAX_AHEAD_DAYS * DAY) fail("too_far");
  return at;
}

/** Whether an item is snoozed RIGHT NOW. A snooze in the past has lapsed. */
export function isSnoozed(until, now = new Date()) {
  if (!until) return false;
  const at = new Date(until);
  return !Number.isNaN(at.getTime()) && at.getTime() > now.getTime();
}

/** "Snoozed until 14 Oct" — the date, for a card or a row. Empty when awake. */
export function snoozeLabel(until, now = new Date(), locale) {
  if (!isSnoozed(until, now)) return "";
  const at = new Date(until);
  const sameYear = at.getUTCFullYear() === now.getUTCFullYear();
  const when = at.toLocaleDateString(locale, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  return `Snoozed until ${when}`;
}

export const SNOOZED_FILTERS = ["", "hide", "only"];

/**
 * Applies a snoozed filter. Returns {items, total, counts, snoozedCount}.
 * counts are per stage over the KEPT items, so they add up to total.
 * stageOf(item) names an item's column; untilOf(item) its snooze.
 */
export function filterSnoozed(items, filter = "", opts = {}) {
  if (!SNOOZED_FILTERS.includes(filter)) throw new Error("snoozed is hide or only");
  const now = opts.now ?? new Date();
  const stageOf = opts.stageOf ?? ((i) => i.stage);
  const untilOf = opts.untilOf ?? ((i) => i.snoozed_until);
  let snoozedCount = 0;
  const kept = [];
  const counts = {};
  for (const item of items) {
    const asleep = isSnoozed(untilOf(item), now);
    if (asleep) snoozedCount++;
    if ((filter === "hide" && asleep) || (filter === "only" && !asleep)) continue;
    kept.push(item);
    const s = stageOf(item);
    if (s !== undefined && s !== null && s !== "") counts[s] = (counts[s] ?? 0) + 1;
  }
  return { items: kept, total: kept.length, counts, snoozedCount };
}

/** The "Show snoozed" toggle, remembered per browser. Storage may be absent or throw. */
export function loadShowSnoozed(key, storage) {
  try {
    const s = storage ?? globalThis.localStorage;
    return s?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function saveShowSnoozed(key, value, storage) {
  try {
    const s = storage ?? globalThis.localStorage;
    s?.setItem(key, value ? "1" : "0");
  } catch {
    /* a private window: the toggle still works for this page */
  }
}

/** The toggle's words: "Show snoozed (3)" / "Hide snoozed (3)". */
export function snoozedToggleLabel(show, count) {
  return `${show ? "Hide" : "Show"} snoozed (${count})`;
}
