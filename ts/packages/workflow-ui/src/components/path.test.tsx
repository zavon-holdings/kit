import { useState } from "react";
import { describe, expect, test } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addNode, connect, emptyGraph, outEdges } from "../model.js";
import type { Graph } from "../types.js";
import { WorkflowBuilder } from "./WorkflowBuilder.js";

/** start → Welcome (email) → Pause (delay) → Follow up (email) → Done. */
function straightRun(): Graph {
  let g: Graph = { ...emptyGraph(), edges: [] };
  let from = "start";
  for (const [id, type, name] of [
    ["welcome", "email", "Welcome"],
    ["pause", "delay", "Pause"],
    ["follow-up", "email", "Follow up"],
  ] as const) {
    const out = addNode(g, type, { id, from, name });
    g = out.graph;
    from = out.id;
  }
  return connect(g, from, "done").graph;
}

function Harness({ initial, readOnly }: { initial: Graph; readOnly?: boolean }) {
  const [graph, setGraph] = useState(initial);
  return (
    <>
      <WorkflowBuilder graph={graph} onChange={readOnly ? undefined : setGraph} readOnly={readOnly} />
      <output data-testid="order">{order(graph).join(" > ")}</output>
    </>
  );
}

const order = (g: Graph) => {
  const out: string[] = [];
  let at = "start";
  while (at && out.length < 20) {
    out.push(at);
    at = outEdges(g, at)[0]?.edge.to ?? "";
  }
  return out;
};

const list = () => screen.getByRole("list", { name: "Workflow, as a list" });
const shown = () => screen.getByTestId("order").textContent;

describe("the List tab as a numbered path", () => {
  test("each step is numbered, with its kind and one line of what it does", async () => {
    const user = userEvent.setup();
    render(<Harness initial={straightRun()} />);
    await user.click(screen.getByRole("tab", { name: "List" }));
    const pause = within(list()).getByText("Pause").closest("li")!;
    expect(pause.querySelector(".zwf-path-num")?.textContent).toBe("03");
    expect(pause.querySelector(".zwf-path-line")?.textContent).toBe("Delay · Wait 1 day");
    // A plain next to the step below is the path itself, not a connection to list.
    expect(within(list()).queryByRole("list", { name: "Connections from Pause" })).toBeNull();
  });

  test("a step moves earlier and later by its buttons, which keep their names", async () => {
    const user = userEvent.setup();
    render(<Harness initial={straightRun()} />);
    await user.click(screen.getByRole("tab", { name: "List" }));
    await user.click(within(list()).getByRole("button", { name: "Move Pause later" }));
    expect(shown()).toBe("start > welcome > follow-up > pause > done");
    await user.click(within(list()).getByRole("button", { name: "Move Pause earlier" }));
    expect(shown()).toBe("start > welcome > pause > follow-up > done");
    // The first cannot go before the start.
    expect(within(list()).getByRole("button", { name: "Move Welcome earlier" })).toBeDisabled();
  });

  test("a + between two steps adds the chosen kind exactly there, and opens it", async () => {
    const user = userEvent.setup();
    render(<Harness initial={straightRun()} />);
    await user.click(screen.getByRole("tab", { name: "List" }));
    await user.click(within(list()).getByRole("button", { name: "Add a step between Welcome and Pause" }));
    const menu = within(list()).getByRole("group", { name: "Add a step" });
    await user.click(within(menu).getByRole("button", { name: /^Webhook/ }));
    expect(shown()).toBe("start > welcome > webhook > pause > follow-up > done");
    expect(within(screen.getByRole("complementary", { name: "Inspector" })).getByRole("textbox", { name: "Name" })).toHaveAttribute("placeholder", "webhook");
  });

  test("Add a step at the end puts the step last, before the end", async () => {
    const user = userEvent.setup();
    render(<Harness initial={straightRun()} />);
    await user.click(screen.getByRole("tab", { name: "List" }));
    await user.click(screen.getByRole("button", { name: "Add a step" }));
    await user.click(within(screen.getByRole("group", { name: "Add a step" })).getByRole("button", { name: /^Delay/ }));
    expect(shown()).toBe("start > welcome > pause > follow-up > delay > done");
  });

  test("Escape closes the menu and puts focus back on its button", async () => {
    const user = userEvent.setup();
    render(<Harness initial={straightRun()} />);
    await user.click(screen.getByRole("tab", { name: "List" }));
    const add = screen.getByRole("button", { name: "Add a step" });
    await user.click(add);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Add a step" })).toBeNull();
    expect(add).toHaveFocus();
  });

  test("read only: no moving, no adding", async () => {
    const user = userEvent.setup();
    render(<Harness initial={straightRun()} readOnly />);
    await user.click(screen.getByRole("tab", { name: "List" }));
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Add a step/ })).toBeNull();
  });
});

describe("the step's settings", () => {
  test("the name is the heading; the code is under Advanced", async () => {
    const user = userEvent.setup();
    render(<Harness initial={straightRun()} />);
    await user.click(screen.getByRole("tab", { name: "List" }));
    await user.click(within(list()).getByText("Pause"));
    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    expect(within(inspector).getByRole("heading", { name: "Pause" })).toBeInTheDocument();
    expect(within(inspector).getByRole("textbox", { name: "Name" })).toHaveValue("Pause");
    const id = within(inspector).getByRole("textbox", { name: "Id (the step's code)" });
    expect(id.closest("details")?.querySelector("summary")?.textContent).toBe("Advanced");
  });
});
