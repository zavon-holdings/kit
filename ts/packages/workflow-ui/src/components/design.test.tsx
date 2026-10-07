// The editor's look, rendered: node categories and outcome badges, edge
// tones, the palette's search, the empty canvas, the toolbar's names, and
// the confirmation card for consequential actions.
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { sampleTree } from "../test/fixtures.js";
import type { Graph } from "../types.js";
import { WorkflowBuilder, type WorkflowBuilderProps } from "./WorkflowBuilder.js";
import { ConfirmDialog } from "./ConfirmDialog.js";

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

const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][0] as Graph;
const inspector = () => screen.getByRole("complementary", { name: "Inspector" });
const rows = () => within(screen.getByRole("list", { name: "Workflow, as a list" })).getAllByRole("listitem").filter((li) => li.classList.contains("zwf-list-row"));
const row = (name: string) => rows().find((r) => r.querySelector(".zwf-list-head strong")?.textContent === name)!;

async function violations(): Promise<string[]> {
  const out = await axe.run(document.body, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false }, "page-has-heading-one": { enabled: false }, "landmark-one-main": { enabled: false } },
  });
  return out.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
}

const everyCategory: Graph = {
  format: "workflow.graph/1",
  nodes: [
    { id: "start", type: "start" },
    { id: "check", name: "Check", type: "condition", config: { when: { field: "vars.n", op: "gte", value: 1 } } },
    { id: "sign", name: "Sign-off", type: "approval", config: { assignees: [{ people: [{ email: "a@example.org" }] }], mode: "any" } },
    { id: "mail", name: "Tell them", type: "email", config: { template_code: "t" } },
    { id: "pay", name: "Deposit", type: "payment_request", config: { action: "x.pay", amount: 5000, currency: "ZAR", expires: { value: 3, unit: "days" } } },
    { id: "wait", name: "Answer", type: "wait_event", config: { event: ["x.answered"], timeout: { value: 2, unit: "days" } } },
    { id: "ship", name: "Ship", type: "call", config: { action: "x.ship" } },
    { id: "done", name: "Done", type: "end", config: { outcome: "completed" } },
    { id: "no", name: "Refused", type: "end", config: { outcome: "rejected" } },
    { id: "late", name: "Lapsed", type: "end", config: { outcome: "expired" } },
    { id: "odd", name: "Archived", type: "end", config: { outcome: "archived" } },
  ],
  edges: [
    { from: "start", to: "check" },
    { from: "check", to: "sign", label: "yes" },
    { from: "check", to: "odd", label: "no", default: true },
    { from: "sign", to: "mail", label: "approved" },
    { from: "sign", to: "no", label: "rejected", default: true },
    { from: "mail", to: "pay" },
    { from: "pay", to: "wait", label: "paid" },
    { from: "pay", to: "no", label: "failed" },
    { from: "pay", to: "late", label: "expired", default: true },
    { from: "wait", to: "ship" },
    { from: "wait", to: "late", label: "timeout" },
    { from: "ship", to: "done" },
  ],
};

describe("node cards", () => {
  test("each card carries its category, an icon chip and a one-line summary", () => {
    render(<Harness initial={everyCategory} />);
    const card = (id: string) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"] .zwf-node`)!;
    expect(card("check").dataset.category).toBe("logic");
    expect(card("sign").dataset.category).toBe("people");
    expect(card("mail").dataset.category).toBe("messages");
    expect(card("pay").dataset.category).toBe("money");
    expect(card("wait").dataset.category).toBe("timing");
    expect(card("ship").dataset.category).toBe("apps");
    expect(card("start").dataset.category).toBe("structure");
    for (const id of ["check", "sign", "mail", "pay", "wait", "ship"]) expect(card(id).querySelector(".zwf-node-chip svg")).not.toBeNull();
    expect(card("pay").querySelector(".zwf-node-meta")!.textContent).toBe("Payment request · ZAR 50 · expires in 3 days");
    expect(card("sign").querySelector(".zwf-node-meta")!.textContent).toBe("Approval · a@example.org");
    // The chip is decoration: the card's name stays what it was.
    expect(screen.getByRole("button", { name: "Payment request: Deposit" })).toBe(card("pay"));
  });

  test("an end is an outcome badge, toned by what the outcome means, in words as well", () => {
    render(<Harness initial={everyCategory} />);
    const end = (id: string) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"] .zwf-node`)!;
    expect(end("done").dataset.tone).toBe("ok");
    expect(end("no").dataset.tone).toBe("danger");
    expect(end("late").dataset.tone).toBe("warn");
    expect(end("odd").dataset.tone).toBe("neutral");
    expect(end("no").querySelector(".zwf-node-outcome")!.textContent).toBe("rejected");
  });

  test("a problem is a chip on the card, with its count in words", () => {
    const g = sampleTree();
    g.edges = g.edges.filter((e) => e.from !== "high");
    render(<Harness initial={g} />);
    const card = document.querySelector<HTMLElement>('.react-flow__node[data-id="high"] .zwf-node')!;
    expect(card.dataset.problems).toBeTruthy();
    expect(within(card).getByText(/problem/)).toHaveClass("zwf-badge");
  });
});

describe("edges", () => {
  test("labels and lines are toned by meaning: approved and yes ok, rejected and no danger, timeout and expired warn", () => {
    render(<Harness initial={everyCategory} />);
    const label = (words: string) => screen.getByRole("button", { name: words });
    expect(label("approved")).toHaveAttribute("data-tone", "ok");
    expect(label("yes")).toHaveAttribute("data-tone", "ok");
    expect(label("paid")).toHaveAttribute("data-tone", "ok");
    expect(label("rejected · default")).toHaveAttribute("data-tone", "danger");
    expect(label("no · default")).toHaveAttribute("data-tone", "danger");
    expect(label("failed")).toHaveAttribute("data-tone", "danger");
    expect(label("timeout")).toHaveAttribute("data-tone", "warn");
    expect(label("expired · default")).toHaveAttribute("data-tone", "warn");
    for (const tone of ["ok", "danger", "warn"]) expect(document.querySelector(`.react-flow__edge path.zwf-edge-tone-${tone}`)).not.toBeNull();
    // An unlabelled way on is neutral and draws no label.
    expect(document.querySelectorAll(".react-flow__edge path.zwf-edge-tone-neutral").length).toBeGreaterThan(0);
  });

  test("a plain label stays neutral", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "gold" })).toHaveAttribute("data-tone", "neutral");
  });
});

describe("the palette", () => {
  test("cards keep their names, describe themselves, and can be dragged", () => {
    render(<Harness />);
    const nav = screen.getByRole("navigation", { name: "Add a node" });
    const delay = within(nav).getByRole("button", { name: "Add delay" });
    expect(delay).toHaveAccessibleDescription("Pauses for a set time.");
    expect(delay).toHaveAttribute("draggable", "true");
  });

  test("search narrows the cards, and says when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const nav = screen.getByRole("navigation", { name: "Add a node" });
    await user.type(within(nav).getByRole("searchbox", { name: "Search steps" }), "pay");
    expect(within(nav).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Add payment request"]);
    await user.clear(within(nav).getByRole("searchbox", { name: "Search steps" }));
    await user.type(within(nav).getByRole("searchbox", { name: "Search steps" }), "zzz");
    expect(within(nav).getByRole("status")).toHaveTextContent("No step matches");
  });

  test("a card dropped on the canvas adds that node", () => {
    const onGraph = vi.fn();
    render(<Harness onGraph={onGraph} />);
    const canvas = document.querySelector(".zwf-canvas")!;
    const data = new Map<string, string>([["application/x-zwf-node-type", "delay"]]);
    const dataTransfer = { types: [...data.keys()], getData: (k: string) => data.get(k) ?? "", setData: () => {}, dropEffect: "" };
    fireEvent.dragOver(canvas, { dataTransfer });
    fireEvent.drop(canvas, { dataTransfer, clientX: 200, clientY: 200 });
    expect(last(onGraph).nodes.filter((n) => n.type === "delay")).toHaveLength(2);
  });
});

describe("the empty canvas", () => {
  test("offers the first step, and adds it after the start", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    render(<Harness onGraph={onGraph} initial={{ format: "workflow.graph/1", nodes: [{ id: "start", type: "start" }], edges: [] }} />);
    const empty = screen.getByRole("group", { name: "Add your first step" });
    await user.click(within(empty).getByRole("button", { name: "Start with a condition" }));
    const g = last(onGraph);
    expect(g.nodes.map((n) => n.type)).toEqual(["start", "condition"]);
    expect(g.edges).toEqual([expect.objectContaining({ from: "start", to: g.nodes[1].id })]);
    expect(screen.queryByRole("group", { name: "Add your first step" })).toBeNull();
  });

  test("is not offered read only", () => {
    render(<Harness readOnly initial={{ format: "workflow.graph/1", nodes: [{ id: "start", type: "start" }], edges: [] }} />);
    expect(screen.queryByRole("group", { name: "Add your first step" })).toBeNull();
  });
});

describe("the toolbar and the canvas controls", () => {
  test("icon buttons are named, with the name as a tooltip", () => {
    render(<Harness />);
    for (const name of ["Undo", "Redo", "Tidy the layout", "Add a note", "Keyboard shortcuts", "Zoom in", "Zoom out", "Fit"]) {
      const b = screen.getByRole("button", { name });
      expect(b.getAttribute("data-tip")).toBeTruthy();
    }
  });

  test("the overview map is a toggle beside the zoom", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const toggle = screen.getByRole("button", { name: "Show the overview map" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".react-flow__minimap")).not.toBeNull();
  });

  test("read only: the same drawing, no edit chrome", () => {
    render(<Harness readOnly />);
    expect(screen.queryByRole("navigation", { name: "Add a node" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tidy the layout" })).toBeNull();
    expect(screen.getByRole("button", { name: "Fit" })).toBeInTheDocument();
    expect(document.querySelector('.zwf-node[data-category="logic"]')).not.toBeNull();
  });
});

describe("removing, with a way back", () => {
  test("a single removal happens at once and offers Restore", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    render(<Harness onGraph={onGraph} defaultView="list" />);
    await user.click(row("Mark high"));
    await user.click(within(inspector()).getByRole("button", { name: "Remove Mark high" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(last(onGraph).nodes.some((n) => n.id === "high")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(last(onGraph).nodes.some((n) => n.id === "high")).toBe(true);
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });

  test("removing a step with everything after it asks first, naming what goes", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    render(<Harness onGraph={onGraph} defaultView="list" />);
    await user.click(row("Which tier?"));
    await user.click(within(inspector()).getByRole("button", { name: "Remove it and everything after it (4 steps)" }));
    const dialog = screen.getByRole("alertdialog", { name: "Remove 4 steps?" });
    expect(dialog).toHaveTextContent("Which tier?, Mark high, Mark normal, Done");
    expect(onGraph).not.toHaveBeenCalled();
    // The safe choice has focus; Escape keeps everything.
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onGraph).not.toHaveBeenCalled();
    await user.click(within(inspector()).getByRole("button", { name: "Remove it and everything after it (4 steps)" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove 4 steps" }));
    expect(last(onGraph).nodes.map((n) => n.id)).not.toEqual(expect.arrayContaining(["tier"]));
    expect(last(onGraph).nodes.some((n) => ["tier", "high", "normal", "done"].includes(n.id))).toBe(false);
    expect(last(onGraph).nodes.some((n) => n.id === "both")).toBe(true);
  });

  test("a host can ask for every removal to be confirmed", async () => {
    const user = userEvent.setup();
    const onGraph = vi.fn();
    render(<Harness onGraph={onGraph} defaultView="list" confirmRemovals />);
    await user.click(row("Mark high"));
    await user.click(within(inspector()).getByRole("button", { name: "Remove Mark high" }));
    const dialog = screen.getByRole("alertdialog", { name: "Remove Mark high?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onGraph).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // Delete with the node still selected asks too.
    fireEvent.keyDown(row("Mark high"), { key: "Delete" });
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove step" }));
    expect(last(onGraph).nodes.some((n) => n.id === "high")).toBe(false);
  });

  test("axe finds nothing with the confirmation card open", async () => {
    const user = userEvent.setup();
    render(<Harness defaultView="list" />);
    await user.click(row("Which tier?"));
    await user.click(within(inspector()).getByRole("button", { name: /Remove it and everything after it/ }));
    expect(await violations()).toEqual([]);
  });
});

describe("ConfirmDialog", () => {
  test("a modal alertdialog: named, described, focus kept inside, Escape cancels", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <>
        <button type="button">Before</button>
        <ConfirmDialog title="Publish version 3?" description="Runs that start from now use it." impact={["2 steps changed", "1 step added"]} confirmLabel="Publish" tone="primary" onConfirm={onConfirm} onCancel={onCancel} />
      </>,
    );
    const dialog = screen.getByRole("alertdialog", { name: "Publish version 3?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(/Runs that start from now use it\.\s*2 steps changed\s*1 step added/);
    // Go-live puts focus on the primary choice; Tab stays inside.
    const publish = within(dialog).getByRole("button", { name: "Publish" });
    expect(publish).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(publish).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("a click on the backdrop cancels; one inside does not", async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Discard changes?" confirmLabel="Discard changes" onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.mouseDown(screen.getByRole("alertdialog"));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.querySelector(".zwf-confirm-backdrop")!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("Restore goes once anything else changes", async () => {
    const user = userEvent.setup();
    render(<Harness defaultView="list" />);
    await user.click(row("Mark high"));
    await user.click(within(inspector()).getByRole("button", { name: "Remove Mark high" }));
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(rows()[0], { key: "z", ctrlKey: true });
    });
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });
});
