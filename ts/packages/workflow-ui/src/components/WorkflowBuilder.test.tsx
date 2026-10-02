import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { decompile } from "@zavon/workflow-graph";
import { analyse } from "../analysis.js";
import { sampleTree } from "../test/fixtures.js";
import type { Graph, SimulateResult, WorkflowApi } from "../types.js";
import { WorkflowBuilder, type WorkflowBuilderProps } from "./WorkflowBuilder.js";

function Harness(props: Partial<WorkflowBuilderProps> & { initial?: Graph; onGraph?: (g: Graph) => void }) {
  const [graph, setGraph] = useState<Graph>(props.initial ?? sampleTree());
  return (
    <WorkflowBuilder
      {...props}
      graph={graph}
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

const list = () => screen.getByRole("list", { name: "Workflow, as a list" });
const rows = () => within(list()).getAllByRole("listitem").filter((li) => li.classList.contains("zwf-list-row"));
const row = (name: string) => rows().find((r) => r.querySelector(".zwf-list-head strong")?.textContent === name)!;
const openList = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("tab", { name: "List" }));

describe("the canvas", () => {
  test("draws every node, each a button named by its type and name", () => {
    render(<Harness />);
    const canvas = screen.getByRole("tab", { name: "Canvas" });
    expect(canvas).toHaveAttribute("aria-selected", "true");
    for (const n of sampleTree().nodes) {
      const name = n.name ?? (n.type === "start" ? "Start" : n.id);
      expect(document.querySelector(`.zwf-node[data-type="${n.type}"]`)).not.toBeNull();
      expect(screen.getAllByRole("button", { name: new RegExp(`: ${name}`) }).length).toBeGreaterThan(0);
    }
  });

  test("edge labels are buttons, and the default says so", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "standard · default" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "gold" })).toBeInTheDocument();
  });

  test("one node holds the tab stop; arrow down follows the way out", async () => {
    render(<Harness />);
    const nodes = [...document.querySelectorAll<HTMLElement>(".zwf-node")];
    expect(nodes.filter((n) => n.tabIndex === 0)).toHaveLength(1);
    const start = screen.getByRole("button", { name: "Start: Start" });
    expect(start.tabIndex).toBe(0);
    act(() => start.focus());
    fireEvent.keyDown(start, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Condition: Large request\?/ })));
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(within(screen.getByRole("complementary", { name: "Inspector" })).getByRole("heading", { name: "Large request?" })).toBeInTheDocument();
  });

  test("zoom works from buttons, not only the wheel", () => {
    render(<Harness />);
    for (const name of ["Zoom in", "Zoom out", "Fit"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  });
});

describe("the List tab", () => {
  test("shows every node, in compiled order, with arms indented", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openList(user);
    const ids = analyse(sampleTree()).order;
    expect(rows()).toHaveLength(sampleTree().nodes.length);
    expect(rows()[0]).toHaveTextContent("Start");
    const confirm = rows()[ids.indexOf("confirm")];
    expect(confirm).toHaveAttribute("data-depth", "1");
    expect(confirm).toHaveTextContent("arm tell of Prepare");
  });

  test("never shows a generated step as a node", async () => {
    const user = userEvent.setup();
    const drawn = decompile(analyse(sampleTree()).steps!);
    render(<Harness initial={drawn} />);
    await openList(user);
    for (const row of rows()) expect(row.textContent).not.toMatch(/--goto|--route/);
  });

  test("roving tab stop: one row is tabbable and the arrows move focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openList(user);
    expect(rows().filter((r) => r.tabIndex === 0)).toHaveLength(1);
    act(() => rows()[0].focus());
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rows()[1]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(rows().at(-1));
    await user.keyboard("{Enter}");
    expect(rows().at(-1)).toHaveAttribute("aria-current", "true");
  });

  test("connects two nodes by menu, without dragging", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    render(<Harness onGraph={onGraph} />);
    await openList(user);
    await user.click(row("Which tier?"));
    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    await user.selectOptions(within(inspector).getByRole("combobox", { name: "Connect to…" }), "refused");
    await user.click(within(inspector).getByRole("button", { name: "Connect" }));
    const g = onGraph.mock.calls.at(-1)![0] as Graph;
    expect(g.edges.at(-1)).toEqual({ from: "tier", to: "refused", label: "case-1" });
  });

  test("edits a way out's name", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    render(<Harness onGraph={onGraph} />);
    await openList(user);
    await user.click(row("Which tier?"));
    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    const name = within(inspector).getAllByRole("textbox", { name: "Branch name" }).find((i) => (i as HTMLInputElement).value === "gold")!;
    await user.clear(name);
    await user.type(name, "premium");
    const g = onGraph.mock.calls.at(-1)![0] as Graph;
    expect(g.edges.find((e) => e.from === "tier" && e.to === "high")?.label).toBe("premium");
  });

  test("a decision's default way out has no remove control", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openList(user);
    await user.click(row("Which tier?"));
    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    expect(within(inspector).getAllByRole("button", { name: "Remove connection" })).toHaveLength(1);
    expect(within(inspector).getByText("A default connection is required. Make another the default to change it.")).toBeInTheDocument();
  });

  test("making another way out the default moves the default", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    render(<Harness onGraph={onGraph} />);
    await openList(user);
    await user.click(row("Which tier?"));
    const radios = within(screen.getByRole("complementary", { name: "Inspector" })).getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).checked)).toEqual([false, true]);
    await user.click(radios[0]);
    const g = onGraph.mock.calls.at(-1)![0] as Graph;
    expect(g.edges.filter((e) => e.from === "tier" && e.default).map((e) => e.label)).toEqual(["gold"]);
  });
});

describe("the palette", () => {
  test("adds a node after the selected one", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    const start: Graph = { format: "workflow.graph/1", nodes: [{ id: "start", type: "start" }], edges: [] };
    render(<Harness initial={start} onGraph={onGraph} />);
    await openList(user);
    await user.click(rows()[0]);
    await user.click(screen.getByRole("button", { name: "Add email" }));
    const g = onGraph.mock.calls.at(-1)![0] as Graph;
    expect(g.nodes.map((n) => n.id)).toEqual(["start", "email"]);
    expect(g.edges).toEqual([{ from: "start", to: "email" }]);
  });

  test("a type the host cannot offer is greyed, with its reason in words", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    render(<Harness onGraph={onGraph} unavailable={{ webhook: "No address is allowed for this organisation yet." }} />);
    const item = screen.getByRole("button", { name: "Add webhook" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAccessibleDescription("No address is allowed for this organisation yet.");
    await user.click(item);
    expect(onGraph).not.toHaveBeenCalled();
  });
});

describe("read only", () => {
  test("offers no palette, no removals, and no edits", async () => {
    const user = userEvent.setup();
    render(<Harness readOnly />);
    expect(screen.queryByRole("navigation", { name: "Add a node" })).toBeNull();
    expect(screen.getByText("Read only")).toBeInTheDocument();
    await openList(user);
    await user.click(row("Which tier?"));
    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    expect(within(inspector).queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(within(inspector).queryByRole("button", { name: "Connect" })).toBeNull();
    expect(within(inspector).getByRole("textbox", { name: "Name" })).toHaveAttribute("readonly");
  });
});

describe("the Steps panel", () => {
  test("lists the compiled steps, generated ones marked and mapped to their node", async () => {
    const user = userEvent.setup();
    render(<Harness savedSteps={analyse(sampleTree()).steps!} />);
    await user.click(screen.getByRole("tab", { name: "Steps" }));
    const table = screen.getByRole("table", { name: "Compiled steps" });
    const route = within(table).getByText("approve--route").closest("tr")!;
    expect(route).toHaveAttribute("data-generated", "true");
    expect(within(route).getByText("(generated)")).toBeInTheDocument();
    expect(within(route).getByRole("button", { name: "Review" })).toBeInTheDocument();
    expect(screen.getByText("Compiles to the saved steps: saving changes only the drawing.")).toBeInTheDocument();
  });

  test("says the graph does not compile while it has problems", async () => {
    const user = userEvent.setup();
    const g = sampleTree();
    render(<Harness initial={{ ...g, edges: g.edges.filter((e) => !(e.from === "tier" && e.default)) }} />);
    expect(screen.getByRole("tab", { name: /Problems \(\d+\)/ })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Steps" }));
    expect(screen.getByText(/does not compile yet/)).toBeInTheDocument();
  });
});

describe("check and simulate", () => {
  test("the server's problems are shown on the node they name", async () => {
    const user = userEvent.setup();
    const api: WorkflowApi = { validate: vi.fn(async () => [{ code: "unknown_template", node: "confirm", message: "There is no template called confirmed." }]) };
    render(<Harness api={api} />);
    await user.click(screen.getByRole("button", { name: "Check with the server" }));
    expect(await screen.findByText("There is no template called confirmed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Email: Confirm, 1 problem/ })).toBeInTheDocument();
  });

  test("the path the server walked is exactly what is marked, and an answer at a stop runs it again", async () => {
    const user = userEvent.setup();
    const first: SimulateResult = {
      path: ["large", "approve"],
      steps: [
        { code: "large", node: "large", name: "Large request?", kind: "branch", at: "2026-01-01T00:00:00Z", says: "would go to approve" },
        { code: "approve", node: "approve", name: "Review", kind: "review", at: "2026-01-01T00:00:00Z", says: "would wait for Review" },
      ],
      recipients: [],
      stopped: { code: "approve", node: "approve", reason: "needs_decision", choices: ["approved", "rejected"], message: "Review waits for somebody" },
      ended: null,
      vars: {},
    };
    const second: SimulateResult = { ...first, path: ["large", "approve", "approve--route", "declined", "refused"], stopped: null, ended: { outcome: "declined", at: "2026-01-01T00:00:00Z" } };
    const simulate = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    render(<Harness api={{ simulate }} sample={{ subject: { type: "person", pid: "p-1" }, vars: { amount: 2000 } }} />);
    await user.click(screen.getByRole("tab", { name: "Simulate" }));
    await user.click(screen.getByRole("button", { name: "Simulate" }));
    expect(await screen.findByText(/Stopped at Review/)).toBeInTheDocument();
    expect(simulate.mock.calls[0][0]).toMatchObject({ subject: { type: "person", pid: "p-1" }, vars: { amount: 2000 }, decisions: {} });
    const marked = [...document.querySelectorAll('.zwf-node[data-on-path="true"]')].map((n) => n.getAttribute("data-type"));
    expect(marked.sort()).toEqual(["condition", "review", "start"]);

    await user.click(screen.getByRole("button", { name: "Answer: rejected" }));
    expect(await screen.findByText("Ended: declined")).toBeInTheDocument();
    expect(simulate.mock.calls[1][0].decisions).toEqual({ approve: "rejected" });
    const onPath = [...document.querySelectorAll('.zwf-node[data-on-path="true"]')].map((n) => n.getAttribute("aria-label")!.split(",")[0]);
    expect(onPath.sort()).toEqual(["Condition: Large request?", "Email: Say no", "End: Refused", "Review: Review", "Start: Start"]);
    // The answer stays, to be flipped.
    expect(screen.getByRole("combobox", { name: "Review" })).toHaveValue("rejected");
  });

  test("a simulation the server refuses shows its problems", async () => {
    const user = userEvent.setup();
    const simulate = vi.fn(async () => {
      throw Object.assign(new Error("the steps sent are not what this graph compiles to"), { problems: [{ code: "compile_mismatch", message: "step 2 differs" }] });
    });
    render(<Harness api={{ simulate }} />);
    await user.click(screen.getByRole("tab", { name: "Simulate" }));
    await user.click(screen.getByRole("button", { name: "Simulate" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("the steps sent are not what this graph compiles to");
    expect(alert).toHaveTextContent("step 2 differs");
  });

  test("with no simulate call, the panel says so instead of offering a button", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("tab", { name: "Simulate" }));
    expect(screen.getByText("Simulation is not available here.")).toBeInTheDocument();
  });
});
