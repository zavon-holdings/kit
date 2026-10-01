// Twin of core's app/workflow/cond: the workflow engine's one condition
// language (admin/docs/workflow-expansion-plan.md §3.4), evaluated in the
// browser for the builder's simulate and "would this match?" helper. The
// contract vectors in kit/contract/conditions hold the two languages
// together; a divergence fails both.
//
// A condition is a tree: {all: [...]}, {any: [...]}, {not: ...} or a leaf
// {field, op, value}. A bare list is `all`. Evaluation is a pure function of
// (scope, now, permits): no clock reads, no network.

export const OPERATORS = Object.freeze([
  "after", "before", "contains", "ends_with", "exists", "gt", "gte", "holds", "in",
  "is", "is_not", "lt", "lte", "matches", "missing", "not_in", "starts_with",
]);

export const MAX_PATTERN = 200;
export const MAX_SUBJECT = 4096;
export const MAX_DEPTH = 8;

const OFFSET_UNITS = { minutes: 60e3, hours: 3600e3, days: 86400e3, weeks: 7 * 86400e3 };

class ParseError extends Error {}

function where(at, msg) {
  return at ? `${at}: ${msg}` : msg;
}

/**
 * Parse a condition. `mode` is "branch" (bare paths read vars) or "trigger"
 * (bare paths read event.vars; steps.* refused). `allowHolds` admits the
 * `holds` operator, which is refused at save until the permits directory
 * exists. A bare list is `all`. Throws on anything outside the grammar.
 */
export function parse(raw, { mode = "branch", allowHolds = false } = {}) {
  let v = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "null") return { empty: true };
    try {
      v = JSON.parse(trimmed);
    } catch (e) {
      throw new ParseError(`that condition is not JSON this can read: ${e.message}`);
    }
  }
  if (v === null || v === undefined) return { empty: true };
  if (Array.isArray(v)) v = { all: v };
  return parseNode(v, { mode, allowHolds }, 1, "");
}

function parseNode(v, o, depth, at) {
  if (depth > MAX_DEPTH) throw new ParseError(where(at, `a condition nests at most ${MAX_DEPTH} deep`));
  if (Array.isArray(v) && at) v = { all: v };
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new ParseError(where(at, "a condition is an object: {all: […]}, {any: […]}, {not: …} or {field, op, value}"));
  }
  const keys = Object.keys(v);
  if (keys.length === 0) return { empty: true };
  let kinds = 0;
  for (const k of ["all", "any", "not", "field"]) if (k in v) kinds++;
  if (kinds === 0) throw new ParseError(where(at, "a condition says all, any, not, or names a field"));
  if (kinds > 1) throw new ParseError(where(at, "a condition is one of all, any, not or a field — not two at once"));

  if (("all" in v && v.all !== null) || ("any" in v && v.any !== null)) {
    const key = "any" in v ? "any" : "all";
    for (const k of keys) if (k !== key) throw new ParseError(where(at, `"${k}" is not part of a condition`));
    if (!Array.isArray(v[key])) throw new ParseError(where(at, `${key} takes a list of conditions`));
    const kids = v[key].map((child, i) => parseNode(child, o, depth + 1, where(at, `${key}[${i + 1}]`)));
    // All of nothing is no condition at all: the empty condition, which holds.
    if (key === "all" && kids.length === 0) return { empty: true };
    return key === "all" ? { all: kids } : { any: kids };
  }
  if ("not" in v && v.not !== null) {
    for (const k of keys) if (k !== "not") throw new ParseError(where(at, `"${k}" is not part of a condition`));
    return { not: parseNode(v.not, o, depth + 1, where(at, "not")) };
  }
  for (const k of keys) {
    if (k !== "field" && k !== "op" && k !== "value") throw new ParseError(where(at, `"${k}" is not part of a condition`));
  }
  const field = typeof v.field === "string" ? v.field.trim() : "";
  if (!field) throw new ParseError(where(at, "a condition names a field"));
  let op = typeof v.op === "string" ? v.op.trim().toLowerCase() : "";
  if (!op) op = "is";
  if (!OPERATORS.includes(op)) throw new ParseError(where(at, `"${op}" is not a condition (${OPERATORS.join(", ")})`));
  const leaf = { field, op, value: v.value, valueSet: "value" in v };
  if (o.mode === "trigger" && (field === "steps" || field.startsWith("steps."))) {
    throw new ParseError(where(at, "a trigger's condition cannot read steps: nothing has run yet"));
  }
  switch (op) {
    case "in":
    case "not_in":
      if (!Array.isArray(leaf.value)) throw new ParseError(where(at, `\`${op}\` takes a list`));
      break;
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      if (asNumber(leaf.value) === null) throw new ParseError(where(at, `\`${op}\` compares with a number`));
      break;
    case "exists":
    case "missing":
      if (leaf.valueSet) throw new ParseError(where(at, `\`${op}\` takes no value`));
      break;
    case "contains":
    case "starts_with":
    case "ends_with":
      if (scalar(leaf.value) === null) throw new ParseError(where(at, `\`${op}\` compares with text`));
      break;
    case "matches": {
      if (typeof leaf.value !== "string") throw new ParseError(where(at, "`matches` takes a pattern"));
      if (leaf.value.length > MAX_PATTERN) throw new ParseError(where(at, `a pattern is at most ${MAX_PATTERN} characters`));
      try {
        leaf.re = new RegExp(`^(?:${leaf.value})$`, "u");
      } catch (e) {
        throw new ParseError(where(at, `that pattern cannot be read: ${e.message}`));
      }
      break;
    }
    case "before":
    case "after":
      leaf.when = parseWhen(leaf.value, at, op);
      break;
    case "holds":
      if (!o.allowHolds) throw new ParseError(where(at, "`holds` arrives with phase 3 of the workflow plan (the permits directory)"));
      leaf.grant = parseGrant(leaf.value, at);
      break;
    default:
  }
  return leaf;
}

function parseWhen(v, at, op) {
  const bad = (why) => new ParseError(where(at, `\`${op}\` compares with a date, a time, or {now, offset}: ${why}`));
  if (typeof v === "string") {
    const t = parseTime(v);
    if (t === null) throw bad(`"${v}" is not a date (YYYY-MM-DD) or a time (RFC 3339)`);
    return { at: t };
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    if (v.now !== true) throw bad("a relative time is {now: true, offset?: {value, unit}}");
    for (const k of Object.keys(v)) if (k !== "now" && k !== "offset") throw bad(`"${k}" is not part of a relative time`);
    const w = { now: true, offset: 0 };
    if ("offset" in v) {
      const off = v.offset;
      if (!off || typeof off !== "object" || Array.isArray(off)) throw bad("offset is {value, unit}");
      const n = asNumber(off.value);
      const unit = typeof off.unit === "string" ? off.unit.trim().toLowerCase() : "";
      if (n === null || !(unit in OFFSET_UNITS)) throw bad("offset is {value: <number>, unit: minutes|hours|days|weeks}");
      w.offset = n * OFFSET_UNITS[unit];
    }
    return w;
  }
  throw bad("not a time");
}

function parseGrant(v, at) {
  const bad = (why) => new ParseError(where(at, `\`holds\` takes {app, action, resource}: ${why}`));
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("not an object");
  const g = { app: "", action: "", resource: "" };
  for (const [k, raw] of Object.entries(v)) {
    const s = typeof raw === "string" ? raw.trim() : "";
    if (k === "app" || k === "action" || k === "resource") g[k] = s;
    else throw bad(`"${k}" is not part of a grant`);
  }
  if (!g.app || !g.action || !g.resource) throw bad("app, action and resource are all needed");
  return g;
}

// RFC 3339 (with a date part, a T, a time and a zone) or a bare date, which
// is midnight UTC. Date.parse is looser than Go's time.Parse, so the shapes
// are checked first.
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseTime(s) {
  const t = String(s).trim();
  if (RFC3339.test(t) || DATE.test(t)) {
    const ms = Date.parse(DATE.test(t) ? `${t}T00:00:00Z` : t);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

/* ── evaluation ── */

/**
 * Evaluate a parsed condition. scope: {vars, subject, steps, event, now,
 * permits, mode}. `now` is a Date, ms or RFC 3339 string and is FROZEN.
 * `permits` is {holds(subject, grant) -> boolean}; a `holds` with none is an
 * error, never false.
 */
export function evaluate(node, scope) {
  const s = normaliseScope(scope);
  return evalNode(node, s);
}

function normaliseScope(scope) {
  const s = { ...scope };
  s.vars = s.vars ?? {};
  s.subject = s.subject ?? {};
  s.steps = s.steps ?? {};
  s.event = s.event ?? {};
  s.mode = s.mode ?? "branch";
  if (s.now instanceof Date) s.nowMs = s.now.getTime();
  else if (typeof s.now === "number") s.nowMs = s.now;
  else if (typeof s.now === "string") s.nowMs = Date.parse(s.now);
  else s.nowMs = 0;
  return s;
}

function evalNode(n, s) {
  if (!n || n.empty) return true;
  if (n.not) return !evalNode(n.not, s);
  if (n.all) {
    for (const k of n.all) if (!evalNode(k, s)) return false;
    return true;
  }
  if (n.any) {
    for (const k of n.any) if (evalNode(k, s)) return true;
    return false;
  }
  return leaf(n, s);
}

function leaf(n, s) {
  const [raw, present] = lookup(s, n.field);
  const got = scalar(raw);
  const comparable = got !== null;
  const isSet = present && raw !== null && raw !== undefined && (!comparable || got !== "");
  switch (n.op) {
    case "exists":
      return isSet;
    case "missing":
      return !isSet;
    case "is":
    case "is_not": {
      const want = scalar(n.value) ?? "";
      const equal = present && comparable && equalScalar(got, want);
      return (n.op === "is") === equal;
    }
    case "in":
    case "not_in": {
      let found = false;
      if (present && comparable) {
        for (const v of n.value) {
          const w = scalar(v);
          if (w !== null && equalScalar(got, w)) {
            found = true;
            break;
          }
        }
      }
      return (n.op === "in") === found;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = asNumber(raw);
      const b = asNumber(n.value);
      if (!present || a === null || b === null) return false;
      if (n.op === "gt") return a > b;
      if (n.op === "gte") return a >= b;
      if (n.op === "lt") return a < b;
      return a <= b;
    }
    case "contains": {
      const want = scalar(n.value) ?? "";
      if (Array.isArray(raw)) {
        for (const v of raw) {
          const w = scalar(v);
          if (w !== null && equalScalar(w, want)) return true;
        }
        return false;
      }
      if (!present || !comparable) return false;
      return got.toLowerCase().includes(want.toLowerCase());
    }
    case "starts_with": {
      const want = scalar(n.value) ?? "";
      return present && comparable && got.toLowerCase().startsWith(want.toLowerCase());
    }
    case "ends_with": {
      const want = scalar(n.value) ?? "";
      return present && comparable && got.toLowerCase().endsWith(want.toLowerCase());
    }
    case "matches":
      if (!present || !comparable || got.length > MAX_SUBJECT) return false;
      return n.re.test(got);
    case "before":
    case "after": {
      if (!present || !comparable) return false;
      const at = parseTime(got);
      if (at === null) return false;
      const ref = n.when.now ? s.nowMs + n.when.offset : n.when.at;
      return n.op === "before" ? at < ref : at > ref;
    }
    case "holds": {
      if (!present || !comparable || got === "") return false;
      if (!s.permits) throw new Error("cond: `holds` needs the permits directory, and none is wired");
      return Boolean(s.permits.holds(got, n.grant));
    }
    default:
      throw new Error(`cond: "${n.op}" is not an operator`);
  }
}

/** Read a dotted path from the scope; [value, present]. */
export function lookup(scope, path) {
  const s = normaliseScope(scope);
  const parts = path.split(".");
  let cur;
  switch (parts[0]) {
    case "vars":
      cur = s.vars;
      parts.shift();
      break;
    case "subject":
      cur = s.subject;
      parts.shift();
      break;
    case "steps":
      cur = s.steps;
      parts.shift();
      break;
    case "event":
      cur = s.event;
      parts.shift();
      break;
    default:
      cur = s.mode === "trigger" ? s.event.vars : s.vars;
  }
  for (const p of parts) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return [undefined, false];
    if (!(p in cur)) return [undefined, false];
    cur = cur[p];
  }
  return [cur, true];
}

/* ── scalars and numbers, the same way in both languages ── */

// The one number syntax both evaluators read; see cond.go `decimal`.
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function asNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    if (!DECIMAL.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Flatten one value the way Go's scalar does; null means NOT comparable (an
// object or an array).
function scalar(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
    return String(v);
  }
  return null;
}

function equalScalar(a, b) {
  const fa = asNumber(a);
  const fb = asNumber(b);
  if (fa !== null && fb !== null) return fa === fb;
  return a.toLowerCase() === b.toLowerCase();
}

/* ── words and fields ── */

const WORDS = {
  is: "is", is_not: "is not", in: "is one of", not_in: "is not one of",
  gt: "is more than", gte: "is at least", lt: "is less than", lte: "is at most",
  exists: "exists", missing: "is missing", contains: "contains", starts_with: "starts with",
  ends_with: "ends with", matches: "matches", before: "is before", after: "is after", holds: "holds",
};

/** The condition in words, as core's Describe says it. */
export function describe(n) {
  if (!n || n.empty) return "";
  if (n.not) return `not (${describe(n.not)})`;
  if (n.all) return n.all.map(describe).filter(Boolean).join(" and ");
  if (n.any) return `(${n.any.map(describe).filter(Boolean).join(" or ")})`;
  const quote = (s) => (s === "" ? '""' : s);
  switch (n.op) {
    case "exists":
    case "missing":
      return `${n.field} ${WORDS[n.op]}`;
    case "in":
    case "not_in":
      return `${n.field} ${WORDS[n.op]} ${n.value.map((v) => quote(scalar(v) ?? JSON.stringify(v))).join(", ")}`;
    case "holds":
      return `${n.field} holds ${n.grant.action} on ${n.grant.resource}`;
    default:
  }
  if ((n.op === "before" || n.op === "after") && n.when.now) {
    if (!n.when.offset) return `${n.field} ${WORDS[n.op]} now`;
    const off = n.value.offset;
    const v = asNumber(off.value);
    return `${n.field} ${WORDS[n.op]} now ${v < 0 ? "-" : "+"} ${scalar(Math.abs(v))} ${String(off.unit).trim().toLowerCase()}`;
  }
  const s = scalar(n.value);
  return `${n.field} ${WORDS[n.op]} ${quote(s === null ? JSON.stringify(n.value) : s)}`;
}

/** The paths a condition reads, sorted and de-duplicated. */
export function fields(n) {
  const seen = new Set();
  const walk = (x) => {
    if (!x || x.empty) return;
    if (x.field) seen.add(x.field);
    (x.all ?? []).forEach(walk);
    (x.any ?? []).forEach(walk);
    if (x.not) walk(x.not);
  };
  walk(n);
  return [...seen].sort();
}
