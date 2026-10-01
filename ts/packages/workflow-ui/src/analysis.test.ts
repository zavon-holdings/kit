import { describe, expect, test } from "vitest";
import { decompile } from "@zavon/workflow-graph";
import { analyse, edgeKey } from "./analysis.js";
import { nextFocus } from "./nav.js";
import { disconnect } from "./model.js";
import { sampleTree } from "./test/fixtures.js";

describe("analysis", () => {
  test("a graph that compiles has steps and no problems", () => {
    const a = analyse(sampleTree());
    expect(a.problems).toEqual([]);
    expect(a.steps?.map((s) => s.code)).toContain("approve--route");
  });
  test("the list order is the compiled order, arms under their fork, the join after them", () => {
    const a = analyse(sampleTree());
    expect(a.order.slice(0, 3)).toEqual(["start", "large", "approve"]);
    const fork = a.order.indexOf("prepare");
    expect(a.order.slice(fork, fork + 4)).toEqual(["prepare", "confirm", "pause", "both"]);
    expect(a.arms.get("confirm")).toEqual({ fork: "prepare", arm: "tell" });
    expect([...a.order].sort()).toEqual(sampleTree().nodes.map((n) => n.id).sort());
  });
  test("no generated step is ever a node in the order", () => {
    const g = decompile(analyse(sampleTree()).steps!);
    const a = analyse(g);
    expect(a.order.some((id) => id.includes("--") && !id.endsWith("--join"))).toBe(false);
  });
  test("problems are indexed by node and by edge; the server's are added once", () => {
    const g = sampleTree();
    const broken = disconnect(g, g.edges.findIndex((e) => e.from === "tier" && e.default));
    const a = analyse(broken, { serverProblems: [{ code: "x", node: "tier", message: "from the server" }, { code: "x", node: "tier", message: "from the server" }] });
    expect(a.steps).toBeNull();
    expect(a.byNode.get("tier")?.map((p) => p.code)).toEqual(["choice_edges", "needs_default", "x"]);
    const edgeProblem = analyse({ ...g, edges: g.edges.map((e) => (e.label === "gold" ? { ...e, when: undefined } : e)) });
    expect(edgeProblem.byEdge.get(edgeKey({ from: "tier", to: "high", label: "gold" }))?.[0].code).toBe("needs_condition");
  });
});

describe("keyboard movement", () => {
  test("down follows the first way out, up the first way in, right and left the list", () => {
    const g = sampleTree();
    const order = analyse(g).order;
    expect(nextFocus(g, order, "large", "ArrowDown")).toBe("approve");
    expect(nextFocus(g, order, "approve", "ArrowUp")).toBe("large");
    expect(nextFocus(g, order, "start", "ArrowRight")).toBe("large");
    expect(nextFocus(g, order, "start", "ArrowLeft")).toBe("start");
    expect(nextFocus(g, order, "done", "ArrowDown")).toBeNull();
    expect(nextFocus(g, order, null, "Home")).toBe("start");
    expect(nextFocus(g, order, "start", "End")).toBe(order.at(-1));
    expect(nextFocus(g, order, "start", "x")).toBeNull();
  });
});

describe("the simulated path", () => {
  test("adds the start, and a join the walk went through", async () => {
    const { pathNodes } = await import("./analysis.js");
    const on = pathNodes(sampleTree(), ["large", "prepare", "confirm", "pause", "tier", "high", "done"]);
    expect(on.has("start")).toBe(true);
    expect(on.has("both")).toBe(true);
    expect(pathNodes(sampleTree(), ["large", "prepare", "confirm"]).has("both")).toBe(false);
    expect(pathNodes(sampleTree(), []).size).toBe(0);
  });
});
