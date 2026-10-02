import { test } from "node:test";
import assert from "node:assert/strict";
import * as conditions from "../conditions/index.js";
import { compile, decompile } from "./index.js";

// A to-do is a plain step: one way on, done by one of its people. A stored
// one carries task_type, as every task does; its node does not.
test("a stored to-do draws as a todo node without task_type, and compiles back", () => {
  const steps = [
    { code: "book", name: "Book the venue", kind: "todo", config: { task_type: "todo", title: "Book the venue", assignees: [{ people: [{ email: "ana@example.test" }] }] } },
    { code: "done", name: "done", kind: "end", config: { outcome: "completed" } },
  ];
  const g = decompile(steps);
  const book = g.nodes.find((n) => n.id === "book");
  assert.equal(book.type, "todo");
  assert.equal(book.config.task_type, undefined);
  const back = compile(g, { conditions });
  assert.equal(back.problems, undefined, JSON.stringify(back.problems));
  assert.deepEqual(back.steps.map((s) => [s.code, s.kind]), [["book", "todo"], ["done", "end"]]);
});

test("a to-do sits in a fork's arm, where a decision may not", () => {
  const g = {
    format: "workflow.graph/1",
    nodes: [
      { id: "start", type: "start" }, { id: "fork", type: "fork" },
      { id: "a", type: "todo", config: { assignees: [{ people: [{ email: "a@example.test" }] }] } },
      { id: "b", type: "todo", config: { assignees: [{ people: [{ email: "b@example.test" }] }] } },
      { id: "join", type: "join", config: { join: "all" } }, { id: "done", type: "end", config: {} },
    ],
    edges: [
      { from: "start", to: "fork" }, { from: "fork", to: "a" }, { from: "fork", to: "b" },
      { from: "a", to: "join" }, { from: "b", to: "join" }, { from: "join", to: "done" },
    ],
  };
  const out = compile(g, { conditions });
  assert.equal(out.problems, undefined, JSON.stringify(out.problems));
  assert.equal(out.steps[0].kind, "parallel");
});
