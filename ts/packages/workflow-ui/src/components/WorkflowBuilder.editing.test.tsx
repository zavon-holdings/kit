import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { compile } from "@zavon/workflow-graph";
import * as conditions from "@zavon/conditions";
import { sampleTree } from "../test/fixtures.js";
import { FRAGMENT_FORMAT } from "../clipboard.js";
import { SHORTCUTS } from "../shortcuts.js";
import { STARTERS } from "../starters.js";
import type { Graph, SimulateResult, WorkflowApi } from "../types.js";
import type { Interrupt, Trigger } from "../trigger.js";
import type { Scenario } from "../scenarios.js";
import { WorkflowBuilder, type WorkflowBuilderProps } from "./WorkflowBuilder.js";
import { VersionDiff } from "./VersionDiff.js";

function Harness(props: Partial<WorkflowBuilderProps> & { initial?: Graph; onGraph?: (g: Graph) => void; initialTrigger?: Trigger; onTrigger?: (t: Trigger) => void }) {
  const [graph, setGraph] = useState<Graph>(props.initial ?? sampleTree());
  const [trigger, setTrigger] = useState<Trigger | undefined>(props.initialTrigger);
  const [interrupts, setInterrupts] = useState<Interrupt[]>(props.interrupts ?? []);
  return (
    <WorkflowBuilder
      {...props}
      graph={graph}
      triggerValue={trigger}
      onTriggerChange={(t) => {
        setTrigger(t);
        props.onTrigger?.(t);
      }}
      interrupts={props.initialTrigger ? interrupts : undefined}
      onInterruptsChange={setInterrupts}
      onChange={
        props.readOnly
          ? undefined
          : (g) => {
              setGraph(g);
              props.onGraph?.(g);
            }
      }
    />
  );
}

const editor = () => screen.getByRole("region", { name: "Workflow editor" });
const inspector = () => screen.getByRole("complementary", { name: "Inspector" });
const list = () => screen.getByRole("list", { name: "Workflow, as a list" });
const rows = () => within(list()).getAllByRole("listitem").filter((li) => li.classList.contains("zwf-list-row"));
const row = (name: string) => rows().find((r) => r.querySelector(".zwf-list-head strong")?.textContent === name)!;
const openList = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("tab", { name: "List" }));
const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0] as Graph;

/** A clipboard event's data, as a browser hands it over. */
function clipboardData(initial = "") {
  let text = initial;
  return { getData: () => text, setData: (_: string, v: string) => (text = v), get text() { return text; } };
}

describe("undo and redo", () => {
  test("typing a name is one step back, and redo puts it again", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    render(<Harness onGraph={onGraph} />);
    await openList(user);
    await user.click(row("Which tier?"));
    const name = within(inspector()).getByRole("textbox", { name: "Name" });
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    await user.clear(name);
    await user.type(name, "Tier");
    expect(last(onGraph).nodes.find((n) => n.id === "tier")!.name).toBe("Tier");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(last(onGraph).nodes.find((n) => n.id === "tier")!.name).toBe("Which tier?");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(last(onGraph).nodes.find((n) => n.id === "tier")!.name).toBe("Tier");
  });

  test("Ctrl+Z from the canvas undoes a removal", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    render(<Harness onGraph={onGraph} />);
    await openList(user);
    await user.click(row("Mark high"));
    await user.click(within(inspector()).getByRole("button", { name: "Remove Mark high" }));
    expect(last(onGraph).nodes.some((n) => n.id === "high")).toBe(false);
    fireEvent.keyDown(rows()[0], { key: "z", ctrlKey: true });
    expect(last(onGraph).nodes.some((n) => n.id === "high")).toBe(true);
    fireEvent.keyDown(rows()[0], { key: "Z", ctrlKey: true, shiftKey: true });
    expect(last(onGraph).nodes.some((n) => n.id === "high")).toBe(false);
  });

  test("a read-only editor offers neither", () => {
    render(<Harness readOnly />);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Redo" })).toBeNull();
  });
});

describe("copy and paste", () => {
  test("copy writes a fragment to the clipboard; paste adds fresh copies, selected", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    render(<Harness onGraph={onGraph} />);
    await openList(user);
    await user.click(row("Mark high"));
    const data = clipboardData();
    fireEvent.copy(rows()[0], { clipboardData: data });
    expect(JSON.parse(data.text)).toMatchObject({ format: FRAGMENT_FORMAT, nodes: [{ id: "high" }] });
    fireEvent.paste(rows()[0], { clipboardData: data });
    expect(last(onGraph).nodes.map((n) => n.id)).toContain("high-2");
    expect(within(inspector()).getByRole("heading", { name: "Mark high" })).toBeInTheDocument();
    expect(within(inspector()).getByRole("textbox", { name: "Id (the step's code)" })).toHaveValue("high-2");
  });

  test("a sub-tree is copied from the inspector and pasted with its edges", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    render(<Harness onGraph={onGraph} />);
    await openList(user);
    await user.click(row("Which tier?"));
    await user.click(within(inspector()).getByRole("button", { name: "Copy it and everything after it" }));
    await user.click(within(inspector()).getByRole("button", { name: "Paste" }));
    const g = last(onGraph);
    expect(g.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["tier-2", "high-2", "normal-2", "done-2"]));
    expect(g.edges).toEqual(expect.arrayContaining([{ from: "tier-2", to: "normal-2", label: "standard", default: true }]));
    expect(within(inspector()).getByRole("heading", { name: "4 nodes" })).toBeInTheDocument();
  });

  test("Ctrl+D duplicates, and cut removes what it copied", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    render(<Harness onGraph={onGraph} />);
    await openList(user);
    await user.click(row("Mark normal"));
    fireEvent.keyDown(rows()[0], { key: "d", ctrlKey: true });
    expect(last(onGraph).nodes.map((n) => n.id)).toContain("normal-2");
    const data = clipboardData();
    fireEvent.cut(rows()[0], { clipboardData: data });
    expect(last(onGraph).nodes.map((n) => n.id)).not.toContain("normal-2");
    expect(JSON.parse(data.text).nodes[0].id).toBe("normal-2");
  });

  test("text in a field is the field's to copy", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openList(user);
    await user.click(row("Mark high"));
    const data = clipboardData();
    fireEvent.copy(within(inspector()).getByRole("textbox", { name: "Name" }), { clipboardData: data });
    expect(data.text).toBe("");
  });
});

describe("several nodes at once", () => {
  test("shift-click selects several; align and remove act on all of them", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    render(<Harness onGraph={onGraph} />);
    await openList(user);
    await user.click(row("Mark high"));
    await user.keyboard("{Shift>}");
    await user.click(row("Mark normal"));
    await user.click(row("Which tier?"));
    await user.keyboard("{/Shift}");
    expect(within(inspector()).getByRole("heading", { name: "3 nodes" })).toBeInTheDocument();
    await user.click(within(inspector()).getByRole("button", { name: "Align left" }));
    const at = last(onGraph).layout as Record<string, { x: number }>;
    expect(new Set([at.high.x, at.normal.x, at.tier.x]).size).toBe(1);
    fireEvent.keyDown(rows()[0], { key: "Delete" });
    expect(last(onGraph).nodes.map((n) => n.id)).not.toEqual(expect.arrayContaining(["high"]));
    expect(last(onGraph).nodes.some((n) => ["high", "normal", "tier"].includes(n.id))).toBe(false);
  });

  test("select all never removes the start", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    render(<Harness onGraph={onGraph} />);
    await openList(user);
    fireEvent.keyDown(rows()[0], { key: "a", ctrlKey: true });
    expect(within(inspector()).getByRole("heading", { name: `${sampleTree().nodes.length} nodes` })).toBeInTheDocument();
    expect(within(inspector()).getByText("The start node cannot be removed.")).toBeInTheDocument();
    await user.click(within(inspector()).getByRole("button", { name: `Remove ${sampleTree().nodes.length - 1} nodes` }));
    expect(last(onGraph).nodes.map((n) => n.id)).toEqual(["start"]);
  });

  test("Shift+arrows move the selection by the grid", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    const g = sampleTree();
    render(<Harness onGraph={onGraph} initial={{ ...g, layout: { high: { x: 100, y: 100 } } }} />);
    await openList(user);
    await user.click(row("Mark high"));
    fireEvent.keyDown(rows()[0], { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(rows()[0], { key: "ArrowRight", shiftKey: true });
    expect((last(onGraph).layout as Record<string, { x: number }>).high.x).toBe(120);
  });
});

describe("finding, problems and the shortcuts sheet", () => {
  test("find lists matches, and a match goes to its node", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole("searchbox", { name: "Find a node" }), "mark");
    expect(screen.getByText("2 matches.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark normal" }));
    expect(within(inspector()).getByRole("heading", { name: "Mark normal" })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Set a value: Mark normal/ })));
  });

  test("Enter in find goes to the best match; nothing found says so", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByRole("searchbox", { name: "Find a node" });
    await user.type(box, "zzz");
    expect(screen.getByText("No node matches.")).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, "two days{Enter}");
    expect(within(inspector()).getByRole("heading", { name: "Two days" })).toBeInTheDocument();
  });

  test("a problem's link goes to the node: selected and focused", async () => {
    const user = userEvent.setup();
    const g = sampleTree();
    render(<Harness initial={{ ...g, edges: g.edges.filter((e) => !(e.from === "tier" && e.default)) }} />);
    const link = screen.getAllByRole("button", { name: /^Show Which tier\?/ })[0];
    await user.click(link);
    expect(within(inspector()).getByRole("heading", { name: "Which tier?" })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Decision: Which tier\?/));
  });

  test("the sheet lists every shortcut and closes on Escape, giving focus back", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Keyboard shortcuts" });
    await user.click(opener);
    const sheet = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    for (const s of SHORTCUTS) expect(within(sheet).getByText(s.does)).toBeInTheDocument();
    expect(document.activeElement).toBe(within(sheet).getByRole("button", { name: "Close" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  test("? opens the sheet; while it is open Delete removes nothing", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    render(<Harness onGraph={onGraph} />);
    await openList(user);
    await user.click(row("Mark high"));
    fireEvent.keyDown(rows()[0], { key: "?", shiftKey: true });
    const sheet = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    fireEvent.keyDown(sheet, { key: "Delete" });
    expect(onGraph).not.toHaveBeenCalled();
  });
});

describe("export and import", () => {
  test("an imported graph replaces the drawing as one undoable edit; a bad file is refused in words", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    render(<Harness onGraph={onGraph} />);
    await user.click(screen.getByText("Export"));
    const input = screen.getByLabelText("Graph file to import") as HTMLInputElement;
    const small = STARTERS.find((s) => s.code === "review-and-route")!.graph();
    await user.upload(input, new File([JSON.stringify(small)], "g.json", { type: "application/json" }));
    await waitFor(() => expect(last(onGraph)).toEqual(small));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(last(onGraph)).toEqual(sampleTree());
    await user.upload(input, new File(["{\"format\":\"x\"}"], "g.json", { type: "application/json" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not a workflow.graph/1 graph");
  });

  test("a read-only editor exports but does not import", async () => {
    const user = userEvent.setup();
    render(<Harness readOnly />);
    await user.click(screen.getByText("Export"));
    expect(screen.getByRole("button", { name: "Download the graph (JSON)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Import/ })).toBeNull();
  });
});

describe("the trigger and interrupts, on the start node", () => {
  test("switching kind keeps only what the new kind reads; problems say what the server will", async () => {
    const user = userEvent.setup();
    const onTrigger = vi.fn();
    render(<Harness initialTrigger={{ kind: "event", event_type: "" }} onTrigger={onTrigger} events={[{ type: "orders.order.placed", label: "An order is placed", vars: ["total_cents"] }]} />);
    await openList(user);
    await user.click(row("Start"));
    const panel = within(inspector()).getByRole("group", { name: "Trigger" });
    expect(within(panel).getByText("An event trigger needs the event it starts on.")).toBeInTheDocument();
    await user.type(within(panel).getByRole("combobox", { name: "The event" }), "orders.order.placed");
    expect(onTrigger.mock.calls.at(-1)![0]).toMatchObject({ kind: "event", event_type: "orders.order.placed" });
    expect(within(panel).getByText("An order is placed", { selector: "p" })).toBeInTheDocument();
    await user.click(within(panel).getByRole("radio", { name: /On a schedule/ }));
    expect(onTrigger.mock.calls.at(-1)![0]).toEqual({ kind: "schedule", cron_expression: "0 8 * * *" });
    expect(within(panel).getAllByText("Every day at 08:00").length).toBeGreaterThan(0);
  });

  test("an interrupt is added, and names a step of this workflow", async () => {
    const user = userEvent.setup();
    render(<Harness initialTrigger={{ kind: "manual" }} />);
    await openList(user);
    await user.click(row("Start"));
    await user.click(within(inspector()).getByRole("button", { name: "Add an interrupt" }));
    const group = within(inspector()).getByRole("group", { name: "Interrupts" });
    expect(within(group).getByText("Interrupt 1 needs the event that interrupts.")).toBeInTheDocument();
    await user.type(within(group).getByRole("combobox", { name: "Interrupt 1: when" }), "orders.order.cancelled");
    await user.selectOptions(within(group).getByRole("combobox", { name: "Interrupt 1: go to" }), "refused");
    expect(within(group).queryByRole("list", { name: "Interrupt problems" })).toBeNull();
  });

  test("without the trigger handed in, the start node only describes it", async () => {
    const user = userEvent.setup();
    render(<Harness triggerSummary="Starts when a thing happens." />);
    await openList(user);
    await user.click(row("Start"));
    expect(within(inspector()).getByText("Starts when a thing happens.")).toBeInTheDocument();
    expect(within(inspector()).queryByRole("group", { name: "Trigger" })).toBeNull();
  });
});

describe("who a task goes to", () => {
  test("asks the server for the sample, and nobody found is said in red", async () => {
    const user = userEvent.setup();
    const previewAssignees = vi
      .fn()
      .mockResolvedValueOnce({ assignees: [{ email: "a@example.org", name: "Ada", source: "role" }], unassignable: false, says: "From the role." })
      .mockResolvedValueOnce({ assignees: [], unassignable: true, says: "Nobody holds the role." });
    render(<Harness api={{ previewAssignees }} sample={{ subject: { type: "request", pid: "r-1" }, vars: {} }} />);
    await openList(user);
    await user.click(row("Review"));
    const ask = within(inspector()).getByRole("button", { name: "Who would this go to for request r-1?" });
    await user.click(ask);
    expect(await within(inspector()).findByText("Ada <a@example.org>")).toBeInTheDocument();
    expect(previewAssignees.mock.calls[0][0]).toMatchObject({ node: { id: "approve", type: "review" }, sample: { subject: { pid: "r-1" } } });
    await user.click(ask);
    expect(await within(inspector()).findByText(/No assignees: a task here could not be assigned/)).toBeInTheDocument();
  });

  test("is not offered on a node nobody is asked at", async () => {
    const user = userEvent.setup();
    render(<Harness api={{ previewAssignees: vi.fn() }} />);
    await openList(user);
    await user.click(row("Mark high"));
    expect(within(inspector()).queryByRole("button", { name: /Who would this go to/ })).toBeNull();
  });
});

const endedAs = (outcome: string, path: string[]): SimulateResult => ({ path, steps: [], recipients: [], stopped: null, ended: { outcome, at: "2026-01-01T00:00:00Z" }, vars: {} });

describe("several samples, and scenarios", () => {
  test("two samples run side by side, each with its own result", async () => {
    const user = userEvent.setup();
    const simulate = vi.fn().mockResolvedValueOnce(endedAs("completed", ["large", "prepare"])).mockResolvedValueOnce(endedAs("declined", ["large", "approve"]));
    render(<Harness api={{ simulate }} />);
    await user.click(screen.getByRole("tab", { name: "Simulate" }));
    await user.click(screen.getByRole("button", { name: "Add another sample" }));
    const second = screen.getByRole("region", { name: "Sample 2" });
    fireEvent.change(within(second).getByRole("textbox", { name: "Vars (JSON)" }), { target: { value: '{"amount": 5000}' } });
    await user.click(screen.getByRole("button", { name: "Simulate all 2 samples" }));
    expect(await within(screen.getByRole("region", { name: "Sample 1" })).findByText("Ended: completed")).toBeInTheDocument();
    expect(await within(second).findByText("Ended: declined")).toBeInTheDocument();
    expect(simulate.mock.calls[1][0].vars).toEqual({ amount: 5000 });
    // The last one run is on the canvas; the first can be shown instead.
    expect(within(second).getByText("on the canvas")).toBeInTheDocument();
    await user.click(within(screen.getByRole("region", { name: "Sample 1" })).getByRole("button", { name: "Show its path" }));
    const marked = [...document.querySelectorAll('.zwf-node[data-on-path="true"]')].map((n) => n.getAttribute("data-type"));
    expect(marked.sort()).toEqual(["condition", "fork", "start"]);
  });

  test("a walk is saved as a scenario expecting what it came to", async () => {
    const user = userEvent.setup();
    const saveScenario = vi.fn(async () => {});
    const listScenarios = vi.fn(async () => [] as Scenario[]);
    render(<Harness api={{ simulate: vi.fn(async () => endedAs("completed", ["large"])), saveScenario, listScenarios }} />);
    await user.click(screen.getByRole("tab", { name: "Simulate" }));
    await user.click(screen.getByRole("button", { name: "Simulate" }));
    await screen.findByText("Ended: completed");
    await user.type(screen.getByRole("textbox", { name: "Keep this walk as a scenario named" }), "Small request");
    await user.click(screen.getByRole("button", { name: "Save the scenario" }));
    expect(saveScenario).toHaveBeenCalledWith(expect.objectContaining({ name: "Small request", decisions: {}, expect: { ended: true, outcome: "completed" } }));
    expect(await screen.findByText(/Saved as "Small request"/)).toBeInTheDocument();
    await waitFor(() => expect(listScenarios.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  test("scenarios run against the drawing: one passes, one fails with the reason", async () => {
    const user = userEvent.setup();
    const scenarios: Scenario[] = [
      { name: "Gold", sample: { subject: { type: "person", pid: "p" }, vars: { tier: "gold" } }, decisions: {}, expect: { outcome: "completed" } },
      { name: "Declined", sample: { subject: { type: "person", pid: "p" }, vars: {} }, decisions: { approve: "rejected" }, expect: { outcome: "declined" } },
    ];
    const simulate = vi.fn().mockResolvedValueOnce(endedAs("completed", [])).mockResolvedValueOnce(endedAs("completed", []));
    const api: WorkflowApi = { simulate, listScenarios: async () => scenarios, deleteScenario: vi.fn(async () => {}) };
    render(<Harness api={api} />);
    await user.click(screen.getByRole("tab", { name: "Scenarios" }));
    await user.click(await screen.findByRole("button", { name: "Run all 2 against this drawing" }));
    expect(await screen.findByText("1 of 2 failing")).toBeInTheDocument();
    expect(screen.getByText("fails: it ended completed, not declined")).toBeInTheDocument();
    expect(simulate.mock.calls[1][0].decisions).toEqual({ approve: "rejected" });
  });

  test("a host that runs scenarios itself is asked instead", async () => {
    const user = userEvent.setup();
    const runScenarios = vi.fn(async () => [{ name: "Gold", pass: true, why: "as expected" }]);
    const scenarios: Scenario[] = [{ name: "Gold", sample: { subject: { type: "person", pid: "p" }, vars: {} }, decisions: {}, expect: { ended: true } }];
    render(<Harness api={{ listScenarios: async () => scenarios, runScenarios }} />);
    await user.click(screen.getByRole("tab", { name: "Scenarios" }));
    await user.click(await screen.findByRole("button", { name: "Run all 1 against this drawing" }));
    expect(await screen.findByText("All 1 pass")).toBeInTheDocument();
    expect(runScenarios).toHaveBeenCalledTimes(1);
  });
});

describe("comparing two versions", () => {
  test("marks what changed on each drawing and lines the steps up", () => {
    const before = sampleTree();
    const after = structuredClone(before);
    after.nodes = after.nodes.filter((n) => n.id !== "high");
    after.edges = after.edges.map((e) => (e.to === "high" ? { ...e, to: "normal" } : e)).filter((e) => e.from !== "high");
    after.nodes.find((n) => n.id === "confirm")!.config = { template_code: "other" };
    render(<VersionDiff before={{ label: "Version 1", graph: before }} after={{ label: "Version 2", graph: after }} />);
    const left = screen.getByRole("region", { name: "Version 1, drawn" });
    const right = screen.getByRole("region", { name: "Version 2, drawn" });
    expect(within(left).getByRole("button", { name: /^Set a value: Mark high.*removed$/ })).toBeInTheDocument();
    expect(within(right).queryByRole("button", { name: /Mark high/ })).toBeNull();
    expect(within(right).getByRole("button", { name: /^Email: Confirm.*changed$/ })).toBeInTheDocument();
    const steps = screen.getByRole("table", { name: "Steps of Version 1 and Version 2" });
    expect(within(steps).getByText("high").closest("tr")).toHaveAttribute("data-change", "removed");
    expect(within(steps).getByText("confirm").closest("tr")).toHaveAttribute("data-change", "changed");
    expect(within(steps).queryByText("start")).toBeNull();
  });

  test("two equal versions say so", () => {
    render(<VersionDiff before={{ label: "v1", graph: sampleTree() }} after={{ label: "v2", graph: sampleTree() }} />);
    expect(screen.getByText("No difference: the two versions draw and run the same.")).toBeInTheDocument();
  });
});

describe("starters", () => {
  test("every starter compiles as it stands", () => {
    for (const s of STARTERS) {
      const out = compile(s.graph(), { trigger: s.trigger ?? "", conditions: { parse: conditions.parse, fields: conditions.fields } });
      expect(out.problems ?? [], s.code).toEqual([]);
    }
  });
});

describe("the view menu", () => {
  test("the overview map can be turned on for a small graph", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(document.querySelector(".react-flow__minimap")).toBeNull();
    await user.click(screen.getByText("View"));
    await user.click(screen.getByRole("checkbox", { name: "Overview map" }));
    expect(document.querySelector(".react-flow__minimap")).not.toBeNull();
    act(() => editor());
  });
});

describe("comparing two versions, as lists", () => {
  test("the List twin carries the same marks as the canvas", async () => {
    const user = userEvent.setup();
    const after = structuredClone(sampleTree());
    after.nodes.find((n) => n.id === "confirm")!.config = { template_code: "other" };
    render(<VersionDiff before={{ label: "Version 1", graph: sampleTree() }} after={{ label: "Version 2", graph: after }} />);
    await user.click(screen.getByRole("checkbox", { name: "Show as lists" }));
    const right = screen.getByRole("region", { name: "Version 2, drawn" });
    const confirm = within(right)
      .getAllByRole("listitem")
      .find((li) => li.querySelector(".zwf-list-head strong")?.textContent === "Confirm")!;
    expect(within(confirm).getByText("changed")).toBeInTheDocument();
  });
});
