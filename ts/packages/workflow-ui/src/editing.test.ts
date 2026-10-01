import { describe, expect, test } from "vitest";
import { compile } from "@zavon/workflow-graph";
import * as conditions from "@zavon/conditions";
import { emptyHistory, record, redo, undo, COALESCE_MS, MAX_HISTORY } from "./history.js";
import { copyNodes, FRAGMENT_FORMAT, parseFragment, pasteFragment, subtree } from "./clipboard.js";
import { alignNodes, distributeNodes, moveNodes, removeNodes, snap } from "./arrange.js";
import { searchNodes } from "./search.js";
import { positions } from "./layout.js";
import { sampleTree } from "./test/fixtures.js";
import type { Graph } from "./types.js";

const cond = { parse: conditions.parse, fields: conditions.fields };

describe("history", () => {
  test("undo hands back what was there, redo what was undone", () => {
    let h = emptyHistory<string>();
    h = record(h, "a", undefined, 0);
    h = record(h, "b", undefined, 10);
    const u = undo(h, "c")!;
    expect(u.value).toBe("b");
    const u2 = undo(u.history, u.value)!;
    expect(u2.value).toBe("a");
    expect(undo(u2.history, u2.value)).toBeNull();
    const r = redo(u2.history, u2.value)!;
    expect(r.value).toBe("b");
    expect(redo(r.history, r.value)!.value).toBe("c");
  });

  test("typing is one step: edits with one key close together coalesce", () => {
    let h = emptyHistory<string>();
    h = record(h, "", "name:x", 0);
    h = record(h, "R", "name:x", 200);
    h = record(h, "Re", "name:x", 400);
    expect(h.past).toEqual([""]);
    // Another key, or a pause, is a new step.
    h = record(h, "Rev", "name:y", 500);
    h = record(h, "Revi", "name:y", 500 + COALESCE_MS + 1);
    expect(h.past).toEqual(["", "Rev", "Revi"]);
  });

  test("a new edit clears what could be redone", () => {
    let h = record(emptyHistory<number>(), 1, undefined, 0);
    const u = undo(h, 2)!;
    h = record(u.history, u.value, undefined, 5);
    expect(h.future).toEqual([]);
  });

  test("history is bounded", () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < MAX_HISTORY + 30; i++) h = record(h, i, undefined, i * 10_000);
    expect(h.past).toHaveLength(MAX_HISTORY);
    expect(h.past[0]).toBe(30);
  });
});

describe("copy and paste", () => {
  test("a sub-tree is the node and everything after it, never the start", () => {
    const g = sampleTree();
    expect(subtree(g, "tier").sort()).toEqual(["done", "high", "normal", "tier"]);
    expect(subtree(g, "start")).toEqual([]);
  });

  test("a copy keeps only the edges between copied nodes, positions relative", () => {
    const g = sampleTree();
    const f = copyNodes(g, ["tier", "high", "start", "both"]);
    expect(f.format).toBe(FRAGMENT_FORMAT);
    expect(f.nodes.map((n) => n.id)).toEqual(["both", "tier", "high"]);
    expect(f.edges).toEqual([
      { from: "both", to: "tier" },
      { from: "tier", to: "high", label: "gold", when: { field: "vars.tier", op: "is", value: "gold" } },
    ]);
    const xs = Object.values(f.layout).map((p) => p.x);
    const ys = Object.values(f.layout).map((p) => p.y);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.min(...ys)).toBe(0);
  });

  test("pasting gives fresh ids and follows the fragment's own references", () => {
    const g = sampleTree();
    const f = copyNodes(g, ["approve", "declined"]);
    // A condition in the fragment that reads the copied review.
    f.edges.push({ from: "approve", to: "declined", label: "maybe", when: { field: "steps.approve.output.outcome", op: "is", value: "maybe" } });
    const { graph, ids } = pasteFragment(g, f, { x: 500, y: 40 });
    expect(ids).toEqual(["approve-2", "declined-2"]);
    expect(graph.nodes).toHaveLength(g.nodes.length + 2);
    const pasted = graph.edges.filter((e) => e.from === "approve-2");
    expect(pasted.map((e) => e.to)).toEqual(["declined-2", "declined-2", "declined-2"]);
    expect(pasted[2].when).toEqual({ field: "steps.approve-2.output.outcome", op: "is", value: "maybe" });
    expect(positions(graph)["approve-2"]).toEqual({ x: 500, y: 40 });
    // The originals are untouched.
    expect(graph.edges.filter((e) => e.from === "approve")).toEqual(g.edges.filter((e) => e.from === "approve"));
  });

  test("a reference to a step that was not copied is left alone", () => {
    const g = sampleTree();
    const f = copyNodes(g, ["high"]);
    f.nodes[0].config = { set: { note: "{{steps.approve.output.outcome}}" } };
    const { graph } = pasteFragment(g, f);
    expect(graph.nodes.find((n) => n.id === "high-2")!.config).toEqual({ set: { note: "{{steps.approve.output.outcome}}" } });
  });

  test("references are renamed in templates, not inside a longer id", () => {
    const g: Graph = {
      format: "workflow.graph/1",
      nodes: [
        { id: "start", type: "start" },
        { id: "ask", type: "review" },
        { id: "tell", type: "set_var", config: { set: { a: "{{steps.ask.output.outcome}}", b: "steps.asking.output", c: "steps.ask" } } },
      ],
      edges: [],
    };
    const { graph } = pasteFragment(g, copyNodes(g, ["ask", "tell"]));
    expect(graph.nodes.find((n) => n.id === "tell-2")!.config).toEqual({ set: { a: "{{steps.ask-2.output.outcome}}", b: "steps.asking.output", c: "steps.ask-2" } });
  });

  test("a pasted copy of a whole branch still compiles once connected", () => {
    const g = sampleTree();
    const { graph, ids } = pasteFragment(g, copyNodes(g, subtree(g, "tier")));
    expect(ids).toEqual(["tier-2", "high-2", "normal-2", "done-2"]);
    const rewired = { ...graph, edges: graph.edges.map((e) => (e.from === "both" ? { ...e, to: "tier-2" } : e)) };
    // The originals are now unreachable, so remove them and it compiles.
    const pruned = removeNodes(rewired, ["tier", "high", "normal", "done"]);
    const out = compile(pruned, { conditions: cond });
    expect(out.problems ?? []).toEqual([]);
  });

  test("the system clipboard's text is read back, and anything else is refused", () => {
    const g = sampleTree();
    const f = copyNodes(g, ["high"]);
    expect(parseFragment(JSON.stringify(f))).toEqual(f);
    expect(parseFragment("hello")).toBeNull();
    expect(parseFragment(JSON.stringify({ format: "workflow.graph/1", nodes: [], edges: [] }))).toBeNull();
    expect(parseFragment(JSON.stringify({ format: FRAGMENT_FORMAT, nodes: [{ id: 3 }], edges: [] }))).toBeNull();
  });

  test("the start is never pasted", () => {
    const g = sampleTree();
    const f = { format: FRAGMENT_FORMAT, nodes: [{ id: "start", type: "start" }], edges: [], layout: {} } as const;
    expect(pasteFragment(g, { ...f, nodes: [...f.nodes], edges: [] })).toEqual({ graph: g, ids: [] });
  });
});

describe("arranging several nodes", () => {
  const laid = (): Graph => {
    const g = sampleTree();
    return { ...g, layout: positions(g) };
  };

  test("removing several never removes the start", () => {
    const g = removeNodes(sampleTree(), ["start", "high", "normal"]);
    expect(g.nodes.map((n) => n.id)).toContain("start");
    expect(g.nodes.map((n) => n.id)).not.toContain("high");
    expect(g.edges.some((e) => e.from === "high" || e.to === "normal")).toBe(false);
  });

  test("moving shifts only the named nodes", () => {
    const g = laid();
    const before = positions(g);
    const moved = positions(moveNodes(g, ["high", "normal"], 20, -10));
    expect(moved.high).toEqual({ x: before.high.x + 20, y: before.high.y - 10 });
    expect(moved.tier).toEqual(before.tier);
  });

  test("aligning lines up one coordinate and keeps the other", () => {
    const g = laid();
    const at = positions(g);
    const left = positions(alignNodes(g, ["high", "normal", "tier"], "left"));
    const x = Math.min(at.high.x, at.normal.x, at.tier.x);
    expect([left.high.x, left.normal.x, left.tier.x]).toEqual([x, x, x]);
    expect(left.high.y).toBe(at.high.y);
    const top = positions(alignNodes(g, ["high", "done"], "top"));
    expect(top.done.y).toBe(Math.min(at.high.y, at.done.y));
    // One node is not a group.
    expect(alignNodes(g, ["high"], "left")).toBe(g);
  });

  test("distributing spaces evenly between the outermost", () => {
    const g = setTo(laid(), { a: 0, b: 10, c: 100 });
    const out = positions(distributeNodes(g, ["a", "b", "c"], "horizontal"));
    expect([out.a.x, out.b.x, out.c.x]).toEqual([0, 50, 100]);
    expect(distributeNodes(g, ["a", "b"], "horizontal")).toBe(g);
  });

  test("snapping rounds to the grid", () => {
    expect(snap({ x: 14, y: 26 })).toEqual({ x: 10, y: 30 });
    expect(snap({ x: 12, y: 26 }, 25)).toEqual({ x: 0, y: 25 });
  });
});

function setTo(g: Graph, xs: Record<string, number>): Graph {
  const nodes = [...g.nodes, ...Object.keys(xs).map((id) => ({ id, type: "email" }))];
  const layout = { ...(g.layout as Record<string, { x: number; y: number }>) };
  for (const [id, x] of Object.entries(xs)) layout[id] = { x, y: 0 };
  return { ...g, nodes, layout };
}

describe("finding a node", () => {
  test("a name that starts with the words comes first, then contains, id, type, settings", () => {
    const g = sampleTree();
    expect(searchNodes(g, "mark").map((f) => f.id)).toEqual(["high", "normal"]);
    expect(searchNodes(g, "tier")[0]).toMatchObject({ id: "tier", where: "name" });
    expect(searchNodes(g, "paus")[0]).toMatchObject({ id: "pause", where: "id" });
    expect(searchNodes(g, "delay")[0]).toMatchObject({ id: "pause", where: "type" });
    expect(searchNodes(g, "confirmed")[0]).toMatchObject({ id: "confirm", where: "settings" });
    expect(searchNodes(g, "   ")).toEqual([]);
    expect(searchNodes(g, "nothing like it")).toEqual([]);
  });
});
