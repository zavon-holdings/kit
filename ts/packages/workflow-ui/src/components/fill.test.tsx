// 1.18: the editor for a fitted screen. Fill mode and its dock, the start
// node said with the catalogue's labels, the host's toasts, Advanced, and a
// handle to select a node. jsdom has no layout, so the fit itself is proved
// in a browser by the host; these hold the structure and the behaviour.
import { readFileSync } from "node:fs";
import { createRef, useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sampleTree } from "../test/fixtures.js";
import { STARTERS } from "../starters.js";
import type { Graph, SimulateResult } from "../types.js";
import type { Trigger } from "../trigger.js";
import { WorkflowBuilder, type BuilderToast, type WorkflowBuilderHandle, type WorkflowBuilderProps } from "./WorkflowBuilder.js";

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

const editor = () => screen.getByRole("region", { name: "Workflow Editor" });
const inspector = () => screen.getByRole("complementary", { name: "Inspector" });
const rows = () => within(screen.getByRole("list", { name: "Workflow, as a list" })).getAllByRole("listitem").filter((li) => li.classList.contains("zwf-list-row"));
const row = (name: string) => rows().find((r) => r.querySelector(".zwf-list-head strong")?.textContent === name)!;
const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][0] as Graph;
const ended: SimulateResult = { path: ["start", "large"], steps: [], recipients: [], stopped: null, ended: { outcome: "completed", at: "2026-01-01T00:00:00Z" }, vars: {} };

describe("fill mode", () => {
  test("off, the editor lays out as before: no fill, the panels open, no dock toggle", () => {
    render(<Harness />);
    expect(editor()).not.toHaveAttribute("data-fill");
    expect(document.querySelector(".zwf-dock")).not.toHaveAttribute("hidden");
    expect(screen.queryByRole("button", { name: "Show Panels" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide Panels" })).toBeNull();
  });

  test("on, the dock starts closed; a tab opens it, the same tab or the toggle closes it", async () => {
    const user = userEvent.setup();
    render(<Harness fill />);
    expect(editor()).toHaveAttribute("data-fill", "true");
    const dock = document.querySelector(".zwf-dock")!;
    expect(dock).toHaveAttribute("hidden");
    const toggle = screen.getByRole("button", { name: "Show Panels" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("tab", { name: "Simulate" }));
    expect(dock).not.toHaveAttribute("hidden");
    expect(screen.getByRole("tab", { name: "Simulate" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Hide Panels" })).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("tab", { name: "Simulate" }));
    expect(dock).toHaveAttribute("hidden");

    await user.click(screen.getByRole("button", { name: "Show Panels" }));
    expect(dock).not.toHaveAttribute("hidden");
    await user.click(screen.getByRole("button", { name: "Hide Panels" }));
    expect(dock).toHaveAttribute("hidden");
  });

  test("closing the dock keeps every panel mounted: a simulation keeps its answer", async () => {
    const user = userEvent.setup();
    const simulate = vi.fn().mockResolvedValue(ended);
    render(<Harness fill api={{ simulate }} />);
    await user.click(screen.getByRole("tab", { name: "Simulate" }));
    await user.click(screen.getByRole("button", { name: "Simulate" }));
    expect(await screen.findByText("Ended: completed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide Panels" }));
    await user.click(screen.getByRole("button", { name: "Show Panels" }));
    expect(screen.getByText("Ended: completed")).toBeInTheDocument();
  });

  test("Check With the Server opens the dock on Problems", async () => {
    const user = userEvent.setup();
    const validate = vi.fn().mockResolvedValue([{ message: "The server says no." }]);
    render(<Harness fill api={{ validate }} />);
    await user.click(screen.getByRole("button", { name: "Check With the Server" }));
    expect(document.querySelector(".zwf-dock")).not.toHaveAttribute("hidden");
    expect(screen.getByRole("tab", { name: /^Problems/ })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("The server says no.")).toBeInTheDocument();
  });

  test("defaultDockOpen starts it open", () => {
    render(<Harness fill defaultDockOpen />);
    expect(document.querySelector(".zwf-dock")).not.toHaveAttribute("hidden");
  });

  test("the host's own panels are tabs beside the editor's", async () => {
    const user = userEvent.setup();
    render(<Harness fill extraPanels={[{ key: "versions", label: "Versions", content: <p>Version 3, saved today.</p> }]} />);
    await user.click(screen.getByRole("tab", { name: "Versions" }));
    expect(screen.getByRole("tabpanel", { name: "Versions" })).toHaveTextContent("Version 3, saved today.");
  });

  test("the List view carries the view on the editor, so it scrolls inside itself", async () => {
    const user = userEvent.setup();
    render(<Harness fill />);
    expect(editor()).toHaveAttribute("data-view", "canvas");
    await user.click(screen.getByRole("tab", { name: "List" }));
    expect(editor()).toHaveAttribute("data-view", "list");
  });
});

describe("the start node, said with the catalogue's labels", () => {
  const events = [{ type: "orders.order.placed", label: "An order is placed" }];
  const placed: Trigger = { kind: "event", event_type: "orders.order.placed" };

  test("an event the catalogue names is said by its label, on the node and in the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness defaultView="list" triggerValue={placed} onTriggerChange={() => {}} events={events} />);
    expect(row("Start")).toHaveTextContent("Starts when: An order is placed.");
    expect(row("Start")).not.toHaveTextContent("orders.order.placed");
    await user.click(row("Start"));
    expect(within(inspector()).getByRole("group", { name: "Trigger" })).toHaveTextContent("Starts when: An order is placed.");
  });

  test("eventLabel answers before the catalogue; read only it needs no catalogue", () => {
    render(<Harness readOnly defaultView="list" triggerValue={placed} eventLabel={(t) => (t === "orders.order.placed" ? "Order placed" : undefined)} />);
    expect(row("Start")).toHaveTextContent("Starts when: Order placed.");
  });

  test("an event the catalogue does not know is said by its type", () => {
    render(<Harness defaultView="list" triggerValue={{ kind: "event", event_type: "orders.order.lost" }} onTriggerChange={() => {}} events={events} />);
    expect(row("Start")).toHaveTextContent("Starts when orders.order.lost happens.");
  });

  test("the host's triggerSummary is shown as it is", () => {
    render(<Harness defaultView="list" triggerSummary="Starts when the host says." triggerValue={placed} events={events} />);
    expect(row("Start")).toHaveTextContent("Starts when the host says.");
  });
});

describe("toasts", () => {
  test("the editor's own Restore toast is drawn, and its rule puts it top right, never at the bottom", async () => {
    const user = userEvent.setup();
    render(<Harness defaultView="list" />);
    await user.click(row("Mark high"));
    await user.click(within(inspector()).getByRole("button", { name: "Remove Mark high" }));
    expect(document.querySelector(".zwf-toast")).toHaveTextContent("Removed Mark high.");
    const css = readFileSync("src/styles.css", "utf8");
    const rule = /\.zwf-toast \{([^}]*)\}/.exec(css)![1];
    expect(rule).toMatch(/top: 20px/);
    expect(rule).toMatch(/right: 20px/);
    expect(rule).not.toMatch(/bottom:/);
  });

  test("a host that shows toasts is handed one, and its Restore restores", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    const onToast = vi.fn<(t: BuilderToast) => void>();
    render(<Harness defaultView="list" onGraph={onGraph} onToast={onToast} />);
    await user.click(row("Mark high"));
    await user.click(within(inspector()).getByRole("button", { name: "Remove Mark high" }));
    expect(document.querySelector(".zwf-toast")).toBeNull();
    expect(onToast).toHaveBeenCalledTimes(1);
    const toast = onToast.mock.calls[0][0];
    expect(toast).toMatchObject({ kind: "removed", message: "Removed Mark high.", action: { label: "Restore" }, durationMs: 8000 });
    act(() => toast.action.run());
    expect(last(onGraph).nodes.some((n) => n.id === "high")).toBe(true);
  });

  test("the host is told to take the toast down once Restore can no longer apply", async () => {
    const user = userEvent.setup();
    const dismiss = vi.fn();
    render(<Harness defaultView="list" onToast={() => dismiss} />);
    await user.click(row("Mark high"));
    await user.click(within(inspector()).getByRole("button", { name: "Remove Mark high" }));
    expect(dismiss).not.toHaveBeenCalled();
    await user.click(row("Mark normal"));
    await user.click(within(inspector()).getByRole("button", { name: "Copy" }));
    await user.click(screen.getByRole("button", { name: "Tidy the Layout" }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});

describe("Advanced", () => {
  test("off by default: no Steps tab, no JSON in the sample; the values the graph reads are a form", async () => {
    const user = userEvent.setup();
    const simulate = vi.fn().mockResolvedValue(ended);
    render(<Harness api={{ simulate }} />);
    expect(screen.queryByRole("tab", { name: "Steps" })).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Simulate" }));
    expect(screen.queryByRole("textbox", { name: "Vars (JSON)" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Subject Type" })).toBeNull();
    const values = screen.getByRole("group", { name: "Values" });
    fireEvent.change(within(values).getByRole("textbox", { name: "amount" }), { target: { value: "5000" } });
    fireEvent.change(within(values).getByRole("textbox", { name: "tier" }), { target: { value: "gold" } });
    await user.click(screen.getByRole("button", { name: "Simulate" }));
    expect(simulate.mock.calls[0][0].vars).toEqual({ amount: 5000, tier: "gold" });
  });

  test("a node with no form says where its settings are instead of showing JSON", async () => {
    const user = userEvent.setup();
    render(<Harness defaultView="list" />);
    await user.click(row("Mark high"));
    expect(within(inspector()).queryByRole("textbox", { name: "Settings (JSON)" })).toBeNull();
    expect(within(inspector()).getByText(/Turn on Advanced in the View menu/)).toBeInTheDocument();
  });

  test("the View menu turns it on, and the host hears", async () => {
    const user = userEvent.setup();
    const onAdvancedChange = vi.fn();
    render(<Harness defaultView="list" onAdvancedChange={onAdvancedChange} />);
    await user.click(screen.getByText("View", { selector: "summary" }));
    await user.click(screen.getByRole("checkbox", { name: "Advanced" }));
    expect(onAdvancedChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("tab", { name: "Steps" })).toBeInTheDocument();
    await user.click(row("Mark high"));
    expect(within(inspector()).getByRole("textbox", { name: "Settings (JSON)" })).toBeInTheDocument();
  });

  test("defaultAdvanced starts with everything shown", () => {
    render(<Harness defaultAdvanced />);
    expect(screen.getByRole("tab", { name: "Steps" })).toBeInTheDocument();
  });
});

describe("the host's handle", () => {
  test("select opens a node by id, in the List and on the canvas; an unknown id is false", async () => {
    const user = userEvent.setup();
    const handle = createRef<WorkflowBuilderHandle>();
    render(<Harness handleRef={handle} defaultView="list" />);
    let ok = false;
    act(() => {
      ok = handle.current!.select("approve");
    });
    expect(ok).toBe(true);
    expect(within(inspector()).getByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(row("Review")).toHaveAttribute("data-selected", "true");
    expect(handle.current!.select("nowhere")).toBe(false);

    await user.click(screen.getByRole("tab", { name: "Canvas" }));
    act(() => {
      handle.current!.select("tier");
    });
    expect(within(inspector()).getByRole("heading", { name: "Which tier?" })).toBeInTheDocument();
    act(() => handle.current!.clearSelection());
    expect(within(inspector()).queryByRole("heading", { name: "Which tier?" })).toBeNull();
  });

  test("works read only", () => {
    const handle = createRef<WorkflowBuilderHandle>();
    render(<Harness readOnly handleRef={handle} defaultView="list" />);
    act(() => {
      handle.current!.select("approve");
    });
    expect(within(inspector()).getByRole("heading", { name: "Review" })).toBeInTheDocument();
  });
});

describe("starters", () => {
  test("are named in Title Case; their codes do not move", () => {
    expect(STARTERS.map((s) => [s.code, s.name])).toEqual([
      ["blank", "Blank"],
      ["review-and-route", "One Person Decides"],
      ["route-by-value", "Route by a Value"],
      ["wait-or-chase", "Wait, Then Chase"],
      ["do-both", "Two Things at Once"],
    ]);
  });
});
