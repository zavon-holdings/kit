import { useState } from "react";
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { compile, ACTION_DECIDE } from "@zavon/workflow-graph";
import * as conditions from "@zavon/conditions";
import { NODE_KINDS, edgeRole, kindOf } from "../catalogue.js";
import { summarize } from "../design.js";
import { fieldSuggestions } from "../fields.js";
import { BUILT_IN_INSPECTORS } from "./inspectors.js";
import { DecideInspector, decideProblems, newQuestion, type DecideConfig } from "./DecideInspector.js";
import type { Graph, GraphNode } from "../types.js";

// The Decide node: AI's typed questions over the fields the step names. It
// is one way on (a decision after it reads the answer), it compiles to a
// call of core.ai.decide, and its editor names the fields, the questions
// with their thresholds, who confirms, and says what is missing in words.

async function violations(): Promise<string[]> {
  const out = await axe.run(document.body, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false }, "page-has-heading-one": { enabled: false }, "landmark-one-main": { enabled: false } },
  });
  return out.violations.map((v) => `${v.id}: ${v.help}`);
}

function Harness({ initial, onConfig }: { initial: Record<string, unknown>; onConfig: (c: Record<string, unknown>) => void }) {
  const [config, setConfig] = useState(initial);
  const node: GraphNode = { id: "triage", type: "decide", config };
  return (
    <DecideInspector
      node={node}
      readOnly={false}
      onChange={(c) => {
        setConfig(c);
        onConfig(c);
      }}
    />
  );
}

const ready: DecideConfig = {
  fields: [{ path: "subject.vars.summary", label: "Summary" }],
  questions: [{ key: "panel", type: "choice", text: "Which panel?", threshold: 0.7, options: [{ key: "science", label: "Science" }, { key: "arts", label: "Arts" }] }],
  review: { assignees: [{ people: [{ email: "office@example.test" }] }] },
};

describe("the Decide node", () => {
  test("is offered under Logic as one way on, with its editor built in", () => {
    const k = NODE_KINDS.find((n) => n.type === "decide");
    expect(k?.group).toBe("Logic");
    expect(kindOf("decide").label).toBe("Decide With AI");
    expect(edgeRole("decide", 1)).toBe("sequence");
    expect(BUILT_IN_INSPECTORS.decide).toBe(DecideInspector);
    expect(summarize({ id: "d", type: "decide", config: ready as Record<string, unknown> })).toBe("1 question · reads 1 field");
  });

  test("compiles to a call of core.ai.decide with the node's settings as its input", () => {
    const g: Graph = {
      format: "workflow.graph/1",
      nodes: [
        { id: "start", type: "start" },
        { id: "triage", type: "decide", config: ready as Record<string, unknown> },
        { id: "done", type: "end", config: { outcome: "completed" } },
      ],
      edges: [
        { from: "start", to: "triage" },
        { from: "triage", to: "done" },
      ],
    };
    const out = compile(g, { conditions: { parse: conditions.parse, fields: conditions.fields } });
    const step = out.steps?.find((s) => s.code === "triage");
    expect(step?.kind).toBe("call");
    expect((step?.config as Record<string, unknown>).action).toBe(ACTION_DECIDE);
    expect(fieldSuggestions(g)).toContain("steps.triage.output.panel.answer");
  });

  test("says what is missing before it can be saved", () => {
    expect(decideProblems(ready)).toEqual([]);
    const fresh = NODE_KINDS.find((n) => n.type === "decide")!.config as DecideConfig;
    const problems = decideProblems(fresh);
    expect(problems).toContain("Question 1: say what it asks.");
    expect(problems).toContain("Name who confirms an answer the AI is not sure of.");
    const score = newQuestion("score", ["question"]);
    expect(score.key).toBe("question_2");
    expect(score.threshold).toBe(0.7);
    expect(decideProblems({ ...ready, questions: [{ ...score, text: "How urgent?", levels: ["Soon"] }] })[0]).toMatch(/describes 2 to 10 levels/);
  });

  test("its editor writes the fields, a scored question, who confirms and the sensitive switch", async () => {
    const user = userEvent.setup();
    let last: Record<string, unknown> = {};
    render(<Harness initial={{ fields: [], questions: [], review: { assignees: [{ role: { app: "pages", code: "office" } }] } }} onConfig={(c) => (last = c)} />);
    await user.click(screen.getByRole("button", { name: "Add a Field" }));
    await user.type(screen.getByLabelText("Field 1"), "subject.vars.summary");
    await user.type(screen.getByLabelText("Field 1: Label"), "Summary");
    await user.click(screen.getByRole("button", { name: "Add a Question" }));
    await user.selectOptions(screen.getByLabelText("Question 1: Type"), "score");
    await user.type(screen.getByLabelText("Question 1: Words"), "How urgent is it?");
    await user.clear(screen.getByLabelText("Question 1: Levels (one per line, lowest first)"));
    await user.type(screen.getByLabelText("Question 1: Levels (one per line, lowest first)"), "It can wait{enter}This week");
    await user.type(screen.getByLabelText("Confirmed By (one email address per line)"), "office@example.test");
    await user.click(screen.getByLabelText("Send Sensitive Answers"));
    const c = last as DecideConfig;
    expect(c.fields).toEqual([{ path: "subject.vars.summary", label: "Summary" }]);
    expect(c.questions?.[0]).toMatchObject({ type: "score", text: "How urgent is it?", levels: ["It can wait", "This week"], threshold: 0.7 });
    // The role it was given is kept beside the people typed.
    expect(c.review?.assignees).toEqual([{ role: { app: "pages", code: "office" } }, { people: [{ email: "office@example.test" }] }]);
    expect(c.sensitive).toBe(true);
    expect(decideProblems(c)).toEqual([]);
    expect(await violations()).toEqual([]);
  });
});
