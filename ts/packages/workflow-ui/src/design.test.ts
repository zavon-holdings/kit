import { describe, expect, test } from "vitest";
import { NODE_KINDS, PALETTE_GROUPS } from "./catalogue.js";
import { categoryOf, endOutcome, outcomeTone, summarize, CATEGORY_LABELS } from "./design.js";
import { branchOf } from "./branch.js";
import { fitView, readableView, VIEW } from "./viewport.js";
import { roundedLanePath } from "./routing.js";
import { sampleTree } from "./test/fixtures.js";
import type { Graph } from "./types.js";

describe("categories", () => {
  test("every node type has a category with a name, and the palette's groups map one to one", () => {
    for (const k of NODE_KINDS) expect(CATEGORY_LABELS[categoryOf(k.type)]).toBeTruthy();
    expect(PALETTE_GROUPS.map((g) => categoryOf(NODE_KINDS.find((k) => k.group === g)!.type))).toEqual(["logic", "people", "messages", "money", "timing", "apps"]);
    expect(categoryOf("start")).toBe("structure");
    expect(categoryOf("end")).toBe("structure");
    expect(categoryOf("approval")).toBe("people");
    expect(categoryOf("invoice")).toBe("money");
    expect(categoryOf("webhook")).toBe("apps");
  });
});

describe("outcome tones", () => {
  test.each([
    ["approved", "ok"],
    ["Approved", "ok"],
    ["yes", "ok"],
    ["paid", "ok"],
    ["rejected", "danger"],
    ["no", "danger"],
    ["Declined to share", "neutral"],
    ["declined", "danger"],
    ["voided", "danger"],
    ["timeout", "warn"],
    ["expired", "warn"],
    ["overdue", "warn"],
    ["withdrawn", "warn"],
    ["gold", "neutral"],
    ["", "neutral"],
    [undefined, "neutral"],
  ])("%s is %s", (label, tone) => {
    expect(outcomeTone(label as string | undefined)).toBe(tone);
  });

  test("an end's outcome is its config's, else completed", () => {
    expect(endOutcome({ id: "e", type: "end", config: { outcome: "declined" } })).toBe("declined");
    expect(endOutcome({ id: "e", type: "end" })).toBe("completed");
  });
});

describe("a node's one line", () => {
  test("says who, when or what, and nothing when the settings say nothing", () => {
    const g = sampleTree();
    const byId = (id: string) => g.nodes.find((n) => n.id === id)!;
    expect(summarize(byId("large"), g)).toBe("2 branches");
    expect(summarize(byId("pause"), g)).toBe("Wait 2 days");
    expect(summarize(byId("both"), g)).toBe("When all arms arrive");
    expect(summarize(byId("high"), g)).toBe("Sets priority");
    expect(summarize(byId("confirm"), g)).toBe("Template confirmed");
    expect(summarize({ id: "a", type: "approval", config: { assignees: [{ people: [{ email: "a@example.org" }, { email: "b@example.org" }] }], mode: "all" } })).toBe("a@example.org +1 · all must approve");
    expect(summarize({ id: "p", type: "payment_request", config: { amount: 125000, currency: "ZAR", expires: { value: 3, unit: "days" } } })).toBe("ZAR 1,250 · expires in 3 days");
    expect(summarize({ id: "w", type: "webhook", config: { url: "https://hooks.example.org/x" } })).toBe("POST hooks.example.org");
    expect(summarize({ id: "x", type: "email", config: {} })).toBe("");
    expect(summarize({ id: "x", type: "review", config: { assignees: "not a list" } })).toBe("");
  });
});

describe("a branch", () => {
  test("is the node and what only it reaches; a shared end and the steps before stay", () => {
    const g = sampleTree();
    // Review's branch: Say no and Refused are reached only through it; Prepare is also reached from "no".
    expect(branchOf(g, "approve")).toEqual(["approve", "declined", "refused"]);
    expect(branchOf(g, "tier")).toEqual(["tier", "high", "normal", "done"]);
    expect(branchOf(g, "start")).toEqual([]);
    expect(branchOf(g, "nope")).toEqual([]);
  });

  test("a loop back to an earlier step never takes that step", () => {
    const g: Graph = {
      format: "workflow.graph/1",
      nodes: [
        { id: "start", type: "start" },
        { id: "a", type: "delay" },
        { id: "b", type: "review" },
        { id: "c", type: "end" },
      ],
      edges: [
        { from: "start", to: "a" },
        { from: "a", to: "b" },
        { from: "b", to: "a", label: "again" },
        { from: "b", to: "c", label: "done", default: true },
      ],
    };
    expect(branchOf(g, "b")).toEqual(["b", "c"]);
  });
});

describe("the view", () => {
  test("a graph that fits is drawn whole, centred, never blown up", () => {
    const v = readableView({ x: 0, y: 0, width: 200, height: 200 }, 1000, 600);
    expect(v.zoom).toBe(VIEW.max);
    expect(v.x).toBeCloseTo(500 - 100 * VIEW.max);
  });

  test("a tall, narrow tree starts at the top at a readable size instead of shrinking", () => {
    const v = readableView({ x: 0, y: 0, width: 400, height: 3000 }, 800, 600);
    expect(v.zoom).toBeGreaterThanOrEqual(VIEW.readable);
    expect(v.y).toBe(VIEW.pad);
  });

  test("Fit shows the whole graph, but not below its floor; then from the top", () => {
    const small = fitView({ x: 0, y: 0, width: 400, height: 900 }, 800, 600);
    expect(small.zoom).toBeLessThan(1);
    expect(small.zoom).toBeGreaterThanOrEqual(VIEW.fitFloor);
    const tall = fitView({ x: 0, y: 0, width: 400, height: 6000 }, 800, 600);
    expect(tall.zoom).toBe(VIEW.fitFloor);
    expect(tall.y).toBe(VIEW.pad);
  });
});

describe("a lane's label", () => {
  test("sits on the side away from the nodes it passes", () => {
    expect(roundedLanePath(95, 72, 95, 240, -28).side).toBe(-1);
    expect(roundedLanePath(95, 72, 95, 240, 300).side).toBe(1);
    const r = roundedLanePath(95, 72, 95, 240, 300);
    expect(r.d.startsWith("M 95 72")).toBe(true);
    expect(r.d.endsWith("L 95 240")).toBe(true);
    expect([r.labelX, r.labelY]).toEqual([300, 156]);
  });
});
