import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { merge3, resolve, canonical, sha256, validate, isValid } from "./index.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "contract", "merge3");
const vectors = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

test("there are contract vectors", () => assert.ok(vectors.length >= 30));

test("every conflict kind and every choice appears in the vectors", () => {
  const kinds = new Set();
  const choices = new Set();
  for (const v of vectors) {
    for (const c of v.expect.conflicts) kinds.add(c.kind);
    for (const r of v.resolutions ?? []) for (const d of Object.values(r.decisions)) choices.add(d.choice);
  }
  assert.deepEqual([...kinds].sort(), ["delete", "field", "move", "order"]);
  assert.deepEqual([...choices].sort(), ["a", "b", "both", "manual"]);
});

for (const v of vectors) {
  test(`vector ${v.name}`, () => {
    const r = merge3(v.base, v.a, v.b);
    assert.equal(canonical({ tree: r.tree, conflicts: r.conflicts }), canonical(v.expect));
    for (const res of v.resolutions ?? []) {
      let got;
      try {
        const out = resolve(r, res.decisions, res.options ?? {});
        got = { tree: out.tree, ids: out.ids, conflicts: out.conflicts };
        validate(out.tree);
      } catch (e) {
        if (!res.expect.error) throw e;
        got = { error: true };
      }
      assert.equal(canonical(got), canonical(res.expect), `${v.name} / ${res.description}`);
    }
  });
}

test("canonical JSON matches the Go twin's", () => {
  const cases = {
    '{"b":1,"a":[true,null,"x"]}': '{"a":[true,null,"x"],"b":1}',
    "[1e21, 1e-7, 0.000001, -0, 1.5, 100]": "[1e+21,1e-7,0.000001,0,1.5,100]",
    '"<a href=\\"x\\">&amp;</a>"': '"<a href=\\"x\\">&amp;</a>"',
    '"tab\\tline\\nctl\\u0001 \\u2028 é"': '"tab\\tline\\nctl\\u0001   é"',
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(canonical(JSON.parse(input)), want);
});

test("sha256 agrees with node:crypto", () => {
  for (const s of ["", "abc", "é😀", "x".repeat(55), "y".repeat(56), "z".repeat(64), "w".repeat(1000)]) {
    assert.equal(sha256(s), createHash("sha256").update(s, "utf8").digest("hex"));
  }
});

test("invalid trees are refused", () => {
  assert.throws(() => validate({ kind: "doc", slots: { body: [{ key: "x", kind: "t" }, { key: "x", kind: "t" }] } }));
  assert.throws(() => validate({ kind: "doc", slots: { body: [{ key: "~x", kind: "t" }] } }));
  assert.throws(() => validate({ kind: "doc", slots: { body: {} } }));
  assert.equal(isValid({ kind: "doc", slots: { body: [{ kind: "t" }, { kind: "t" }] } }), true);
  assert.throws(() => merge3({ kind: "d" }, { kind: "d", slots: { s: [{ key: "a", kind: "t" }, { key: "a", kind: "t" }] } }, { kind: "d" }));
});

test("result.resolve is resolve, and a custom key minter names copies", () => {
  const v = vectors.find((x) => x.name === "field-conflict");
  const r = merge3(v.base, v.a, v.b);
  const out = r.resolve({ "field:p1:text": { choice: "both" } }, { duplicateAsUnits: true, mintKey: (old) => old + "-copy" });
  assert.deepEqual(out.ids, { p1: "p1-copy" });
  assert.deepEqual(out.tree.slots.body.map((u) => u.key), ["p1", "p1-copy", "p2"]);
  assert.throws(() => r.resolve({ "field:p1:text": { choice: "both" } }, { duplicateAsUnits: true, mintKey: () => "p2" }));
});

test("inputs are not changed", () => {
  const v = vectors.find((x) => x.name === "move-conflict");
  const snap = JSON.stringify([v.base, v.a, v.b]);
  const r = merge3(v.base, v.a, v.b);
  r.tree.slots.body.push({ kind: "x" });
  r.resolve({ "move:p1": { choice: "both" } });
  assert.equal(JSON.stringify([v.base, v.a, v.b]), snap);
});

test("random parity cases written by the Go twin", () => {
  const cases = JSON.parse(readFileSync(join(dir, "parity", "random.json"), "utf8"));
  assert.ok(cases.length >= 50);
  for (const c of cases) {
    const r = merge3(c.base, c.a, c.b);
    assert.equal(canonical({ tree: r.tree, conflicts: r.conflicts }), canonical(c.expect), `seed ${c.seed}`);
    if (c.decisions) {
      let got;
      try {
        const out = r.resolve(c.decisions, { duplicateAsUnits: true });
        got = { tree: out.tree, ids: out.ids, conflicts: out.conflicts };
      } catch {
        got = { error: true };
      }
      assert.equal(canonical(got), canonical(c.resolved), `seed ${c.seed} resolved`);
    }
  }
});
