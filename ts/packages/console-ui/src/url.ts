// A board's state in the URL (contract/boardquery/url/*.json): short keys,
// defaults never written, keys in one order so two screens that mean the
// same board write the same address. A link is read leniently — an old or
// hand-edited address opens the nearest board rather than an error — and
// what is kept is only what the server's board query understands.

import { BOARD_ONLY_KEYS, BOARD_SORTS, looksLikeAddress } from "./query.js";

export type BoardView = "board" | "list";

export type BoardUrlState = {
  /** The workflow shown (one workflow per board). */
  wf: string;
  view: BoardView;
  q: string;
  only: string[];
  assignee: string;
  sort: string;
  tests: boolean;
  final: boolean;
  snoozed: string;
};

export const DEFAULT_BOARD_STATE: BoardUrlState = {
  wf: "",
  view: "board",
  q: "",
  only: [],
  assignee: "",
  sort: "",
  tests: false,
  final: false,
  snoozed: "",
};

/** The filters: changing any of them starts every lane and the list from their first page. */
export const FILTER_KEYS = ["q", "only", "assignee", "sort", "tests", "final", "snoozed"] as const;

export function parseBoardUrl(search: string | URLSearchParams): BoardUrlState {
  const v = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search) : search;
  const s: BoardUrlState = { ...DEFAULT_BOARD_STATE, only: [] };
  s.wf = (v.get("wf") ?? "").trim();
  s.view = v.get("v") === "list" ? "list" : "board";
  s.q = (v.get("q") ?? "").trim().slice(0, 200);
  const only = new Set<string>();
  for (const raw of v.getAll("only"))
    for (const o of raw.split(",")) {
      const k = o.trim().toLowerCase();
      if ((BOARD_ONLY_KEYS as readonly string[]).includes(k)) only.add(k);
    }
  s.only = Array.from(only).sort();
  const a = (v.get("assignee") ?? "").trim().toLowerCase();
  s.assignee = a === "me" || a === "none" || looksLikeAddress(a) ? a : "";
  const sort = (v.get("sort") ?? "").trim().toLowerCase();
  s.sort = sort !== "newest" && ((BOARD_SORTS as readonly string[]).includes(sort) || /^score:[a-z0-9_]{1,64}$/.test(sort)) ? sort : "";
  s.tests = v.get("tests") === "1";
  s.final = v.get("final") === "1";
  const sn = (v.get("snoozed") ?? "").trim().toLowerCase();
  s.snoozed = sn === "hide" || sn === "only" ? sn : "";
  return s;
}

/** The address of a state, defaults left out, keys in their one order. Commas stay commas. */
export function writeBoardUrl(s: BoardUrlState): string {
  const parts: [string, string][] = [];
  if (s.wf) parts.push(["wf", s.wf]);
  if (s.view === "list") parts.push(["v", "list"]);
  if (s.q.trim()) parts.push(["q", s.q.trim()]);
  if (s.only.length) parts.push(["only", [...new Set(s.only)].sort().join(",")]);
  if (s.assignee) parts.push(["assignee", s.assignee]);
  if (s.sort && s.sort !== "newest") parts.push(["sort", s.sort]);
  if (s.tests) parts.push(["tests", "1"]);
  if (s.final) parts.push(["final", "1"]);
  if (s.snoozed) parts.push(["snoozed", s.snoozed]);
  return parts.map(([k, val]) => `${k}=${encodeURIComponent(val).replace(/%2C/gi, ",")}`).join("&");
}

/** The board query the server is asked, from a state: the filters only. */
export function boardQueryOf(s: BoardUrlState): Record<string, string> {
  const out: Record<string, string> = {};
  if (s.q.trim()) out.q = s.q.trim();
  if (s.only.length) out.only = [...s.only].sort().join(",");
  if (s.assignee) out.assignee = s.assignee;
  if (s.sort) out.sort = s.sort;
  if (s.tests) out.tests = "1";
  if (s.final) out.final = "1";
  if (s.snoozed) out.snoozed = s.snoozed;
  return out;
}

/** Whether two states would show different records (a filter differs). */
export function filtersDiffer(a: BoardUrlState, b: BoardUrlState): boolean {
  return FILTER_KEYS.some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

/** How many filters are on (the Filters button's count and the chips). */
export function activeFilterCount(s: BoardUrlState): number {
  return s.only.length + (s.assignee ? 1 : 0) + (s.tests ? 1 : 0) + (s.final ? 1 : 0) + (s.snoozed ? 1 : 0);
}
