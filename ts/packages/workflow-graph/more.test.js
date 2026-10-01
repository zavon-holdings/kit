import { test } from "node:test";
import assert from "node:assert/strict";
import * as conditions from "../conditions/index.js";
import { canonical, compile, equal, FORMAT } from "./index.js";

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
