import { describe, expect, test } from "vitest";
import { autoLayout, backEdges, LAYOUT, positions } from "./layout.js";
import { setPosition } from "./model.js";
import { sampleTree } from "./test/fixtures.js";
import type { Graph } from "./types.js";

describe("auto-layout", () => {
  test("every node has a place, and every forward edge goes down", () => {
    const g = sampleTree();
    const at = autoLayout(g);
    expect(Object.keys(at).sort()).toEqual(g.nodes.map((n) => n.id).sort());
    for (const e of g.edges) expect(at[e.to].y).toBeGreaterThan(at[e.from].y);
  });
  test("the start is on top and alone", () => {
    const at = autoLayout(sampleTree());
    expect(at.start).toEqual({ x: 0, y: 0 });
  });
  test("a fork's arms sit side by side", () => {
    const at = autoLayout(sampleTree());
    expect(at.confirm.y).toBe(at.pause.y);
    expect(Math.abs(at.confirm.x - at.pause.x)).toBe(LAYOUT.columnGap);
  });
  test("is deterministic", () => {
    expect(autoLayout(sampleTree())).toEqual(autoLayout(sampleTree()));
  });
  test("a back-edge is set aside, so a cycle still lays out", () => {
    const g: Graph = {
      format: "workflow.graph/1",
      nodes: [
        { id: "start", type: "start" },
        { id: "ask", type: "review", config: { outcomes: [{ name: "again" }] } },
        { id: "end", type: "end" },
      ],
      edges: [
        { from: "start", to: "ask" },
        { from: "ask", to: "ask", label: "again" },
        { from: "ask", to: "end", label: "otherwise", default: true },
      ],
    };
    expect([...backEdges(g)]).toEqual([1]);
    const at = autoLayout(g);
    expect(at.end.y).toBeGreaterThan(at.ask.y);
  });
});

describe("positions", () => {
  test("a stored position wins; the rest are laid out", () => {
    const g = setPosition(sampleTree(), "tier", { x: 999, y: -5 });
    const at = positions(g);
    expect(at.tier).toEqual({ x: 999, y: -5 });
    expect(at.start).toEqual(autoLayout(g).start);
  });
  test("a complete stored layout is used as it is", () => {
    const g = sampleTree();
    const all = autoLayout(g);
    expect(positions({ ...g, layout: all })).toBe(all);
  });
});
