import { useState } from "react";
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { catalogueFromGraph, itemFieldsOf, keyFor, requiredOf, withRequirements, type RequirementField } from "../requirements.js";
import { StepRequirements } from "./StepRequirements.js";
import type { Graph, GraphNode } from "../types.js";

// "Required to move on": a review step names fields that must be filled before
// an item leaves it forward. Chips from the catalogue, a field made in place,
// and the rule said in one sentence.

async function violations(): Promise<string[]> {
  const out = await axe.run(document.body, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false }, "page-has-heading-one": { enabled: false }, "landmark-one-main": { enabled: false } },
  });
  return out.violations.map((v) => `${v.id}: ${v.help}`);
}

const host: RequirementField[] = [
  { key: "score", label: "Score", type: "number", source: "Record" },
  { key: "reviewer", label: "Reviewer", type: "email", source: "Record" },
];

function Harness({ initial, onConfig }: { initial: Record<string, unknown>; onConfig?: (c: Record<string, unknown>) => void }) {
  const [config, setConfig] = useState(initial);
  const node: GraphNode = { id: "review", name: "Review", type: "review", config };
  const g: Graph = { format: "workflow.graph/1", nodes: [node], edges: [] } as Graph;
  return (
    <StepRequirements
      stageName="Review"
      required={requiredOf(node)}
      itemFields={itemFieldsOf(node)}
      catalogue={catalogueFromGraph(g, host)}
      onChange={({ required, itemFields }) => {
        const next = withRequirements(config, required, itemFields);
        setConfig(next);
        onConfig?.(next);
      }}
    />
  );
}

describe("step requirements", () => {
  test("says the rule in one sentence, with labels", async () => {
    render(<Harness initial={{ required_fields: ["score", "reviewer"] }} />);
    expect(screen.getByText("Items can't leave Review until Score and Reviewer are filled.")).toBeInTheDocument();
    expect(await violations()).toEqual([]);
  });

  test("with nothing required, says items can leave at any time", () => {
    render(<Harness initial={{}} />);
    expect(screen.getByText("Items can leave this step at any time.")).toBeInTheDocument();
  });

  test("a chip is picked from the catalogue and removed again", async () => {
    const user = userEvent.setup();
    let last: Record<string, unknown> = {};
    render(<Harness initial={{ outcomes: [{ name: "approved" }] }} onConfig={(c) => (last = c)} />);
    await user.selectOptions(screen.getByLabelText("Add a required field"), "score");
    expect(last).toEqual({ outcomes: [{ name: "approved" }], required_fields: ["score"] });
    await user.click(screen.getByRole("button", { name: "Remove Score" }));
    expect(last).toEqual({ outcomes: [{ name: "approved" }] });
  });

  test("a new field is kept on the item and required at once", async () => {
    const user = userEvent.setup();
    let last: Record<string, unknown> = {};
    render(<Harness initial={{}} onConfig={(c) => (last = c)} />);
    await user.selectOptions(screen.getByLabelText("Add a required field"), "__new__");
    await user.click(screen.getByRole("button", { name: "Add field" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Give the field a name.");
    await user.type(screen.getByLabelText("Field name"), "Start date");
    await user.selectOptions(screen.getByLabelText("Type"), "date");
    await user.click(screen.getByRole("button", { name: "Add field" }));
    expect(last).toEqual({ required_fields: ["start_date"], fields: [{ key: "start_date", label: "Start date", type: "date" }] });
    // Removing the chip takes the step's own field with it.
    await user.click(screen.getByRole("button", { name: "Remove Start date" }));
    expect(last).toEqual({});
  });

  test("an unknown key is shown as such, never hidden", () => {
    render(<Harness initial={{ required_fields: ["shoe_size"] }} />);
    expect(screen.getByText("Unknown field: shoe_size")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Remove the unknown fields");
  });

  test("the catalogue joins the host's fields, form questions and kept fields, first source wins", () => {
    const g = {
      format: "workflow.graph/1",
      nodes: [
        { id: "ask", name: "Application", type: "form", config: { fields: [{ key: "phone", label: "Phone", type: "phone" }, { key: "score", label: "Again" }] } },
        { id: "check", type: "review", config: { fields: [{ key: "ref_ok", label: "References checked", type: "choice", options: ["Yes", "No"] }] } },
      ],
      edges: [],
    } as unknown as Graph;
    const cat = catalogueFromGraph(g, host);
    expect(cat.map((f) => [f.key, f.source])).toEqual([
      ["score", "Record"],
      ["reviewer", "Record"],
      ["phone", "Form: Application"],
      ["ref_ok", "Kept on the item"],
    ]);
  });

  test("a key is made from the label and never reuses one", () => {
    expect(keyFor("Start date", [])).toBe("start_date");
    expect(keyFor("Start date", ["start_date"])).toBe("start_date_2");
    expect(keyFor("2nd look", [])).toBe("f_2nd_look");
    expect(keyFor("!!!", [])).toBe("field");
  });
});

describe("suggest requirements (AI)", () => {
  function Suggesting({ suggest, onConfig }: { suggest?: () => Promise<{ fields: string[]; reason: string }>; onConfig?: (c: Record<string, unknown>) => void }) {
    const [config, setConfig] = useState<Record<string, unknown>>({});
    const node: GraphNode = { id: "review", name: "Review", type: "review", config };
    const g: Graph = { format: "workflow.graph/1", nodes: [node], edges: [] } as Graph;
    return (
      <StepRequirements
        stageName="Review"
        required={requiredOf(node)}
        itemFields={itemFieldsOf(node)}
        catalogue={catalogueFromGraph(g, host)}
        suggest={suggest}
        onChange={({ required, itemFields }) => {
          const next = withRequirements(config, required, itemFields);
          setConfig(next);
          onConfig?.(next);
        }}
      />
    );
  }

  test("no suggest, no button", () => {
    render(<Suggesting />);
    expect(screen.queryByRole("button", { name: "Suggest requirements" })).toBeNull();
  });

  test("drafts are shown as chips and added one by one or all at once", async () => {
    const user = userEvent.setup();
    let last: Record<string, unknown> = {};
    render(<Suggesting suggest={async () => ({ fields: ["score", "reviewer", "ghost"], reason: "A review is scored." })} onConfig={(c) => (last = c)} />);
    await user.click(screen.getByRole("button", { name: "Suggest requirements" }));
    const drafts = await screen.findByRole("group", { name: "Suggested fields" });
    expect(drafts).toHaveTextContent("A review is scored.");
    // A key outside the catalogue is never offered.
    expect(screen.queryByText("ghost")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add Score" }));
    expect(last).toEqual({ required_fields: ["score"] });
    await user.click(screen.getByRole("button", { name: "Add all" }));
    expect(last).toEqual({ required_fields: ["score", "reviewer"] });
    expect(await violations()).toEqual([]);
  });

  test("a failed suggestion says so and changes nothing", async () => {
    const user = userEvent.setup();
    let last: Record<string, unknown> | null = null;
    render(<Suggesting suggest={async () => Promise.reject(new Error("AI is off for this organisation."))} onConfig={(c) => (last = c)} />);
    await user.click(screen.getByRole("button", { name: "Suggest requirements" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("AI is off for this organisation.");
    expect(last).toBeNull();
  });

  test("the input names every review step and the catalogue; drafts drop what is required already", async () => {
    const { suggestInput, draftsFor } = await import("../requirements.js");
    const g = {
      format: "workflow.graph/1",
      nodes: [
        { id: "a", name: "First", type: "review", config: { required_fields: ["score"] } },
        { id: "b", type: "review" },
        { id: "c", type: "email" },
      ],
      edges: [],
    } as unknown as Graph;
    const input = suggestInput(g, host, "Intake");
    expect(input.stages).toEqual([
      { code: "a", name: "First", required: ["score"] },
      { code: "b", name: "b", required: [] },
    ]);
    expect(input.fields.map((f) => f.key)).toEqual(["score", "reviewer"]);
    expect(draftsFor("a", [{ stage: "a", fields: ["score", "reviewer", "nope"], reason: "r" }], ["score"], host)).toEqual({ fields: ["reviewer"], reason: "r" });
    expect(draftsFor("z", [], [], host)).toEqual({ fields: [], reason: "" });
  });
});
