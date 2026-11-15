import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { moveVerdict } from "./moves.js";
import { parsePageQuery } from "./pages.js";
import { parseBoardQuery } from "./query.js";
import { parseBoardUrl, writeBoardUrl } from "./url.js";

// contract/boardquery, replayed here as core replays it in Go.
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "contract", "boardquery");

function vectors(sub: string) {
  const at = join(dir, sub);
  return readdirSync(at)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(at, f), "utf8")));
}

describe("contract/boardquery: the board query", () => {
  const all = vectors("");
  it("has its vectors", () => expect(all.length).toBeGreaterThanOrEqual(15));
  for (const v of all)
    it(v.name, () => {
      const r = parseBoardQuery(v.query);
      expect(r.ok).toBe(v.ok);
      if (r.ok) expect(r.normalised).toEqual(v.normalised);
      else expect(r.key).toBe(v.error);
    });
});

describe("contract/boardquery/moves: the move rule", () => {
  const all = vectors("moves");
  it("has its vectors", () => expect(all.length).toBeGreaterThanOrEqual(15));
  for (const v of all) it(v.name, () => expect(moveVerdict(v.columns, v.rules, v.move)).toEqual(v.verdict));
});

describe("contract/boardquery/pages: a lane's pages", () => {
  const all = vectors("pages");
  it("has its vectors", () => expect(all.length).toBeGreaterThanOrEqual(10));
  for (const v of all)
    it(v.name, () => {
      const r = parsePageQuery(v.query);
      expect(r.ok).toBe(v.ok);
      if (r.ok) expect(r.page).toEqual(v.page);
      else expect(r.key).toBe(v.error);
    });
});

describe("contract/boardquery/url: the board in the URL", () => {
  const all = vectors("url");
  it("has its vectors", () => expect(all.length).toBeGreaterThanOrEqual(8));
  for (const v of all)
    it(v.name, () => {
      const s = parseBoardUrl(v.search);
      expect(s).toEqual(v.state);
      expect(writeBoardUrl(s)).toBe(v.canonical);
      // What is written reads back as the same board.
      expect(parseBoardUrl(writeBoardUrl(s))).toEqual(s);
    });
});
