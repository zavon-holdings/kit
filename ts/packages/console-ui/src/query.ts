// The board query (contract/boardquery/*.json): what a board may be narrowed
// and ordered by. Every key and value is allow-listed; an unknown one is an
// error naming the key, because a typo must never quietly show everything.
// The server holds the same grammar; this copy lets a screen keep only what
// the server would understand in its URL.

export const BOARD_ONLY_KEYS = [
  "awaiting",
  "due_soon",
  "final",
  "flagged",
  "linked",
  "not_scheduled",
  "overdue",
  "scheduled",
  "test",
  "unlocked",
  "waiting_documents",
] as const;

export type BoardOnly = (typeof BOARD_ONLY_KEYS)[number];

export const BOARD_SORTS = ["newest", "oldest", "time_in_stage", "deadline", "name", "updated"] as const;

const QUERY_KEYS = new Set(["only", "assignee", "me", "sort", "tests", "final", "snoozed", "stage", "owner", "q"]);
const SCORE_SORT = /^score:[a-z0-9_]{1,64}$/;

export type BoardQuery = {
  only: string[];
  assignee: string;
  me: string;
  sort: string;
  tests: boolean;
  final: boolean;
  snoozed: string;
  stage: string;
  owner: string;
  q: string;
};

export type BoardQueryResult = { ok: true; query: BoardQuery; normalised: Record<string, string | string[]> } | { ok: false; key: string; reason: string };

/** An address as the server reads one: something either side of an @, no spaces or separators. */
export function looksLikeAddress(s: string): boolean {
  const at = s.indexOf("@");
  return at > 0 && at < s.length - 1 && !/[ \t\n,;<>]/.test(s);
}

function flag(key: string, v: string | null): boolean | { key: string; reason: string } {
  const t = (v ?? "").trim();
  if (t === "" || t === "0") return false;
  if (t === "1") return true;
  return { key, reason: "is 1 or 0" };
}

/** Reads a board query string the way the server does. */
export function parseBoardQuery(search: string | URLSearchParams): BoardQueryResult {
  const v = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search) : search;
  const keys = Array.from(new Set(Array.from(v.keys()))).sort();
  for (const k of keys) if (!QUERY_KEYS.has(k)) return { ok: false, key: k, reason: "is not a board query key" };
  const q: BoardQuery = { only: [], assignee: "", me: "", sort: "", tests: false, final: false, snoozed: "", stage: "", owner: "", q: "" };
  const seen = new Set<string>();
  for (const raw of v.getAll("only")) {
    for (let o of raw.split(",")) {
      o = o.trim().toLowerCase();
      if (!o) continue;
      if (!(BOARD_ONLY_KEYS as readonly string[]).includes(o)) return { ok: false, key: "only", reason: `"${o}" is not one of ${BOARD_ONLY_KEYS.join(", ")}` };
      if (!seen.has(o)) {
        seen.add(o);
        q.only.push(o);
      }
    }
  }
  q.only.sort();
  const a = (v.get("assignee") ?? "").trim().toLowerCase();
  if (a === "" || a === "me" || a === "none" || looksLikeAddress(a)) q.assignee = a;
  else return { ok: false, key: "assignee", reason: "is me, none or an email address" };
  const me = (v.get("me") ?? "").trim().toLowerCase();
  if (me) {
    if (!looksLikeAddress(me)) return { ok: false, key: "me", reason: "is an email address" };
    q.me = me;
  }
  const s = (v.get("sort") ?? "").trim().toLowerCase();
  if (s === "" || s === "newest") q.sort = "";
  else if ((BOARD_SORTS as readonly string[]).includes(s) || SCORE_SORT.test(s)) q.sort = s;
  else return { ok: false, key: "sort", reason: "is newest, oldest, time_in_stage, deadline, name, updated or score:<scale>" };
  for (const k of ["tests", "final"] as const) {
    const f = flag(k, v.get(k));
    if (typeof f === "object") return { ok: false, ...f };
    q[k] = f;
  }
  const sn = (v.get("snoozed") ?? "").trim().toLowerCase();
  if (sn !== "" && sn !== "hide" && sn !== "only") return { ok: false, key: "snoozed", reason: "is hide or only" };
  q.snoozed = sn;
  q.stage = (v.get("stage") ?? "").trim();
  q.owner = (v.get("owner") ?? "").trim();
  q.q = (v.get("q") ?? "").trim();
  if (Array.from(q.q).length > 200) return { ok: false, key: "q", reason: "is at most 200 characters" };
  return { ok: true, query: q, normalised: normaliseBoardQuery(q) };
}

/** The query with its defaults left out and its lists sorted: what a URL keeps. */
export function normaliseBoardQuery(q: BoardQuery): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (q.only.length) out.only = [...q.only];
  for (const k of ["assignee", "me", "sort", "snoozed", "stage", "owner", "q"] as const) if (q[k]) out[k] = q[k];
  if (q.tests) out.tests = "1";
  if (q.final) out.final = "1";
  return out;
}
