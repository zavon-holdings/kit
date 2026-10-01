import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as conditions from "../conditions/index.js";
import { compile, decompile, validate, equal, canonical, sameSteps, nodeOf, NotDrawableError, PROBLEMS } from "./index.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "contract", "graph");
const vectors = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

const vectorProblems = (ps) =>
  ps.map((p) => {
    const out = { code: p.code };
    if (p.node) out.node = p.node;
    if (p.edge) out.edge = p.edge.label ? { from: p.edge.from, to: p.edge.to, label: p.edge.label } : { from: p.edge.from, to: p.edge.to };
    return out;
  });

test("there are graph vectors, and they are many", () => assert.ok(vectors.length >= 40));

test("every problem code has a vector, or a unit test below", () => {
  const used = new Set(vectors.flatMap((v) => (v.problems ?? []).map((p) => p.code)));
  // Covered by a vector, or only reachable through a shape a vector cannot
  // build more simply than the unit tests below do.
  const unitOnly = new Set([PROBLEMS.NODE_CONFIG, PROBLEMS.EDGE_SHAPE, PROBLEMS.BAD_LABEL, PROBLEMS.MISSING_LABEL, PROBLEMS.NEVER_ENDS, PROBLEMS.OUTCOME_TWICE]);
  for (const code of Object.values(PROBLEMS)) assert.ok(used.has(code) || unitOnly.has(code), `no vector refuses with ${code}`);
});

for (const v of vectors) {
  test(`vector ${v.name}: the same answer as the vector`, () => {
    const options = { trigger: v.trigger ?? "", conditions };
    if (v.direction === "compile") {
      const got = compile(v.graph, options);
      if (v.problems) {
        assert.ok(got.problems, `compiled, want problems ${JSON.stringify(v.problems)}`);
        assert.deepEqual(vectorProblems(got.problems), vectorProblems(v.problems));
        return;
      }
      assert.ok(!got.problems, `refused: ${JSON.stringify(got.problems)}`);
      // Strict: the same rows in the same order as the vector.
      assert.equal(got.steps.length, v.steps.length);
      got.steps.forEach((s, i) => {
        const w = v.steps[i];
        assert.equal(s.code, w.code);
        assert.equal(s.name, w.name);
        assert.equal(s.kind, w.kind);
        assert.equal(s.parent ?? "", w.parent ?? "");
        assert.equal(s.branch ?? "", w.branch ?? "");
        assert.deepEqual(s.config, w.config, `config of ${s.code}`);
      });
      const back = decompile(got.steps);
      const again = compile(back, options);
      assert.ok(!again.problems, `the decompiled graph does not compile: ${JSON.stringify(again.problems)}`);
      const [same, why] = sameSteps(again.steps, got.steps);
      assert.ok(same, `compile(decompile(compile(g))) differs: ${why}`);
      if (v.normal) assert.deepEqual(canonical(back), canonical(v.graph));
      return;
    }
    assert.equal(v.direction, "decompile");
    const g = decompile(v.steps);
    assert.ok(equal(g, v.graph), `decompile:\n got ${JSON.stringify(canonical(g))}\nwant ${JSON.stringify(canonical(v.graph))}`);
    const again = compile(g, options);
    assert.ok(!again.problems, JSON.stringify(again.problems));
    const want = v.steps.map((s) => {
      if (s.kind !== "review" && s.kind !== "form") return s;
      const { task_type: _, ...config } = s.config;
      return { ...s, config };
    });
    const [same, why] = sameSteps(again.steps, want);
    assert.ok(same, why);
  });
}

const g = (nodes, edges) => ({ format: "workflow.graph/1", nodes, edges });

test("validate needs the condition language passed in", () => {
  assert.throws(() => validate(g([], []), {}), /@zavon\/conditions/);
});

test("the shapes no vector builds are refused", () => {
  const problems = (graph) => validate(graph, { conditions }).map((p) => p.code);
  // A step's one way out carries no label.
  assert.deepEqual(problems(g([{ id: "start", type: "start" }, { id: "a", type: "email" }, { id: "e", type: "end" }],
    [{ from: "start", to: "a" }, { from: "a", to: "e", label: "on" }])), [PROBLEMS.EDGE_SHAPE]);
  // A fork's arm name is a step-code word.
  assert.ok(problems(g([{ id: "start", type: "start" }, { id: "f", type: "fork" }, { id: "a", type: "email" }, { id: "b", type: "email" },
    { id: "j", type: "join" }, { id: "e", type: "end" }],
    [{ from: "start", to: "f" }, { from: "f", to: "a", label: "Not An Arm" }, { from: "f", to: "b" }, { from: "a", to: "j" }, { from: "b", to: "j" }, { from: "j", to: "e" }]))
    .includes(PROBLEMS.BAD_LABEL));
  // A decision's branch needs a name.
  assert.ok(problems(g([{ id: "start", type: "start" }, { id: "d", type: "decision" }, { id: "a", type: "end" }, { id: "b", type: "end" }],
    [{ from: "start", to: "d" }, { from: "d", to: "a", when: { field: "x", op: "is", value: 1 } }, { from: "d", to: "b", default: true }]))
    .includes(PROBLEMS.MISSING_LABEL));
  // outcomes[].to and edges both routing.
  assert.ok(problems(g([{ id: "start", type: "start" }, { id: "r", type: "review", config: { outcomes: [{ name: "ok", to: "a" }] } },
    { id: "a", type: "end" }, { id: "b", type: "end" }],
    [{ from: "start", to: "r" }, { from: "r", to: "a", label: "ok" }, { from: "r", to: "b", default: true }])).includes(PROBLEMS.OUTCOME_TWICE));
  // A start with settings.
  assert.deepEqual(problems(g([{ id: "start", type: "start", config: { x: 1 } }, { id: "e", type: "end" }], [{ from: "start", to: "e" }])),
    [PROBLEMS.NODE_CONFIG]);
});

test("canonical keeps a node's out-edges in their written order", () => {
  const a = g([{ id: "start", type: "start" }, { id: "d", type: "decision" }],
    [{ from: "start", to: "d" }, { from: "d", to: "y", label: "b" }, { from: "d", to: "x", label: "a" }]);
  const c = canonical(a);
  // "d" sorts before "start"; d's two edges stay in the order written.
  assert.equal(c.edges[0].to, "y");
  assert.equal(c.edges[1].to, "x");
  const b = { ...a, edges: [a.edges[0], a.edges[2], a.edges[1]] };
  assert.ok(!equal(a, b), "cases reordered compared equal");
  assert.ok(equal({ ...a, nodes: [...a.nodes].reverse() }, a), "node order counted");
});

test("decompile refuses what it cannot draw rather than guessing", () => {
  assert.throws(() => decompile([{ code: "each", name: "each", kind: "loop", config: {} }]), NotDrawableError);
  assert.throws(() => decompile([{ code: "a", name: "a", kind: "end", config: {} }, { code: "a--goto", name: "x", kind: "branch", config: { cases: [], default: "a" } }]), NotDrawableError);
});

test("nodeOf strips the generated suffix", () => {
  assert.equal(nodeOf("pay--goto"), "pay");
  assert.equal(nodeOf("approve--route"), "approve");
  assert.equal(nodeOf("a-b"), "a-b");
});
