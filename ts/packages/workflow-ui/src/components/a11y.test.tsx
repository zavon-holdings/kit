// Axe over every state of the editor a person can reach: the canvas, the
// List twin, a node open in the inspector, several nodes selected, each
// panel, the shortcuts sheet, the trigger on the start node, and a version
// comparison. jsdom has no layout, so contrast is left to a browser run;
// everything else axe checks (names, roles, labels, ARIA, landmarks) is here.
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { sampleTree } from "../test/fixtures.js";
import type { Graph, WorkflowApi } from "../types.js";
import type { Trigger } from "../trigger.js";
import { WorkflowBuilder } from "./WorkflowBuilder.js";
import { VersionDiff } from "./VersionDiff.js";

async function violations(): Promise<string[]> {
  const out = await axe.run(document.body, {
    rules: {
      "color-contrast": { enabled: false },
      // The page around the editor is the host's.
      region: { enabled: false },
      "page-has-heading-one": { enabled: false },
      "landmark-one-main": { enabled: false },
    },
  });
  return out.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
}

const api: WorkflowApi = {
  validate: vi.fn(async () => []),
  simulate: vi.fn(async () => ({ path: ["large"], steps: [{ code: "large", node: "large", name: "Large request?", kind: "branch", at: "2026-01-01T00:00:00Z", says: "would go to prepare" }], recipients: [], stopped: null, ended: { outcome: "completed", at: "2026-01-01T00:00:00Z" }, vars: {} })),
  previewAssignees: vi.fn(async () => ({ assignees: [{ email: "a@example.org", name: "Ada" }], unassignable: false, says: "From the role." })),
  listScenarios: vi.fn(async () => [{ name: "Gold", sample: { subject: { type: "person", pid: "p" }, vars: {} }, decisions: {}, expect: { outcome: "completed" } }]),
  saveScenario: vi.fn(async () => {}),
  deleteScenario: vi.fn(async () => {}),
};

function Harness({ readOnly = false }: { readOnly?: boolean }) {
  const [graph, setGraph] = useState<Graph>(sampleTree());
  const [trigger, setTrigger] = useState<Trigger>({ kind: "event", event_type: "orders.order.placed" });
  return (
    <WorkflowBuilder
      graph={graph}
      onChange={readOnly ? undefined : setGraph}
      api={api}
      triggerValue={trigger}
      onTriggerChange={setTrigger}
      interrupts={[{ event: "orders.order.cancelled", goto: "refused" }]}
      onInterruptsChange={() => {}}
      events={[{ type: "orders.order.placed", label: "An order is placed", vars: ["total_cents"] }]}
    />
  );
}

const inspector = () => screen.getByRole("complementary", { name: "Inspector" });

describe("axe finds nothing", () => {
  test("on the canvas, with nothing selected", async () => {
    render(<Harness />);
    expect(await violations()).toEqual([]);
  });

  test("on the List tab with a node open, and with several selected", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("tab", { name: "List" }));
    const rows = within(screen.getByRole("list", { name: "Workflow, as a list" })).getAllByRole("listitem").filter((li) => li.classList.contains("zwf-list-row"));
    await user.click(rows.find((r) => r.querySelector(".zwf-list-head strong")?.textContent === "Review")!);
    await user.click(within(inspector()).getByRole("button", { name: /Who would this go to/ }));
    await within(inspector()).findByText(/Ada/);
    expect(await violations()).toEqual([]);
    await user.keyboard("{Shift>}");
    await user.click(rows[3]);
    await user.keyboard("{/Shift}");
    expect(within(inspector()).getByRole("heading", { name: /nodes$/ })).toBeInTheDocument();
    expect(await violations()).toEqual([]);
  });

  test("with the trigger and interrupts open on the start node", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("tab", { name: "List" }));
    const start = within(screen.getByRole("list", { name: "Workflow, as a list" })).getAllByRole("listitem")[0];
    await user.click(start);
    expect(within(inspector()).getByRole("group", { name: "Trigger" })).toBeInTheDocument();
    expect(await violations()).toEqual([]);
  });

  test("in each panel, and the shortcuts sheet", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("tab", { name: "Steps" }));
    expect(await violations()).toEqual([]);
    await user.click(screen.getByRole("tab", { name: "Simulate" }));
    await user.click(screen.getByRole("button", { name: "Add another sample" }));
    await user.click(screen.getByRole("button", { name: "Simulate all 2 samples" }));
    await screen.findAllByText("Ended: completed");
    expect(await violations()).toEqual([]);
    await user.click(screen.getByRole("tab", { name: "Scenarios" }));
    await screen.findByText("Gold");
    expect(await violations()).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(await violations()).toEqual([]);
  });

  test("read only, and comparing two versions", async () => {
    const { unmount } = render(<Harness readOnly />);
    expect(await violations()).toEqual([]);
    unmount();
    const after = structuredClone(sampleTree());
    after.nodes.find((n) => n.id === "confirm")!.config = { template_code: "other" };
    render(<VersionDiff before={{ label: "Version 1", graph: sampleTree() }} after={{ label: "Version 2", graph: after }} />);
    expect(await violations()).toEqual([]);
  });
});

describe("the check itself", () => {
  test("axe is really looking: an unnamed button is a violation", async () => {
    render(
      <div>
        <button type="button" />
        <input type="text" />
      </div>,
    );
    const found = await violations();
    expect(found.some((v) => v.startsWith("button-name"))).toBe(true);
    expect(found.some((v) => v.startsWith("label"))).toBe(true);
  });
});
