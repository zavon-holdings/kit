import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { compile } from "@zavon/workflow-graph";
import * as conditions from "@zavon/conditions";
import { addNode, addNote, connect, emptyGraph, removeNode, removeNote, renameNode, setDefault, setNote } from "../model.js";
import { graphSvg, readGraphJson, graphToJson } from "../exporting.js";
import { NODE_KINDS, PALETTE_GROUPS } from "../catalogue.js";
import type { Graph } from "../types.js";
import { WorkflowBuilder } from "./WorkflowBuilder.js";

const cond = { parse: conditions.parse, fields: conditions.fields };
const problemsOf = (g: Graph) => compile(g, { conditions: cond }).problems ?? [];

function start(): Graph {
  return { format: "workflow.graph/1", nodes: [{ id: "start", type: "start" }], edges: [] };
}

describe("the new node types, edited as a person would", () => {
  test("every palette type is in a group the palette shows", () => {
    for (const k of NODE_KINDS) if (k.group !== "Structure") expect(PALETTE_GROUPS).toContain(k.group);
    for (const t of ["loop", "approval", "sub_workflow", "payment_request", "invoice"]) expect(NODE_KINDS.map((k) => k.type)).toContain(t);
  });

  test("a loop's first way out is its body, its second what follows; drawn so, it compiles", () => {
    let g = start();
    let loop: string, ping: string, done: string;
    ({ graph: g, id: loop } = addNode(g, "loop", { from: "start" }));
    ({ graph: g, id: ping } = addNode(g, "notification"));
    g = { ...g, nodes: g.nodes.map((n) => (n.id === ping ? { ...n, config: { channel: "in_app", in_app: { title: "Hello" }, to: [{ subject: true }] } } : n)) };
    ({ graph: g, id: done } = addNode(g, "end"));
    g = connect(g, loop, ping).graph;
    g = connect(g, ping, loop).graph;
    g = connect(g, loop, done).graph;
    expect(g.edges.filter((e) => e.from === loop).map((e) => e.label)).toEqual(["body", "next"]);
    expect(problemsOf(g)).toEqual([]);
  });

  test("a payment request's ways out are its outcomes, the fallback the default", () => {
    let g = start();
    let pay: string;
    ({ graph: g, id: pay } = addNode(g, "payment_request", { from: "start" }));
    g = { ...g, nodes: g.nodes.map((n) => (n.id === pay ? { ...n, config: { action: "billing.payment.request", amount: 100, currency: "EUR", expires: { value: 3, unit: "days" } } } : n)) };
    for (const outcome of ["paid", "failed", "expired"]) {
      let end: string;
      ({ graph: g, id: end } = addNode(g, "end", { name: outcome }));
      g = connect(g, pay, end).graph;
    }
    expect(g.edges.filter((e) => e.from === pay).map((e) => [e.label, !!e.default])).toEqual([
      ["paid", false],
      ["failed", false],
      ["expired", true],
    ]);
    expect(problemsOf(g)).toEqual([]);
  });

  test("an approval routes approved and rejected, with a default chosen", () => {
    let g = start();
    let ok: string, yes: string, no: string;
    ({ graph: g, id: ok } = addNode(g, "approval", { from: "start" }));
    g = { ...g, nodes: g.nodes.map((n) => (n.id === ok ? { ...n, config: { assignees: [{ people: [{ email: "a@example.org" }] }] } } : n)) };
    ({ graph: g, id: yes } = addNode(g, "end"));
    ({ graph: g, id: no } = addNode(g, "end"));
    g = connect(g, ok, yes).graph;
    g = connect(g, ok, no).graph;
    expect(g.edges.filter((e) => e.from === ok).map((e) => e.label)).toEqual(["approved", "rejected"]);
    g = setDefault(g, g.edges.findIndex((e) => e.from === ok && e.label === "rejected"));
    expect(problemsOf(g)).toEqual([]);
  });

  test("a sub-workflow that waits routes on its child's outcome", () => {
    let g = start();
    let sub: string, end: string;
    ({ graph: g, id: sub } = addNode(g, "sub_workflow", { from: "start" }));
    g = { ...g, nodes: g.nodes.map((n) => (n.id === sub ? { ...n, config: { definition: "child-flow" } } : n)) };
    ({ graph: g, id: end } = addNode(g, "end"));
    g = connect(g, sub, end).graph;
    expect(problemsOf(g)).toEqual([]);
  });
});

describe("notes", () => {
  test("added, edited, kept about their node through a rename, loosened when it goes", () => {
    let g = emptyGraph();
    let id: string;
    ({ graph: g, id } = addNote(g, { x: 10.4, y: 20.6 }, "Ask finance first", "done"));
    expect(g.notes).toEqual([{ id: "note-1", text: "Ask finance first", x: 10, y: 21, node: "done" }]);
    g = setNote(g, id, { text: "Ask finance" });
    g = renameNode(g, "done", "finished");
    expect(g.notes![0]).toMatchObject({ text: "Ask finance", node: "finished" });
    g = removeNode(g, "finished");
    expect(g.notes![0].node).toBeUndefined();
    expect(addNote(g, { x: 0, y: 0 }).id).toBe("note-2");
    g = removeNote(g, id);
    expect(g.notes).toBeUndefined();
  });

  test("a note about a node nobody has is refused as the server would", () => {
    const g = { ...emptyGraph(), notes: [{ id: "n", text: "x", x: 0, y: 0, node: "ghost" }] };
    expect(problemsOf(g).map((p) => p.code)).toContain("note");
  });

  test("notes travel in an export and are drawn in the picture", () => {
    const g = addNote(emptyGraph(), { x: 300, y: 0 }, "Remember <this>").graph;
    expect(readGraphJson(graphToJson(g)).graph).toEqual(g);
    const svg = graphSvg(g);
    expect(svg).toContain('data-note="note-1"');
    expect(svg).toContain("Remember &lt;this&gt;");
  });

  function Harness({ initial, onGraph }: { initial: Graph; onGraph?: (g: Graph) => void }) {
    const [graph, setGraph] = useState(initial);
    return (
      <WorkflowBuilder
        graph={graph}
        onChange={(g) => {
          setGraph(g);
          onGraph?.(g);
        }}
      />
    );
  }

  test("a note is added from the bar and edited on the List tab", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    render(<Harness initial={emptyGraph()} onGraph={onGraph} />);
    await user.click(screen.getByRole("button", { name: "Add a note" }));
    expect(onGraph.mock.calls.at(-1)![0].notes).toHaveLength(1);
    await user.click(screen.getByRole("tab", { name: "List" }));
    const notes = screen.getByRole("region", { name: "Notes on the canvas" });
    await user.type(within(notes).getByRole("textbox", { name: /note-1/ }), "Check with finance");
    expect(onGraph.mock.calls.at(-1)![0].notes[0].text).toBe("Check with finance");
    await user.click(within(notes).getByRole("button", { name: "Remove note-1" }));
    expect(onGraph.mock.calls.at(-1)![0].notes).toBeUndefined();
  });
});

describe("built-in inspectors for the new types", () => {
  function Harness({ initial, onGraph }: { initial: Graph; onGraph: (g: Graph) => void }) {
    const [graph, setGraph] = useState(initial);
    return (
      <WorkflowBuilder
        graph={graph}
        defaultView="list"
        onChange={(g) => {
          setGraph(g);
          onGraph(g);
        }}
      />
    );
  }
  const open = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    const row = within(screen.getByRole("list", { name: "Workflow, as a list" }))
      .getAllByRole("listitem")
      .find((li) => li.querySelector(".zwf-list-head strong")?.textContent === name)!;
    await user.click(row);
    return screen.getByRole("complementary", { name: "Inspector" });
  };

  test("a loop is turned from a count into a list of items", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    const g = addNode(start(), "loop", { from: "start" }).graph;
    render(<Harness initial={g} onGraph={onGraph} />);
    const inspector = await open(user, "loop");
    await user.selectOptions(within(inspector).getByRole("combobox", { name: "Repeat" }), "var");
    expect(onGraph.mock.calls.at(-1)![0].nodes[1].config.over).toEqual({ var: "vars.items" });
  });

  test("an invoice gains a reminder, and its outcomes are named", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    const g = addNode(start(), "invoice", { from: "start" }).graph;
    render(<Harness initial={g} onGraph={onGraph} />);
    const inspector = await open(user, "invoice");
    expect(within(inspector).getByText(/paid, voided, overdue \(the default\)/)).toBeInTheDocument();
    await user.click(within(inspector).getByRole("button", { name: "Add a reminder" }));
    expect(onGraph.mock.calls.at(-1)![0].nodes[1].config.reminders).toEqual([{ after: { value: 3, unit: "business_days" } }]);
  });
});
