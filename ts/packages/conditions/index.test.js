import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, evaluate, describe, fields, OPERATORS } from "./index.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "contract", "conditions");
const vectors = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

// The permits fixture, read the same way core's test reads it: an allow line
// matching subject, app, action and resource (exact, or a `*` prefix) holds
// unless a deny line matches too. Deny beats allow.
function fixture(lines) {
  return {
    holds(subject, g) {
      let allowed = false;
      for (const line of lines) {
        if (line.subject.toLowerCase() !== subject.toLowerCase() || line.app !== g.app || line.action !== g.action) continue;
        const matches =
          line.resource === g.resource ||
          (line.resource.endsWith("*") && g.resource.startsWith(line.resource.slice(0, -1)));
        if (!matches) continue;
        if (line.effect === "deny") return false;
        allowed = true;
      }
      return allowed;
    },
  };
}

test("there are contract vectors, and they are many", () => assert.ok(vectors.length >= 60));

test("every operator has a vector", () => {
  const used = new Set();
  const walk = (x) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      if (typeof x.op === "string") used.add(x.op);
      Object.values(x).forEach(walk);
    }
  };
  for (const v of vectors) walk(v.condition);
  for (const op of OPERATORS) assert.ok(used.has(op), `no vector uses ${op}`);
  assert.equal(OPERATORS.length, 17);
});

for (const v of vectors) {
  test(`vector ${v.name}: the same answer as Go`, () => {
    const mode = v.mode === "trigger" ? "trigger" : "branch";
    let node;
    try {
      node = parse(v.condition, { mode, allowHolds: true });
    } catch (e) {
      assert.equal(v.error, "parse", `refused ${JSON.stringify(v.condition)}: ${e.message}`);
      return;
    }
    assert.notEqual(v.error, "parse", `parsed ${JSON.stringify(v.condition)}, Go refuses it`);
    const scope = { ...v.scope, now: v.now, mode, permits: v.permits ? fixture(v.permits) : undefined };
    if (v.error === "eval") {
      assert.throws(() => evaluate(node, scope));
      return;
    }
    assert.equal(evaluate(node, scope), v.expect);
    // Describe and fields never throw on a vector that parses.
    assert.equal(typeof describe(node), "string");
    assert.ok(Array.isArray(fields(node)));
  });
}

test("describe says what core says", () => {
  const n = parse(
    {
      all: [
        { field: "campus", op: "is", value: "stellenbosch" },
        { field: "kind", op: "is_not", value: "staff" },
        { any: [{ field: "age", op: "lt", value: 18 }, { field: "tags", op: "contains", value: "youth" }] },
        { not: { field: "left", op: "exists" } },
        { field: "due", op: "before", value: { now: true, offset: { value: -7, unit: "days" } } },
        { field: "x", op: "in", value: ["a", ""] },
      ],
    },
    { mode: "trigger" },
  );
  assert.equal(
    describe(n),
    'campus is stellenbosch and kind is not staff and (age is less than 18 or tags contains youth) and not (left exists) and due is before now - 7 days and x is one of a, ""',
  );
  assert.deepEqual(fields(n), ["age", "campus", "due", "kind", "left", "tags", "x"]);
});

test("holds is refused at save until phase three, and now is frozen", () => {
  const holds = { field: "vars.who", op: "holds", value: { app: "pages", action: "a", resource: "r" } };
  assert.throws(() => parse(holds), /phase 3/);
  parse(holds, { allowHolds: true });
  const n = parse({ field: "vars.at", op: "before", value: { now: true } });
  assert.equal(evaluate(n, { vars: { at: "2000-01-01" }, now: "1999-01-01T00:00:00Z" }), false);
  assert.equal(evaluate(n, { vars: { at: "2000-01-01" }, now: "2001-01-01T00:00:00Z" }), true);
});
