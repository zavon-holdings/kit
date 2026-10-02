import { describe, expect, test } from "vitest";
import { compile } from "@zavon/workflow-graph";
import * as conditions from "@zavon/conditions";
import { graphSvg, graphToJson, readGraphJson } from "./exporting.js";
import { diffGraphs, diffSteps, nodeMarks } from "./diff.js";
import { keyWords, shortcutFor, SHORTCUTS, isTyping } from "./shortcuts.js";
import { checkScenario, describeExpect, expectFrom, scenarioNameProblem } from "./scenarios.js";
import { cronProblem, describeCron, describeTrigger, interruptProblems, triggerProblems, withKind } from "./trigger.js";
import { sampleTree } from "./test/fixtures.js";
import type { Graph, SimulateResult, Step } from "./types.js";

const cond = { parse: conditions.parse, fields: conditions.fields };
const stepsOf = (g: Graph): Step[] => compile(g, { conditions: cond }).steps!;

describe("export and import", () => {
  test("a graph goes out as JSON and comes back the same", () => {
    const g = sampleTree();
    const back = readGraphJson(graphToJson(g));
    expect(back.graph).toEqual(g);
  });

  test("import refuses what core would refuse on sight", () => {
    expect(readGraphJson("{").error).toMatch(/not JSON/);
    expect(readGraphJson("[]").error).toMatch(/not a JSON object/);
    expect(readGraphJson(JSON.stringify({ format: "other/1", nodes: [], edges: [] })).error).toMatch(/says other\/1/);
    expect(readGraphJson(JSON.stringify({ ...sampleTree(), extra: 1 })).error).toMatch(/unsupported field: extra/);
    expect(readGraphJson(JSON.stringify({ format: "workflow.graph/1", nodes: [{ id: "a" }], edges: [] })).error).toMatch(/id and a type/);
    expect(readGraphJson(JSON.stringify({ format: "workflow.graph/1", nodes: [{ id: "a", type: "end" }], edges: [] })).error).toMatch(/no start/);
  });

  test("a graph with problems imports, and shows them rather than being refused", () => {
    const g = { ...sampleTree(), edges: sampleTree().edges.filter((e) => !e.default) };
    expect(readGraphJson(graphToJson(g)).graph).toEqual(g);
  });

  test("the picture names every node and label, and escapes what it is given", () => {
    const g = sampleTree();
    g.nodes[1].name = "Large <request> & more";
    const svg = graphSvg(g, { title: "A & B", path: ["start", "large"], marks: { tier: "changed" } });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Large &lt;request&gt; &amp; …".slice(0, 18));
    expect(svg).toContain("A &amp; B");
    for (const n of g.nodes) expect(svg).toContain(`data-node="${n.id}"`);
    expect(svg).toContain("standard · default");
    expect(svg).toContain(">changed<");
    expect(svg).not.toMatch(/NaN|undefined/);
    // It parses as XML.
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  });

  test("the picture of an empty canvas is still a picture", () => {
    const svg = graphSvg({ format: "workflow.graph/1", nodes: [], edges: [] });
    expect(new DOMParser().parseFromString(svg, "image/svg+xml").getElementsByTagName("parsererror")).toHaveLength(0);
  });
});

describe("comparing versions", () => {
  test("nodes and edges added, removed and changed; layout is not a change", () => {
    const a = sampleTree();
    const b = structuredClone(a);
    b.layout = { start: { x: 999, y: 999 } };
    expect(diffGraphs(a, b).counts).toEqual({ added: 0, removed: 0, changed: 0 });
    b.nodes = b.nodes.filter((n) => n.id !== "high");
    b.edges = b.edges.filter((e) => e.from !== "high" && e.to !== "high");
    b.nodes.push({ id: "vip", type: "email", config: { template_code: "vip" } });
    b.edges.push({ from: "tier", to: "vip", label: "gold", when: { field: "vars.tier", op: "is", value: "gold" } }, { from: "vip", to: "done" });
    b.nodes.find((n) => n.id === "confirm")!.config = { template_code: "confirmed-2" };
    b.nodes.find((n) => n.id === "pause")!.name = "Three days";
    const d = diffGraphs(a, b);
    expect(d.nodes.find((n) => n.id === "high")!.change).toBe("removed");
    expect(d.nodes.find((n) => n.id === "vip")!.change).toBe("added");
    expect(d.nodes.find((n) => n.id === "confirm")).toMatchObject({ change: "changed", fields: ["config"] });
    expect(d.nodes.find((n) => n.id === "pause")).toMatchObject({ change: "changed", fields: ["name"] });
    expect(nodeMarks(d, "before")).toEqual({ high: "removed", confirm: "changed", pause: "changed" });
    expect(nodeMarks(d, "after")).toEqual({ vip: "added", confirm: "changed", pause: "changed" });
    expect(d.edges.filter((e) => e.change === "added").map((e) => e.key)).toEqual(["tier → vip (gold)", "vip → done"]);
  });

  test("a case moved earlier is a change of order; a condition edited is a change of condition", () => {
    const a = sampleTree();
    const b = structuredClone(a);
    const i = b.edges.findIndex((e) => e.from === "approve" && e.label === "approved");
    const j = b.edges.findIndex((e) => e.from === "approve" && e.label === "rejected");
    [b.edges[i], b.edges[j]] = [b.edges[j], b.edges[i]];
    b.edges.find((e) => e.label === "gold")!.when = { field: "vars.tier", op: "is", value: "platinum" };
    const d = diffGraphs(a, b);
    expect(d.edges.find((e) => e.key === "approve → prepare (approved)")!.fields).toEqual(["order"]);
    expect(d.edges.find((e) => e.key === "tier → high (gold)")!.fields).toEqual(["condition"]);
  });

  test("steps: added, removed in place, changed with the reason, moved, same", () => {
    const a = sampleTree();
    const b = structuredClone(a);
    b.nodes.find((n) => n.id === "confirm")!.config = { template_code: "other" };
    b.nodes = b.nodes.filter((n) => n.id !== "declined");
    b.edges = b.edges.map((e) => (e.to === "declined" ? { ...e, to: "refused" } : e)).filter((e) => e.from !== "declined");
    const rows = diffSteps(stepsOf(a), stepsOf(b));
    const by = (code: string) => rows.find((r) => r.code === code)!;
    expect(by("declined").change).toBe("removed");
    expect(by("confirm").change).toBe("changed");
    expect(by("confirm").why).toBeTruthy();
    expect(by("tier").change).toBe("same");
    // Every step of both sides appears once.
    const codes = new Set([...stepsOf(a), ...stepsOf(b)].map((s) => s.code));
    expect(rows.map((r) => r.code).sort()).toEqual([...codes].sort());
  });

  test("the same steps in another order are moved, not changed", () => {
    const s = (code: string): Step => ({ code, name: code, kind: "email", config: { template_code: code } });
    const rows = diffSteps([s("a"), s("b"), s("c")], [s("b"), s("a"), s("c")]);
    expect(rows.map((r) => `${r.code}:${r.change}`)).toEqual(["b:moved", "a:moved", "c:same"]);
  });
});

describe("shortcuts", () => {
  test("every action on the sheet is reachable from its first key", () => {
    for (const s of SHORTCUTS) {
      const parts = s.keys[0].split("+");
      const key = parts[parts.length - 1];
      const e = { key: key.length === 1 ? key.toLowerCase() : key, ctrlKey: parts.includes("Mod"), shiftKey: parts.includes("Shift") };
      expect(shortcutFor(e), s.keys[0]).toBe(s.action);
    }
  });

  test("Mod is ⌘ on a Mac and Ctrl elsewhere; Alt is never a shortcut", () => {
    expect(shortcutFor({ key: "z", metaKey: true }, true)).toBe("undo");
    expect(shortcutFor({ key: "z", ctrlKey: true }, true)).toBeNull();
    expect(shortcutFor({ key: "z", ctrlKey: true })).toBe("undo");
    expect(shortcutFor({ key: "Z", ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(shortcutFor({ key: "z", ctrlKey: true, altKey: true })).toBeNull();
    expect(shortcutFor({ key: "q" })).toBeNull();
    expect(keyWords("Mod+Shift+Z")).toBe("Ctrl+Shift+Z");
    expect(keyWords("Mod+Shift+Z", true)).toBe("⌘⇧Z");
  });

  test("keys typed into a field are the field's", () => {
    expect(isTyping(document.createElement("input"))).toBe(true);
    expect(isTyping(document.createElement("textarea"))).toBe(true);
    expect(isTyping(document.createElement("div"))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

const ended = (outcome: string, path: string[]): SimulateResult => ({ path, steps: [], recipients: [], stopped: null, ended: { outcome, at: "" }, vars: {} });
const stopped = (code: string, path: string[]): SimulateResult => ({
  path,
  steps: [],
  recipients: [],
  stopped: { code, node: code, reason: "needs_decision", message: "", choices: ["approved"] },
  ended: null,
  vars: {},
});

describe("scenarios", () => {
  test("an outcome, an end, a stop and the path are each checked", () => {
    expect(checkScenario({ outcome: "completed" }, ended("completed", ["a"]))).toEqual({ pass: true, why: "as expected" });
    expect(checkScenario({ outcome: "completed" }, ended("declined", ["a"])).why).toBe("it ended declined, not completed");
    expect(checkScenario({ outcome: "completed" }, stopped("approve", ["a"])).why).toMatch(/did not end/);
    expect(checkScenario({ ended: true }, stopped("approve", ["a"])).why).toBe("it stopped at approve instead of ending");
    expect(checkScenario({ ended: false }, ended("x", [])).why).toMatch(/ended \(x\)/);
    expect(checkScenario({ stops_at: "approve" }, stopped("approve", [])).pass).toBe(true);
    expect(checkScenario({ stops_at: "approve" }, stopped("review-2", [])).why).toBe("it stopped at review-2, not approve");
    expect(checkScenario({ path_includes: ["a", "b"] }, ended("x", ["a"])).why).toBe("it never passed b");
    expect(checkScenario({ path_excludes: ["a"] }, ended("x", ["a"])).why).toBe("it passed a, which it must not");
    expect(checkScenario({}, ended("x", [])).pass).toBe(true);
  });

  test("a scenario saved from a walk expects what the walk did", () => {
    expect(expectFrom(ended("completed", []))).toEqual({ ended: true, outcome: "completed" });
    expect(expectFrom(stopped("approve", []))).toEqual({ ended: false, stops_at: "approve" });
    expect(describeExpect({ ended: true, outcome: "completed", path_excludes: ["x"] })).toBe("ends completed; never passes x");
    expect(describeExpect({})).toMatch(/nothing expected/);
  });

  test("names are words, unique regardless of case", () => {
    expect(scenarioNameProblem("", [])).toMatch(/name/);
    expect(scenarioNameProblem("Gold member, approved", [])).toBeNull();
    expect(scenarioNameProblem("gold", ["Gold"])).toMatch(/already/);
    expect(scenarioNameProblem("a/b", [])).toMatch(/letters/);
  });
});

describe("triggers", () => {
  test("cron in words, and what cannot be read", () => {
    expect(describeCron("0 8 * * 1-5")).toBe("Every weekday at 08:00");
    expect(describeCron("30 7 * * 3")).toBe("Every Wednesday at 07:30");
    expect(describeCron("0 6 15 * *")).toBe("Day 15 of every month at 06:00");
    expect(describeCron("*/5 * * * *")).toBe("Every 5 minutes");
    expect(describeCron("0 8 * 1 *")).toBeNull();
    expect(cronProblem("0 8 * * *")).toBeNull();
    expect(cronProblem("0 25 * * *")).toMatch(/hour/);
    expect(cronProblem("0 8 * *")).toMatch(/five fields/);
    expect(cronProblem("")).toMatch(/needs its times/);
  });

  test("each kind's rules, as the server states them", () => {
    expect(triggerProblems({ kind: "event" })).toEqual(["An event trigger needs the event it starts on."]);
    expect(triggerProblems({ kind: "event", event_type: "orders.order.placed", filter: { field: "total", op: "gte", value: 5 } })).toEqual([]);
    expect(triggerProblems({ kind: "event", event_type: "x.y.z", filter: { field: "total", op: "nope", value: 5 } })[0]).toMatch(/filter cannot be read/);
    expect(triggerProblems({ kind: "date", date_recurs: true, once_per_subject: true, date_var: "birthday" })).toEqual([
      "A date that comes round every year cannot also be once per subject.",
    ]);
    expect(triggerProblems({ kind: "schedule", cron_expression: "0 8 * * *", filter: { field: "a", op: "is", value: 1 } })).toEqual([
      "Only an event trigger has an event to filter.",
    ]);
    expect(triggerProblems({ kind: "schedule", cron_expression: "0 8 * * *", subject_kind: "person" })).toEqual(["Only an event or a date trigger names a person."]);
    expect(triggerProblems({ kind: "event", event_type: "a.b.c", subject_kind: "external", subject_type: "nope" })).toEqual([
      "Write the kind of thing as app:type, for instance orders:order.",
    ]);
    expect(triggerProblems({ kind: "sometimes" })[0]).toMatch(/not a kind/);
  });

  test("changing kind drops what the new kind does not read", () => {
    const t = withKind({ kind: "event", event_type: "a.b.c", filter: { field: "x", op: "is", value: 1 }, subject_kind: "person" }, "schedule");
    expect(t).toEqual({ kind: "schedule", cron_expression: "0 8 * * *" });
    expect(withKind({ kind: "date", date_var: "d" }, "event")).toEqual({ kind: "event" });
    // The organisation a manual start is about is not what an event is about.
    expect(withKind({ kind: "manual", subject_kind: "org" }, "event")).toEqual({ kind: "event" });
    expect(withKind({ kind: "event", event_type: "a.b.c", subject_kind: "external", subject_type: "orders:order" }, "date")).toEqual({ kind: "date", date_var: "" });
  });

  test("the trigger in a sentence", () => {
    expect(describeTrigger(null)).toMatch(/by hand/);
    expect(describeTrigger({ kind: "event", event_type: "orders.order.placed", filter: { field: "x", op: "is", value: 1 } })).toBe(
      "Starts when orders.order.placed happens, when its filter matches.",
    );
    expect(describeTrigger({ kind: "schedule", cron_expression: "0 8 * * 1-5" })).toBe("Starts on a schedule: every weekday at 08:00.");
    expect(describeTrigger({ kind: "date", date_var: "renewal", date_offset_days: -7 })).toBe("Starts 7 days before each subject's renewal.");
  });

  test("interrupts name a real step, once per event", () => {
    expect(interruptProblems([{ event: "orders.order.cancelled", goto: "done" }], ["done"])).toEqual([]);
    expect(interruptProblems([{ event: "", goto: "nowhere" }], ["done"])).toEqual([
      "Interrupt 1 needs the event that interrupts.",
      "Interrupt 1 goes to nowhere, which is not a step of this workflow.",
    ]);
    expect(
      interruptProblems(
        [
          { event: "a.b.c", goto: "done" },
          { event: "a.b.c", goto: "done" },
        ],
        ["done"],
      ),
    ).toEqual(["Interrupt 2: a.b.c already interrupts; one event, one place to go."]);
  });
});
