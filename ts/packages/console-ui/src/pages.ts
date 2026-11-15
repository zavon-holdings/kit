// A board's pages (contract/boardquery/pages/*.json). The first request asks
// for every lane's first page and every lane's true total at once; a lane
// then asks for its own next page with the cursor its last page gave it
// (keyset: the position of the last card it holds, never an offset, so a
// card arriving above or leaving does not shift or repeat the next page).
// `ids=1` asks for every record in one lane under the filters — a bulk
// action acts on the server's total, not on the cards that happen to be
// loaded.

export const PAGE_SIZE = 10;
export const PAGE_MAX = 50;

export type PageQuery = { column: string; after: string; limit: number; ids: boolean };

export type PageQueryResult = { ok: true; page: PageQuery } | { ok: false; key: string; reason: string };

const PAGE_KEYS = ["column", "after", "limit", "ids"] as const;

/** Reads the page keys of a board request; the board query's own keys are left to it. */
export function parsePageQuery(search: string | URLSearchParams): PageQueryResult {
  const v = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search) : search;
  const page: PageQuery = { column: (v.get("column") ?? "").trim(), after: (v.get("after") ?? "").trim(), limit: PAGE_SIZE, ids: false };
  const limit = (v.get("limit") ?? "").trim();
  if (limit !== "") {
    if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > PAGE_MAX) return { ok: false, key: "limit", reason: `is 1 to ${PAGE_MAX}` };
    page.limit = Number(limit);
  }
  const ids = (v.get("ids") ?? "").trim();
  if (ids !== "" && ids !== "0" && ids !== "1") return { ok: false, key: "ids", reason: "is 1 or 0" };
  page.ids = ids === "1";
  if (page.after && !page.column) return { ok: false, key: "after", reason: "names a column's page: column is required" };
  if (page.ids && !page.column) return { ok: false, key: "ids", reason: "lists one column: column is required" };
  return { ok: true, page };
}

/** The page keys of a request, defaults left out. */
export function pageQueryOf(p: Partial<PageQuery>): Record<string, string> {
  const out: Record<string, string> = {};
  if (p.column) out.column = p.column;
  if (p.after) out.after = p.after;
  if (p.limit && p.limit !== PAGE_SIZE) out.limit = String(p.limit);
  if (p.ids) out.ids = "1";
  return out;
}

export function isPageKey(k: string): boolean {
  return (PAGE_KEYS as readonly string[]).includes(k);
}
