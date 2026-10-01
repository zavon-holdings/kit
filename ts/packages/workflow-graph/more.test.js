import { test } from "node:test";
import assert from "node:assert/strict";
import * as conditions from "../conditions/index.js";
import { canon, canonical, compile, decompile, equal, FORMAT, NotDrawableError, sameSteps } from "./index.js";

const base = () => ({
  format: FORMAT,
  nodes: [
    { id: "start", type: "start" },
    { id: "hello", type: "email", config: { template_code: "welcome" } },
    { id: "done", type: "end" },
  ],
  edges: [
    { from: "start", to: "hello" },
    { from: "hello", to: "done" },
  ],
});

test("notes are sorted by id in the canonical form, and their order is not a change", () => {
  const a = { ...base(), notes: [{ id: "b", text: " two ", x: 1, y: 2 }, { id: "a", text: "one", x: 0, y: 0, node: "hello" }] };
  const b = { ...base(), notes: [{ id: "a", text: "one", x: 0, y: 0, node: "hello" }, { id: "b", text: "two", x: 1, y: 2 }] };
  assert.deepEqual(canonical(a).notes.map((n) => n.id), ["a", "b"]);
  assert.equal(canonical(a).notes[1].text, "two");
  assert.ok(equal(a, b));
});

test("a moved note is a change to the drawing, never to the steps", () => {
  const a = { ...base(), notes: [{ id: "a", text: "one", x: 0, y: 0 }] };
  const b = { ...base(), notes: [{ id: "a", text: "one", x: 50, y: 0 }] };
  assert.ok(!equal(a, b));
  assert.deepEqual(compile(a, { conditions }).steps, compile(b, { conditions }).steps);
});

test("a loop with no body, or a body on another arm, is not drawn rather than guessed", () => {
  assert.throws(() => decompile([{ code: "each", name: "each", kind: "loop", config: { over: { count: 2 } } }]), NotDrawableError);
  assert.throws(
    () =>
      decompile([
        { code: "each", name: "each", kind: "loop", config: { over: { count: 2 } } },
        { code: "ping", name: "ping", kind: "email", config: {}, parent: "each", branch: "left" },
      ]),
    NotDrawableError,
  );
});

test("a stored approval is drawn without the store's task_type or the compiler's on_reject", () => {
  const g = decompile([
    { code: "sign", name: "sign", kind: "approval", config: { task_type: "approval", mode: "any", on_reject: "continue", assignees: [] } },
    { code: "sign--route", name: "After sign", kind: "branch", config: { cases: [{ when: { field: "steps.sign.output.outcome", op: "is", value: "approved" }, goto: "ok" }], default: "no" } },
    { code: "ok", name: "ok", kind: "end", config: {} },
    { code: "no", name: "no", kind: "end", config: {} },
  ]);
  const sign = g.nodes.find((n) => n.id === "sign");
  assert.equal(sign.type, "approval");
  assert.deepEqual(sign.config, { mode: "any", assignees: [] });
  const plain = decompile([
    { code: "sign", name: "sign", kind: "approval", config: { task_type: "approval", on_reject: "continue", assignees: [] } },
    { code: "ok", name: "ok", kind: "end", config: {} },
  ]);
  assert.equal(plain.nodes.find((n) => n.id === "sign").config.on_reject, "continue");
});

test("an invoice reminds through notification children of its wait, and folds back into one node", () => {
  const send = { channel: "email", to: [{ subject: true }], subject: "Invoice", body_text: "Attached." };
  const nudge = { channel: "email", to: [{ subject: true }], subject: "A reminder", body_text: "Still due." };
  const inv = {
    action: "billing.invoice.issue", amount: 100, currency: "EUR", due: { value: 10, unit: "days" }, notify: send,
    events: { paid: "billing.invoice.paid", voided: "billing.invoice.voided" },
    reminders: [{ after: { value: 3, unit: "business_days" }, notify: nudge }, { after: { value: 7, unit: "business_days" } }],
  };
  const g = {
    format: FORMAT,
    nodes: [{ id: "start", type: "start" }, { id: "inv", type: "invoice", config: inv }, { id: "done", type: "end" }, { id: "late", type: "end" }],
    edges: [{ from: "start", to: "inv" }, { from: "inv", to: "done", label: "paid" }, { from: "inv", to: "late", label: "overdue", default: true }],
  };
  const { steps, problems } = compile(g, { conditions });
  assert.equal(problems, undefined);
  const wait = steps.find((s) => s.code === "inv--wait");
  const kids = steps.filter((s) => s.parent === "inv--wait");
  assert.equal(wait.config.reminders.length, 2);
  assert.deepEqual(kids.map((k) => [k.code, k.branch]), [["inv--remind-1", "reminders"], ["inv--remind-2", "reminders"]]);
  assert.deepEqual(kids[0].config, canon(nudge));
  assert.deepEqual(kids[1].config, canon(send));
  assert.equal(wait.config.event.length, 2);
  const back = decompile(steps);
  assert.equal(back.nodes.find((n) => n.id === "inv").type, "invoice");
  const again = compile(back, { conditions });
  assert.ok(sameSteps(again.steps, steps)[0]);
});

test("an edge may read a money node's own steps", () => {
  const pay = { action: "billing.payment.request", amount: 1, currency: "EUR", expires: { value: 1, unit: "days" } };
  const g = {
    format: FORMAT,
    nodes: [{ id: "start", type: "start" }, { id: "pay", type: "payment_request", config: pay }, { id: "a", type: "end" }, { id: "b", type: "end" }],
    edges: [
      { from: "start", to: "pay" },
      { from: "pay", to: "a", label: "big", when: { field: "steps.pay--wait.output.vars.paid_cents", op: "gt", value: 100 } },
      { from: "pay", to: "b", label: "expired", default: true },
    ],
  };
  assert.equal(compile(g, { conditions }).problems, undefined);
});

test("a sub-workflow is one step of its own kind, and routes on its child's outcome when it waits", () => {
  const g = {
    format: FORMAT,
    nodes: [
      { id: "start", type: "start" },
      { id: "child", type: "sub_workflow", name: "Onboard", config: { definition: "onboard", subject: "same", vars: { source: "parent" } } },
      { id: "ok", type: "end" },
      { id: "no", type: "end" },
    ],
    edges: [{ from: "start", to: "child" }, { from: "child", to: "ok", label: "completed" }, { from: "child", to: "no", label: "otherwise", default: true }],
  };
  const { steps } = compile(g, { conditions });
  assert.equal(steps.length, 4);
  assert.equal(steps[0].kind, "sub_workflow");
  assert.equal(steps[1].code, "child--route");
  assert.equal(steps[1].config.cases[0].when.field, "steps.child.output.outcome");
  assert.ok(sameSteps(compile(decompile(steps), { conditions }).steps, steps)[0]);
  const seq = compile(
    {
      format: FORMAT,
      nodes: [{ id: "start", type: "start" }, { id: "child", type: "sub_workflow", config: { definition: "onboard", wait: false } }, { id: "done", type: "end" }],
      edges: [{ from: "start", to: "child" }, { from: "child", to: "done" }],
    },
    { conditions },
  );
  assert.equal(seq.steps.length, 2);
});
