import { describe, expect, test } from "vitest";
import { compile } from "@zavon/workflow-graph";
import * as conditions from "@zavon/conditions";
import {
  addNode,
  connect,
  disconnect,
  EditError,
  emptyGraph,
  freshId,
  isLastDefault,
  moveEdge,
  outEdges,
  removeNode,
  renameNode,
  roleOf,
  setDefault,
  setEdge,
  setMaxPasses,
  setNodeConfig,
  setNodeName,
  setPosition,
  slug,
} from "./model.js";
import { sampleTree } from "./test/fixtures.js";

const opts = { conditions };

describe("a new graph", () => {
  test("is a start joined to an end, and compiles", () => {
    const g = emptyGraph();
    expect(g.nodes.map((n) => n.type)).toEqual(["start", "end"]);
    expect(compile(g, opts).steps).toEqual([{ code: "done", name: "Done", kind: "end", config: { outcome: "completed" } }]);
  });
});

describe("ids", () => {
  test("a slug is a step id: lower case, single hyphens, no compiler separator", () => {
    expect(slug("Send the  Welcome!")).toBe("send-the-welcome");
    expect(slug("a -- b")).toBe("a-b");
    expect(slug("***")).toBe("step");
  });
  test("a fresh id is not taken", () => {
    const g = emptyGraph();
    expect(freshId(g, "done")).toBe("done-2");
    expect(freshId(g, "email")).toBe("email");
  });
  test("renaming moves edges and layout with the node", () => {
    let g = setPosition(sampleTree(), "confirm", { x: 5, y: 9 });
    g = renameNode(g, "confirm", "tell-them");
    expect(g.nodes.some((n) => n.id === "confirm")).toBe(false);
    expect(g.edges.filter((e) => e.from === "tell-them" || e.to === "tell-them")).toHaveLength(2);
    expect(g.layout).toEqual({ "tell-them": { x: 5, y: 9 } });
  });
  test("renaming refuses a taken id and the compiler's separator", () => {
    expect(() => renameNode(sampleTree(), "confirm", "pause")).toThrow(EditError);
    expect(() => renameNode(sampleTree(), "confirm", "a--b")).toThrow(/not an id/);
  });
});

describe("adding and removing", () => {
  test("a node added after another is connected to it", () => {
    const { graph, id } = addNode(emptyGraph(), "email", { from: "done" });
    // An end has no way out: nothing is connected from it.
    expect(outEdges(graph, "done")).toHaveLength(0);
    const second = addNode(graph, "delay", { from: id });
    expect(second.graph.edges.at(-1)).toEqual({ from: id, to: second.id });
    expect(second.graph.nodes.find((n) => n.id === second.id)?.config).toEqual({ value: 1, unit: "days" });
  });
  test("a second start is refused", () => {
    const g = emptyGraph();
    expect(addNode(g, "start").graph).toBe(g);
  });
  test("removing a node removes its edges and position; the start stays", () => {
    let g = setPosition(sampleTree(), "pause", { x: 1, y: 1 });
    g = removeNode(g, "pause");
    expect(g.edges.some((e) => e.from === "pause" || e.to === "pause")).toBe(false);
    expect(g.layout).toBeUndefined();
    expect(removeNode(g, "start")).toBe(g);
  });
});

describe("connecting", () => {
  test("a condition's ways out are yes, then no as the default", () => {
    let g = addNode(emptyGraph(), "condition").graph;
    g = connect(g, "condition", "done").graph;
    g = addNode(g, "end", { id: "other" }).graph;
    g = connect(g, "condition", "other").graph;
    expect(outEdges(g, "condition").map((x) => x.edge)).toEqual([
      { from: "condition", to: "done", label: "yes" },
      { from: "condition", to: "other", label: "no", default: true },
    ]);
  });
  test("a decision's second way out becomes the default; later ones are cases", () => {
    let g = addNode(emptyGraph(), "decision").graph;
    g = addNode(g, "end", { id: "a" }).graph;
    g = addNode(g, "end", { id: "b" }).graph;
    g = connect(g, "decision", "a").graph;
    g = connect(g, "decision", "b").graph;
    g = connect(g, "decision", "done").graph;
    expect(outEdges(g, "decision").map((x) => [x.edge.label, !!x.edge.default])).toEqual([
      ["case-1", false],
      ["otherwise", true],
      ["case-2", false],
    ]);
  });
  test("a review's ways out take its outcomes' names", () => {
    let g = addNode(emptyGraph(), "review").graph;
    g = connect(g, "review", "done").graph;
    expect(outEdges(g, "review")[0].edge.label).toBe("approved");
    expect(roleOf(g, "review")).toBe("routes");
  });
  test("a wait's second way out is its timeout", () => {
    let g = addNode(emptyGraph(), "wait_event").graph;
    g = addNode(g, "end", { id: "late" }).graph;
    g = connect(g, "wait", "done").graph;
    g = connect(g, "wait", "late").graph;
    expect(outEdges(g, "wait").map((x) => x.edge.label)).toEqual([undefined, "timeout"]);
  });
  test("nothing leaves an end, nothing enters the start, a node does not join itself", () => {
    const g = sampleTree();
    expect(connect(g, "done", "tier").index).toBe(-1);
    expect(connect(g, "tier", "start").index).toBe(-1);
    expect(connect(g, "tier", "tier").index).toBe(-1);
    expect(connect(g, "high", "done").index).toBe(-1);
  });
});

describe("defaults", () => {
  test("making a way out the default unmakes the old one, which keeps a name", () => {
    let g = sampleTree();
    const gold = g.edges.findIndex((e) => e.from === "tier" && e.label === "gold");
    g = setDefault(g, gold);
    const outs = outEdges(g, "tier").map((x) => x.edge);
    expect(outs.filter((e) => e.default)).toHaveLength(1);
    expect(outs[0]).toEqual({ from: "tier", to: "high", label: "gold", default: true });
    expect(outs[1]).toEqual({ from: "tier", to: "normal", label: "standard" });
  });
  test("an unnamed old default is given a case name", () => {
    let g = addNode(emptyGraph(), "decision").graph;
    g = addNode(g, "end", { id: "a" }).graph;
    g = { ...g, edges: [...g.edges, { from: "decision", to: "a", default: true }, { from: "decision", to: "done", label: "x" }] };
    g = setDefault(g, g.edges.length - 1);
    expect(outEdges(g, "decision")[0].edge).toEqual({ from: "decision", to: "a", label: "case-1" });
  });
  test("the default of a chooser is the last of its kind; a plain edge is not", () => {
    const g = sampleTree();
    expect(isLastDefault(g, g.edges.findIndex((e) => e.from === "tier" && e.default))).toBe(true);
    expect(isLastDefault(g, 0)).toBe(false);
  });
});

describe("edges", () => {
  test("a node's ways out reorder among themselves only", () => {
    const g = sampleTree();
    const gold = g.edges.findIndex((e) => e.from === "tier" && e.label === "gold");
    const moved = moveEdge(g, gold, 1);
    expect(outEdges(moved, "tier").map((x) => x.edge.label)).toEqual(["standard", "gold"]);
    expect(moveEdge(moved, moved.edges.findIndex((e) => e.label === "gold"), 1)).toBe(moved);
  });
  test("label, condition and target are edited; an absent condition is cleared", () => {
    let g = sampleTree();
    const gold = g.edges.findIndex((e) => e.label === "gold");
    g = setEdge(g, gold, { label: "premium", to: "normal" });
    expect(g.edges[gold]).toMatchObject({ label: "premium", to: "normal" });
    g = setEdge(g, gold, { when: undefined });
    expect("when" in g.edges[gold]).toBe(false);
    expect(disconnect(g, gold).edges).toHaveLength(g.edges.length - 1);
  });
});

describe("node settings", () => {
  test("a name, a config and max passes; empty clears", () => {
    let g = setNodeName(sampleTree(), "pause", "Wait a bit");
    g = setNodeConfig(g, "pause", { unit: "hours", value: 3 });
    g = setMaxPasses(g, "pause", 4);
    expect(g.nodes.find((n) => n.id === "pause")).toEqual({ id: "pause", type: "delay", name: "Wait a bit", config: { unit: "hours", value: 3 }, max_passes: 4 });
    g = setNodeName(setNodeConfig(setMaxPasses(g, "pause", undefined), "pause", {}), "pause", " ");
    expect(g.nodes.find((n) => n.id === "pause")).toEqual({ id: "pause", type: "delay" });
  });
  test("moving a node is layout only: the steps are the same", () => {
    const g = sampleTree();
    const moved = setPosition(g, "tier", { x: 400.4, y: 12.6 });
    expect(moved.layout).toEqual({ tier: { x: 400, y: 13 } });
    expect(compile(moved, opts).steps).toEqual(compile(g, opts).steps);
  });
});
