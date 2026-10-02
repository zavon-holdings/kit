import { useState } from "react";
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { NODE_KINDS, edgeRole, kindOf } from "../catalogue.js";
import { ASKS_PEOPLE } from "./AssigneePreview.js";
import { BUILT_IN_INSPECTORS, TodoInspector } from "./inspectors.js";
import type { GraphNode } from "../types.js";

// The to-do node: an assignable piece of work, one way on, in the People
// group; its inspector writes the title, the people it names, when it is due
// and when they are reminded — and leaves alone any source of people it does
// not edit (a role, a permission), which the host's own inspector owns.

async function violations(): Promise<string[]> {
  const out = await axe.run(document.body, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false }, "page-has-heading-one": { enabled: false }, "landmark-one-main": { enabled: false } },
  });
  return out.violations.map((v) => `${v.id}: ${v.help}`);
}

function Harness({ initial, onConfig }: { initial: Record<string, unknown>; onConfig: (c: Record<string, unknown>) => void }) {
  const [config, setConfig] = useState(initial);
  const node: GraphNode = { id: "book", type: "todo", config };
  return (
    <TodoInspector
      node={node}
      readOnly={false}
      onChange={(c) => {
        setConfig(c);
        onConfig(c);
      }}
    />
  );
}

describe("the to-do node", () => {
  test("is offered under People, as one way on, and asks people", () => {
    const k = NODE_KINDS.find((n) => n.type === "todo");
    expect(k?.group).toBe("People");
    expect(kindOf("todo").label).toBe("To-do");
    expect(edgeRole("todo", 1)).toBe("sequence");
    expect(edgeRole("todo", 2, true)).toBe("sequence");
    expect(ASKS_PEOPLE.has("todo")).toBe(true);
    expect(BUILT_IN_INSPECTORS.todo).toBe(TodoInspector);
  });

  test("its inspector writes the title, the people, the due date and the reminders", async () => {
    const user = userEvent.setup();
    let last: Record<string, unknown> = {};
    const role = { role: { app: "pages", code: "events_lead" } };
    render(<Harness initial={{ assignees: [role] }} onConfig={(c) => (last = c)} />);
    await user.type(screen.getByLabelText("What is to be done"), "Book the hall");
    await user.type(screen.getByLabelText("People it is for (one email address a line)"), "ana@example.test{enter}ben@example.test");
    await user.clear(screen.getByLabelText("Due in"));
    await user.type(screen.getByLabelText("Due in"), "3");
    await user.selectOptions(screen.getByLabelText("Due in: unit"), "business_days");
    await user.click(screen.getByRole("button", { name: "Add a reminder" }));
    expect(last.title).toBe("Book the hall");
    expect(last.assignees).toEqual([role, { people: [{ email: "ana@example.test" }, { email: "ben@example.test" }] }]);
    expect(last.due).toEqual({ value: 3, unit: "business_days" });
    expect(last.reminders).toEqual([{ after: { value: 1, unit: "business_days" } }]);
    expect(screen.getByText(/1 other source of people/)).toBeTruthy();
    expect(await violations()).toEqual([]);
  });

  test("clearing the people removes the source, never an empty one", async () => {
    const user = userEvent.setup();
    let last: Record<string, unknown> = {};
    render(<Harness initial={{ assignees: [{ people: [{ email: "ana@example.test" }] }] }} onConfig={(c) => (last = c)} />);
    await user.clear(screen.getByLabelText("People it is for (one email address a line)"));
    expect(last.assignees).toEqual([]);
  });
});
