import { describe, expect, test } from "vitest";
import { lanePath, routeEdges, type Box } from "./routing.js";

const box = (x: number, y: number): Box => ({ x, y, w: 190, h: 72 });

describe("edge routes", () => {
  test("an edge to the next row takes the plain route", () => {
    const boxes = new Map([["a", box(0, 0)], ["b", box(0, 120)]]);
    expect(routeEdges([{ from: "a", to: "b" }], boxes)).toEqual([{ spread: 0 }]);
  });

  test("an edge that skips rows over other nodes takes a lane beside them", () => {
    const boxes = new Map([["a", box(0, 0)], ["b", box(0, 120)], ["c", box(0, 240)], ["wide", box(150, 120)]]);
    const [direct, skip] = routeEdges([{ from: "a", to: "b" }, { from: "a", to: "c" }], boxes);
    expect(direct.lane).toBeUndefined();
    // Right of the widest thing it passes, with a gap.
    expect(skip.lane).toBe(150 + 190 + 28);
  });

  test("an edge back up always takes a lane, and lanes side by side do not overlap", () => {
    const boxes = new Map([["a", box(0, 0)], ["b", box(0, 120)], ["c", box(0, 240)]]);
    const routes = routeEdges([{ from: "c", to: "a" }, { from: "b", to: "a" }], boxes);
    expect(routes[0].lane).toBe(190 + 28);
    expect(routes[1].lane).toBe(190 + 28 + 18);
  });

  test("edges with the same two ends spread their labels", () => {
    const boxes = new Map([["a", box(0, 0)], ["b", box(0, 120)]]);
    const routes = routeEdges([{ from: "a", to: "b" }, { from: "a", to: "b" }, { from: "a", to: "b" }], boxes);
    expect(routes.map((r) => r.spread)).toEqual([-1, 0, 1]);
  });

  test("a lane path leaves downwards and enters from above", () => {
    const [d, x, y] = lanePath(95, 72, 95, 240, 300);
    expect(d).toBe("M 95 72 L 95 86 L 300 86 L 300 226 L 95 226 L 95 240");
    expect([x, y]).toEqual([300, 156]);
  });
});
