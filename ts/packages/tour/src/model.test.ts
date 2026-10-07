import { describe, expect, test } from "vitest";
import { holeFor, placeTooltip } from "./geometry.js";
import { fallbackStore, isSeen, localStorageStore, memoryStore, readRecord, tourKey, type TourStore } from "./storage.js";
import { docsUrlsOf, resolveDocsUrl, selectorFor, targetsOf, validateTour, type Tour } from "./tour.js";

const tour: Tour = {
  id: "first-run",
  steps: [
    { id: "hello", title: "Welcome", body: "A short look around." },
    { id: "new", target: "new-item", title: "Create one", body: "Start here.", docsUrl: "/guide/create" },
    { id: "list", target: "list", title: "Your list", body: "Everything lands here.", docsUrl: "https://example.org/list" },
    { id: "again", target: "new-item", title: "Again", body: "Same target.", docsUrl: "/guide/create" },
  ],
};

describe("tours as data", () => {
  test("targets and docs links, once each, in order", () => {
    expect(targetsOf(tour)).toEqual(["new-item", "list"]);
    expect(docsUrlsOf([tour, tour])).toEqual(["/guide/create", "https://example.org/list"]);
  });

  test("a target becomes a data-tour selector, quotes escaped", () => {
    expect(selectorFor("new-item")).toBe('[data-tour="new-item"]');
    expect(selectorFor('a"b')).toBe('[data-tour="a\\"b"]');
  });

  test("docs links resolve against a base with exactly one slash", () => {
    expect(resolveDocsUrl("/guide/create", "https://example.org/docs/")).toBe("https://example.org/docs/guide/create");
    expect(resolveDocsUrl("guide/create", "https://example.org/docs")).toBe("https://example.org/docs/guide/create");
    expect(resolveDocsUrl("https://other.example/x", "https://example.org/docs")).toBe("https://other.example/x");
    expect(resolveDocsUrl("/guide", undefined)).toBe("/guide");
  });

  test("a sound tour has no problems", () => {
    expect(validateTour(tour)).toEqual([]);
  });

  test("problems are named", () => {
    const bad: Tour = {
      id: "Bad Id",
      steps: [
        { id: "a", target: "div > .x", title: "", body: "b", docsUrl: "http://insecure.example" },
        { id: "a", title: "t", body: " " },
      ],
    };
    const problems = validateTour(bad);
    expect(problems.some((p) => p.includes('tour id "Bad Id"'))).toBe(true);
    expect(problems.some((p) => p.includes('target "div > .x"'))).toBe(true);
    expect(problems.some((p) => p.includes("has no title"))).toBe(true);
    expect(problems.some((p) => p.includes("has no body"))).toBe(true);
    expect(problems.some((p) => p.includes('id "a" is used twice'))).toBe(true);
    expect(problems.some((p) => p.includes("must be https://"))).toBe(true);
    expect(validateTour({ id: "empty", steps: [] })).toEqual(["tour empty has no steps"]);
  });
});

describe("geometry", () => {
  const vp = { width: 1280, height: 800 };

  test("the hole grows by the padding and stays on screen", () => {
    expect(holeFor({ top: 100, left: 100, width: 50, height: 20 }, vp)).toEqual({ top: 92, left: 92, width: 66, height: 36 });
    expect(holeFor({ top: 2, left: 2, width: 50, height: 20 }, vp)).toEqual({ top: 0, left: 0, width: 60, height: 30 });
  });

  test("below when it fits, centred on the target", () => {
    const s = placeTooltip({ top: 100, left: 500, width: 100, height: 40 }, { width: 300, height: 150 }, vp);
    expect(s).toEqual({ top: 152, left: 400, placement: "bottom" });
  });

  test("above when below would leave the screen", () => {
    const s = placeTooltip({ top: 700, left: 500, width: 100, height: 40 }, { width: 300, height: 150 }, vp);
    expect(s.placement).toBe("right");
    const t = placeTooltip({ top: 700, left: 500, width: 100, height: 40 }, { width: 300, height: 150 }, vp, "top");
    expect(t).toEqual({ top: 538, left: 400, placement: "top" });
  });

  test("a rail item on the left gets the tooltip to its right", () => {
    const s = placeTooltip({ top: 200, left: 0, width: 240, height: 40 }, { width: 300, height: 150 }, vp, "right");
    expect(s.placement).toBe("right");
    expect(s.left).toBe(252);
  });

  test("never off screen, even when nothing fits", () => {
    const s = placeTooltip({ top: 0, left: 0, width: 1280, height: 800 }, { width: 300, height: 150 }, vp);
    expect(s.top).toBeGreaterThanOrEqual(12);
    expect(s.top + 150).toBeLessThanOrEqual(800 - 12);
    expect(s.left).toBeGreaterThanOrEqual(12);
  });
});

describe("storage", () => {
  const rec = { status: "completed" as const, version: 1, at: "2026-10-07T10:00:00Z" };

  test("keys are scope, person and tour", () => {
    expect(tourKey({ scope: "app", person: "p1", tour: "first-run" })).toBe("app:p1:first-run");
    expect(tourKey({ person: "p1", tour: "first-run" })).toBe("p1:first-run");
  });

  test("localStorage round trip, under a prefix", async () => {
    const s = localStorageStore("t:");
    expect(await s.get("k")).toBeNull();
    await s.set("k", rec);
    expect(await s.get("k")).toEqual(rec);
    expect(window.localStorage.getItem("t:k")).toContain("completed");
  });

  test("garbage in storage reads as nothing", async () => {
    window.localStorage.setItem("t:k", "{not json");
    expect(await localStorageStore("t:").get("k")).toBeNull();
    window.localStorage.setItem("t:k", JSON.stringify({ status: "maybe" }));
    expect(await localStorageStore("t:").get("k")).toBeNull();
    expect(readRecord({ status: "dismissed", step: 2 })).toEqual({ status: "dismissed", version: 1, at: "", step: 2 });
  });

  test("the fallback answers when the server fails, and keeps the answer locally", async () => {
    const broken: TourStore = {
      get: async () => {
        throw new Error("offline");
      },
      set: async () => {
        throw new Error("offline");
      },
    };
    const local = memoryStore();
    const s = fallbackStore(broken, local);
    expect(await s.get("k")).toBeNull();
    await s.set("k", rec);
    expect(await local.get("k")).toEqual(rec);
    expect(await s.get("k")).toEqual(rec);
  });

  test("the server's answer wins when it has one", async () => {
    const server = memoryStore({ k: { ...rec, status: "dismissed" } });
    const s = fallbackStore(server, memoryStore({ k: rec }));
    expect((await s.get("k"))?.status).toBe("dismissed");
  });

  test("an older version's record is not seen", () => {
    expect(isSeen(null)).toBe(false);
    expect(isSeen(rec)).toBe(true);
    expect(isSeen(rec, 2)).toBe(false);
  });
});
