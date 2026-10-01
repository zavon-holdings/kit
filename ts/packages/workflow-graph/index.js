// The workflow decision-tree compiler, in the browser (expansion plan §5).
//
// Twin of core's app/workflow/graph, which is the AUTHORITY: a save sends
// {graph, steps} and core recompiles the graph itself, refusing a steps list
// that differs (422 compile_mismatch). This twin exists for the builder's live
// preview and its problem badges, and both are held to the same vectors in
// kit/contract/graph, which core writes.
//
// The condition language is not re-implemented here: validate and compile
// take @zavon/conditions as options.conditions ({parse, fields}), so a builder
// that already vendors it passes it in, and this package depends on nothing.

export const FORMAT = "zavon.workflow.graph/1";
export const SUFFIX_GOTO = "--goto";
export const SUFFIX_ROUTE = "--route";
export const SUFFIX_JOIN = "--join";
export const TIMEOUT_LABEL = "timeout";

export const PROBLEMS = Object.freeze({
  FORMAT: "graph_format",
  BAD_ID: "bad_id",
  DUPLICATE_ID: "duplicate_id",
  UNKNOWN_TYPE: "unknown_type",
  NOT_YET: "not_yet",
  MAX_PASSES: "max_passes",
  NODE_CONFIG: "node_config",
  EDGE_NODE: "edge_unknown_node",
  START: "start",
  EDGE_SHAPE: "edge_shape",
  DEAD_END: "dead_end",
  END_EDGES: "end_edges",
  SEQUENCE: "sequence_edges",
  CHOICES: "choice_edges",
  NEEDS_DEFAULT: "needs_default",
  TWO_DEFAULTS: "two_defaults",
  MISSING_LABEL: "missing_label",
  BAD_LABEL: "bad_label",
  DUPLICATE_LABEL: "duplicate_label",
  NEEDS_CONDITION: "needs_condition",
  BAD_CONDITION: "bad_condition",
  TIMEOUT_EDGE: "timeout_edge",
  OUTCOME_TWICE: "outcome_twice",
  OUTCOME_UNKNOWN: "outcome_unknown",
  UNREACHABLE: "unreachable",
  FORK_ARMS: "fork_arms",
  UNSTRUCTURED: "fork_unstructured",
  ARM_NOT_PLAIN: "arm_not_plain",
  EMPTY_ARM: "empty_arm",
  JOIN: "join",
  QUORUM: "quorum",
  CYCLE: "unguarded_cycle",
  NEVER_ENDS: "never_ends",
  UNKNOWN_STEP: "unknown_step",
  SCOPE: "scope_unavailable",
});
const P = PROBLEMS;

const PLAIN = new Set(["email", "delay", "call", "set_var", "notification", "webhook"]);
const isTask = (t) => t === "review" || t === "form";
const isStepType = (t) => PLAIN.has(t) || isTask(t) || t === "wait_event";
const STRUCTURAL = new Set(["start", "end", "fork", "join", "condition", "decision"]);
const knownType = (t) => STRUCTURAL.has(t) || isStepType(t);

export const NOT_YET = Object.freeze({
  loop: "a loop is saved as steps until the canvas draws regions (expansion plan phase D)",
  sub_workflow: "sub-workflows arrive with phase G of the expansion plan",
  payment_request: "a payment request arrives with phase F of the expansion plan",
  invoice: "an invoice arrives with phase F of the expansion plan",
  approval: "approvals arrive with phase 3 of the workflow plan",
  task: "a task node is a review or a form until phase 3's task types",
  branch: "draw a branch as a decision or a condition",
  parallel: "draw a parallel block as a fork and a join",
});

const STEP_ID = /^[a-z0-9_]+(-[a-z0-9_]+)*$/;
const OTHER_ID = /^[a-z0-9_]+(--?[a-z0-9_]+)*$/;
const ARM_NAME = STEP_ID;

/* ── JSON, canonically ── */

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** A JSON value with every object's keys sorted. */
export function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (isObject(v)) {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v;
}

const stringify = (v) => JSON.stringify(canon(v));
const jsonEqual = (a, b) => stringify(a ?? {}) === stringify(b ?? {});

/** A config as an object; null when it is not one. Absent is {}. */
function object(config) {
  if (config === undefined || config === null) return {};
  return isObject(config) ? { ...config } : null;
}

const hasWhen = (e) => e.when !== undefined && e.when !== null;

function displayName(n) {
  const s = typeof n.name === "string" ? n.name.trim() : "";
  return s || n.id;
}

/** The node a step code came from: the code, or the code before a generated suffix. */
export function nodeOf(code) {
  const i = code.indexOf("--");
  return i > 0 ? code.slice(0, i) : code;
}

/* ── canonical form ── */

/**
 * The graph in canonical form: nodes by id, edges STABLY by `from` (a node's
 * out-edges keep their written order: a decision's cases are evaluated in
 * it), configs with sorted keys, empty settings and empty fields dropped.
 */
export function canonical(g) {
  const nodes = (g.nodes ?? []).map((n) => {
    const out = { id: n.id, type: n.type };
    const name = typeof n.name === "string" ? n.name.trim() : "";
    if (name) out.name = name;
    if (n.config !== undefined && n.config !== null) {
      const c = canon(n.config);
      if (!(isObject(c) && Object.keys(c).length === 0)) out.config = c;
    }
    if (n.max_passes) out.max_passes = n.max_passes;
    if (n.implicit) out.implicit = true;
    return out;
  });
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const edges = (g.edges ?? []).map((e) => {
    const out = { from: e.from, to: e.to };
    if (e.label) out.label = e.label;
    if (hasWhen(e)) out.when = canon(e.when);
    if (e.default) out.default = true;
    return out;
  });
  edges.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const out = { format: g.format, nodes, edges };
  if (g.layout && Object.keys(g.layout).length > 0) out.layout = canon(g.layout);
  return out;
}

/** Two graphs that draw the same and behave the same. */
export function equal(a, b) {
  return stringify(canonical(a)) === stringify(canonical(b));
}

/** Two step lists that compile the same (each (parent, arm) group in order). */
export function sameSteps(a, b) {
  const group = (list) => {
    const out = new Map();
    for (const s of list) {
      const k = `${s.parent ?? ""}\u0000${s.branch ?? ""}`;
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(s);
    }
    return out;
  };
  const ga = group(a);
  const gb = group(b);
  if (ga.size !== gb.size) return [false, "the steps are grouped into different blocks"];
  for (const [k, xa] of ga) {
    const xb = gb.get(k) ?? [];
    const [parent, arm] = k.split("\u0000");
    const where = parent ? `arm "${arm}" of ${parent}` : "the top level";
    if (xa.length !== xb.length) return [false, `${where} has ${xa.length} steps in one list and ${xb.length} in the other`];
    for (let i = 0; i < xa.length; i++) {
      const sa = xa[i];
      const sb = xb[i];
      if (sa.code !== sb.code) return [false, `step ${i + 1} of ${where} is "${sa.code}" in one list and "${sb.code}" in the other`];
      if (sa.kind !== sb.kind) return [false, `step "${sa.code}" is a ${sa.kind} in one list and a ${sb.kind} in the other`];
      if (sa.name !== sb.name) return [false, `step "${sa.code}" is called "${sa.name}" in one list and "${sb.name}" in the other`];
      if (!jsonEqual(sa.config, sb.config)) return [false, `step "${sa.code}" has a different config`];
    }
  }
  return [true, ""];
}

/* ── the index ── */

class Index {
  constructor(g) {
    this.g = g;
    this.byID = new Map();
    this.out = new Map();
    this.in = new Map();
    for (const n of g.nodes ?? []) if (!this.byID.has(n.id)) this.byID.set(n.id, n);
    (g.edges ?? []).forEach((e, i) => {
      if (!this.out.has(e.from)) this.out.set(e.from, []);
      this.out.get(e.from).push(i);
      if (!this.in.has(e.to)) this.in.set(e.to, []);
      this.in.get(e.to).push(i);
    });
  }
  outs(id) {
    return this.out.get(id) ?? [];
  }
  ins(id) {
    return this.in.get(id) ?? [];
  }
  edge(i) {
    return this.g.edges[i];
  }
  name(id) {
    const n = this.byID.get(id);
    return n ? displayName(n) : id;
  }
  routes(n) {
    if (!isTask(n.type)) return false;
    const es = this.outs(n.id);
    if (es.length > 1) return true;
    return es.some((i) => {
      const e = this.edge(i);
      return Boolean(e.label) || hasWhen(e) || Boolean(e.default);
    });
  }
  chooses(n) {
    return n.type === "decision" || n.type === "condition" || this.routes(n);
  }
  waitEdges(id) {
    const normal = [];
    const timeout = [];
    for (const i of this.outs(id)) (this.edge(i).label === TIMEOUT_LABEL ? timeout : normal).push(i);
    return [normal, timeout];
  }
}

const ref = (e) => {
  const r = { from: e.from, to: e.to };
  if (e.label) r.label = e.label;
  return r;
};

function sortProblems(ps) {
  const key = (p) => {
    let k = `${p.node ?? ""}\u0000${p.code}`;
    if (p.edge) k += `\u0000${p.edge.from}\u0000${p.edge.to}\u0000${p.edge.label ?? ""}`;
    return k;
  };
  return ps.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function needConditions(options) {
  const c = options?.conditions;
  if (!c || typeof c.parse !== "function" || typeof c.fields !== "function") {
    throw new TypeError("pass @zavon/conditions as options.conditions ({parse, fields}): the graph's conditions are read with it");
  }
  return c;
}

/* ── validation ── */

/**
 * What is wrong with a graph; empty means it compiles. Layer by layer, as
 * core does: the document, then the shape, then the scope.
 */
export function validate(g, options = {}) {
  const conditions = needConditions(options);
  let ps = validateDocument(g);
  if (ps.length) return sortProblems(ps);
  const x = new Index(g);
  ps = validateShape(x, conditions);
  if (ps.length) return sortProblems(ps);
  return sortProblems(validateScope(x, options, conditions));
}

function validateDocument(g) {
  const ps = [];
  const add = (code, node, message) => ps.push(node ? { code, node, message } : { code, message });
  if (g.format !== FORMAT) add(P.FORMAT, "", `a graph says format "${FORMAT}"`);
  const seen = new Set();
  let starts = 0;
  for (const n of g.nodes ?? []) {
    const becomesStep = n.type !== "start" && n.type !== "join" && !(n.type === "end" && n.implicit);
    if (!n.id) add(P.BAD_ID, "", "every node needs an id");
    else if (becomesStep && !STEP_ID.test(n.id))
      add(P.BAD_ID, n.id, `"${n.id}" is not a node id: lower-case letters, digits, _ and single hyphens (-- is the compiler's)`);
    else if (!becomesStep && !OTHER_ID.test(n.id))
      add(P.BAD_ID, n.id, `"${n.id}" is not a node id: lower-case letters, digits, _ and hyphens`);
    if (n.id && seen.has(n.id)) add(P.DUPLICATE_ID, n.id, `two nodes are called "${n.id}"`);
    seen.add(n.id);
    if (Object.hasOwn(NOT_YET, n.type)) add(P.NOT_YET, n.id, `${displayName(n)}: ${NOT_YET[n.type]}`);
    else if (!knownType(n.type)) add(P.UNKNOWN_TYPE, n.id, `${displayName(n)} is a "${n.type}", which is not a node this builder knows`);
    if (n.type === "start") starts++;
    const mp = n.max_passes ?? 0;
    if (mp < 0 || mp > 100) add(P.MAX_PASSES, n.id, `${displayName(n)}: max_passes is how often a run may come back here, from 1 to 100`);
    if (n.implicit && n.type !== "end") add(P.NODE_CONFIG, n.id, `${displayName(n)}: only an end can be implicit`);
    if (object(n.config) === null) add(P.NODE_CONFIG, n.id, `${displayName(n)}: settings are a JSON object`);
  }
  for (const e of g.edges ?? []) {
    if (!e.from || !e.to || !seen.has(e.from) || !seen.has(e.to)) {
      ps.push({ code: P.EDGE_NODE, edge: ref(e), message: `an edge from "${e.from}" to "${e.to}" names a node that is not in the graph` });
    }
  }
  if (starts !== 1) add(P.START, "", "a workflow starts in one place: exactly one start node");
  return ps;
}

function validateShape(x, conditions) {
  const ps = [];
  for (const n of x.g.nodes) {
    const name = displayName(n);
    const outs = x.outs(n.id);
    const cfg = object(n.config) ?? {};
    if (n.type === "start") {
      if (x.ins(n.id).length > 0 || outs.length !== 1)
        ps.push({ code: P.START, node: n.id, message: "a workflow starts in one place: the start has one way out and nothing leads back to it" });
      for (const i of outs) plainEdge(x, ps, n, i);
      if (Object.keys(cfg).length > 0) ps.push({ code: P.NODE_CONFIG, node: n.id, message: "the start has no settings; the trigger is the definition's" });
    } else if (n.type === "end") {
      if (outs.length > 0) ps.push({ code: P.END_EDGES, node: n.id, message: `${name} ends the run, so nothing can follow it` });
    } else if (n.type === "fork") {
      forkEdges(x, ps, n);
      if (Object.keys(cfg).length > 0)
        ps.push({ code: P.NODE_CONFIG, node: n.id, message: `${name}: a fork has no settings; its join says how the arms meet` });
    } else if (n.type === "join") {
      oneWayOut(x, ps, n);
      const [, why] = readJoin(cfg);
      if (why) ps.push({ code: P.JOIN, node: n.id, message: `${name}: ${why}` });
    } else if (n.type === "condition") {
      conditionNode(x, ps, n, cfg, conditions);
    } else if (n.type === "decision" || x.routes(n)) {
      choiceEdges(x, ps, n, cfg, conditions);
    } else if (n.type === "wait_event") {
      waitNode(x, ps, n, cfg);
    } else {
      oneWayOut(x, ps, n);
    }
  }
  const reached = reach(x);
  for (const n of x.g.nodes) {
    if (n.type !== "start" && !reached.has(n.id)) ps.push({ code: P.UNREACHABLE, node: n.id, message: `${displayName(n)} can never be reached` });
  }
  ps.push(...regions(x)[1]);
  ps.push(...cycles(x, reached));
  if (ps.length === 0) {
    const ends = reachesEnd(x);
    for (const n of x.g.nodes) {
      if (reached.has(n.id) && !ends.has(n.id)) ps.push({ code: P.NEVER_ENDS, node: n.id, message: `the path through ${displayName(n)} never ends the run` });
    }
  }
  return ps;
}

function plainEdge(x, ps, n, i) {
  const e = x.edge(i);
  if (e.label || hasWhen(e) || e.default) {
    ps.push({ code: P.EDGE_SHAPE, node: n.id, edge: ref(e), message: `${displayName(n)} leads to one place, so its way out carries no label, condition or default` });
  }
}

function oneWayOut(x, ps, n) {
  const outs = x.outs(n.id);
  if (outs.length === 0) ps.push({ code: P.DEAD_END, node: n.id, message: `${displayName(n)} leads nowhere; connect it or end the run there` });
  else if (outs.length > 1)
    ps.push({ code: P.SEQUENCE, node: n.id, message: `${displayName(n)} has ${outs.length} ways out; a step leads to one place — put a decision after it` });
  for (const i of outs) plainEdge(x, ps, n, i);
}

const armLabel = (e, k) => e.label || `arm-${k + 1}`;

function forkEdges(x, ps, n) {
  const outs = x.outs(n.id);
  if (outs.length < 2) ps.push({ code: P.FORK_ARMS, node: n.id, message: `${displayName(n)} splits into two or more arms` });
  const seen = new Set();
  outs.forEach((i, k) => {
    const e = x.edge(i);
    if (hasWhen(e) || e.default)
      ps.push({ code: P.EDGE_SHAPE, node: n.id, edge: ref(e), message: `${displayName(n)} runs every arm; an arm carries a name, not a condition or a default` });
    const arm = armLabel(e, k);
    if (e.label && !ARM_NAME.test(e.label))
      ps.push({ code: P.BAD_LABEL, node: n.id, edge: ref(e), message: `"${e.label}" is not an arm name: lower-case letters, digits, _ and single hyphens` });
    if (seen.has(arm)) ps.push({ code: P.DUPLICATE_LABEL, node: n.id, edge: ref(e), message: `${displayName(n)} has two arms called "${arm}"` });
    seen.add(arm);
  });
}

function readJoin(cfg) {
  const js = { join: "all", quorum: 0 };
  for (const k of Object.keys(cfg)) if (k !== "join" && k !== "quorum") return [js, `"${k}" is not a join setting (join, quorum)`];
  if ("join" in cfg) {
    const s = typeof cfg.join === "string" ? cfg.join.trim().toLowerCase() : "";
    js.join = s || "all";
  }
  if (js.join === "all" || js.join === "any") return [js, ""];
  if (js.join === "quorum") {
    const q = cfg.quorum;
    if (!Number.isInteger(q) || q < 1) return [js, "a quorum join says how many arms: quorum"];
    js.quorum = q;
    return [js, ""];
  }
  return [js, "a join is all, any or quorum"];
}

function tryParse(conditions, raw) {
  try {
    return [conditions.parse(raw === undefined ? null : raw, { mode: "branch", allowHolds: true }), null];
  } catch (e) {
    return [null, e];
  }
}

function conditionNode(x, ps, n, cfg, conditions) {
  for (const k of Object.keys(cfg)) {
    if (k !== "when")
      ps.push({ code: P.NODE_CONFIG, node: n.id, message: `${displayName(n)}: "${k}" is not a condition setting; a condition asks one question, when` });
  }
  const [parsed, err] = tryParse(conditions, cfg.when);
  if (err) ps.push({ code: P.BAD_CONDITION, node: n.id, message: `${displayName(n)}: ${err.message}` });
  else if (parsed.empty)
    ps.push({ code: P.NEEDS_CONDITION, node: n.id, message: `${displayName(n)} asks nothing, so it would always say yes: give it a condition, when` });
  const outs = x.outs(n.id);
  if (outs.length !== 2) ps.push({ code: P.CHOICES, node: n.id, message: `${displayName(n)} has two ways out, yes and no` });
  defaults(x, ps, n);
  for (const i of outs) {
    const e = x.edge(i);
    if (hasWhen(e))
      ps.push({ code: P.EDGE_SHAPE, node: n.id, edge: ref(e), message: `${displayName(n)} asks its question on the node; its edges carry no condition` });
  }
  labels(x, ps, n, false);
}

function defaults(x, ps, n) {
  const count = x.outs(n.id).filter((i) => x.edge(i).default).length;
  if (count === 0) ps.push({ code: P.NEEDS_DEFAULT, node: n.id, message: `${displayName(n)} needs a default branch for when nothing else matches` });
  else if (count > 1)
    ps.push({ code: P.TWO_DEFAULTS, node: n.id, message: `${displayName(n)} has ${count} default branches; one is taken when nothing else matches` });
}

function labels(x, ps, n, need) {
  const seen = new Set();
  for (const i of x.outs(n.id)) {
    const e = x.edge(i);
    const l = (e.label ?? "").trim().toLowerCase();
    if (!l) {
      if (need && !e.default) ps.push({ code: P.MISSING_LABEL, node: n.id, edge: ref(e), message: `every branch of ${displayName(n)} needs a name` });
      continue;
    }
    if (seen.has(l)) ps.push({ code: P.DUPLICATE_LABEL, node: n.id, edge: ref(e), message: `${displayName(n)} has two branches called "${e.label}"` });
    seen.add(l);
  }
}

function choiceEdges(x, ps, n, cfg, conditions) {
  const outs = x.outs(n.id);
  if (outs.length < 2)
    ps.push({ code: P.CHOICES, node: n.id, message: `${displayName(n)} chooses between two or more ways out, one of them the default` });
  defaults(x, ps, n);
  labels(x, ps, n, true);
  if (n.type === "decision" && Object.keys(cfg).length > 0)
    ps.push({ code: P.NODE_CONFIG, node: n.id, message: `${displayName(n)}: a decision's questions are on its edges; it has no settings` });
  const outcomes = new Set();
  const names = [];
  if (isTask(n.type)) {
    for (const o of Array.isArray(cfg.outcomes) ? cfg.outcomes : []) {
      const name = isObject(o) && typeof o.name === "string" ? o.name : "";
      const to = isObject(o) && typeof o.to === "string" ? o.to : "";
      if (to.trim())
        ps.push({ code: P.OUTCOME_TWICE, node: n.id, message: `${displayName(n)} routes by outcome twice: drop outcomes[].to, the edges say where each outcome goes` });
      if (name) {
        outcomes.add(name.toLowerCase());
        names.push(name);
      }
    }
  }
  for (const i of outs) {
    const e = x.edge(i);
    if (e.default) {
      if (hasWhen(e))
        ps.push({ code: P.EDGE_SHAPE, node: n.id, edge: ref(e), message: `the default branch of ${displayName(n)} is taken when nothing else matches, so it carries no condition` });
      continue;
    }
    if (!hasWhen(e)) {
      if (n.type === "decision")
        ps.push({ code: P.NEEDS_CONDITION, node: n.id, edge: ref(e), message: `the branch "${e.label}" of ${displayName(n)} needs a condition` });
      else if (outcomes.size > 0 && e.label && !outcomes.has(e.label.toLowerCase()))
        ps.push({ code: P.OUTCOME_UNKNOWN, node: n.id, edge: ref(e), message: `${displayName(n)} can never finish as "${e.label}"; its outcomes are ${names.join(", ")}` });
      continue;
    }
    const [parsed, err] = tryParse(conditions, e.when);
    if (err) ps.push({ code: P.BAD_CONDITION, node: n.id, edge: ref(e), message: `the branch "${e.label}" of ${displayName(n)}: ${err.message}` });
    else if (parsed.empty)
      ps.push({ code: P.NEEDS_CONDITION, node: n.id, edge: ref(e), message: `the branch "${e.label}" of ${displayName(n)} asks nothing, so it would always be taken` });
  }
}

function waitNode(x, ps, n, cfg) {
  const [normal, timeout] = x.waitEdges(n.id);
  if (normal.length === 0) ps.push({ code: P.DEAD_END, node: n.id, message: `${displayName(n)} leads nowhere; connect it or end the run there` });
  else if (normal.length > 1)
    ps.push({ code: P.SEQUENCE, node: n.id, message: `${displayName(n)} has ${normal.length} ways on; a wait leads to one place, and to one more on its timeout` });
  for (const i of normal) plainEdge(x, ps, n, i);
  if (timeout.length > 1) ps.push({ code: P.TIMEOUT_EDGE, node: n.id, message: `${displayName(n)} has ${timeout.length} timeout edges; a wait times out once` });
  for (const i of timeout) {
    const e = x.edge(i);
    if (hasWhen(e) || e.default)
      ps.push({ code: P.EDGE_SHAPE, node: n.id, edge: ref(e), message: `the timeout edge of ${displayName(n)} carries no condition or default` });
  }
  const on = typeof cfg.on_timeout === "string" ? cfg.on_timeout : "";
  if (on.startsWith("branch:"))
    ps.push({ code: P.TIMEOUT_EDGE, node: n.id, message: `${displayName(n)}: draw where a timeout goes as an edge labelled "${TIMEOUT_LABEL}", not on_timeout` });
  else if (timeout.length > 0 && on !== "")
    ps.push({ code: P.TIMEOUT_EDGE, node: n.id, message: `${displayName(n)} says what a timeout does twice: on_timeout "${on}" and an edge` });
  else if (timeout.length > 0 && (cfg.timeout === undefined || cfg.timeout === null))
    ps.push({ code: P.TIMEOUT_EDGE, node: n.id, message: `${displayName(n)} has a timeout edge but no timeout` });
}

function walk(starts, next) {
  const seen = new Set();
  const stack = [...starts];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...next(id));
  }
  return seen;
}

function reach(x) {
  const starts = x.g.nodes.filter((n) => n.type === "start").map((n) => n.id);
  return walk(starts, (id) => x.outs(id).map((i) => x.edge(i).to));
}

function reachesEnd(x) {
  const ends = x.g.nodes.filter((n) => n.type === "end").map((n) => n.id);
  return walk(ends, (id) => x.ins(id).map((i) => x.edge(i).from));
}

function armable(x, n) {
  if (PLAIN.has(n.type)) return true;
  if (isTask(n.type)) return !x.routes(n);
  if (n.type === "wait_event") return x.waitEdges(n.id)[1].length === 0;
  return false;
}

/** Every fork's arms and join: [Map fork → region, problems]. */
function regions(x) {
  const ps = [];
  const out = new Map();
  const joinedBy = new Map();
  const forks = x.g.nodes.filter((n) => n.type === "fork").map((n) => n.id).sort();
  for (const f of forks) {
    const fork = x.byID.get(f);
    const r = { fork: f, arms: [], join: "", cfg: null };
    let ok = true;
    const joins = new Set();
    x.outs(f).forEach((ei, k) => {
      const e = x.edge(ei);
      const a = { name: armLabel(e, k), nodes: [] };
      let cur = e.to;
      const seen = new Set();
      for (;;) {
        const n = x.byID.get(cur);
        if (!n) {
          ok = false;
          break;
        }
        if (n.type === "join") break;
        if (!armable(x, n)) {
          ps.push({ code: P.ARM_NOT_PLAIN, node: cur,
            message: `${displayName(n)} is in an arm of ${displayName(fork)}, and an arm holds plain steps; put the decision after the join, or in a sub-workflow` });
          ok = false;
          break;
        }
        if (x.ins(cur).length !== 1 || seen.has(cur)) {
          ps.push({ code: P.UNSTRUCTURED, node: cur, message: `${displayName(n)} is in an arm of ${displayName(fork)} and is reached from outside it` });
          ok = false;
          break;
        }
        seen.add(cur);
        a.nodes.push(cur);
        if (x.outs(cur).length !== 1) {
          ok = false;
          break;
        }
        cur = x.edge(x.outs(cur)[0]).to;
      }
      if (!ok) return;
      if (a.nodes.length === 0) {
        ps.push({ code: P.EMPTY_ARM, node: f, edge: ref(e), message: `an arm of ${displayName(fork)} goes straight to the join; an arm holds at least one step` });
        ok = false;
        return;
      }
      joins.add(cur);
      r.join = cur;
      r.arms.push(a);
    });
    if (!ok || r.arms.length < 2) continue;
    if (joins.size !== 1) {
      ps.push({ code: P.UNSTRUCTURED, node: f, message: `the arms of ${displayName(fork)} do not meet at one join` });
      continue;
    }
    if (x.ins(r.join).length !== r.arms.length) {
      ps.push({ code: P.UNSTRUCTURED, node: r.join, message: `${x.name(r.join)} is reached from outside ${displayName(fork)}; a join closes one fork` });
      continue;
    }
    if (joinedBy.has(r.join)) {
      ps.push({ code: P.UNSTRUCTURED, node: r.join, message: `${x.name(r.join)} closes both ${x.name(joinedBy.get(r.join))} and ${displayName(fork)}` });
      continue;
    }
    joinedBy.set(r.join, f);
    r.cfg = readJoin(object(x.byID.get(r.join).config) ?? {})[0];
    if (r.cfg.join === "quorum" && r.cfg.quorum > r.arms.length) {
      ps.push({ code: P.QUORUM, node: r.join, message: `${x.name(r.join)}: at least ${r.cfg.quorum} of ${r.arms.length} arms can never be reached` });
      continue;
    }
    out.set(f, r);
  }
  const reachedJoin = new Set();
  for (const f of forks) {
    const seen = new Set();
    const stack = [f];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      if (x.byID.get(id)?.type === "join") {
        reachedJoin.add(id);
        continue;
      }
      for (const i of x.outs(id)) stack.push(x.edge(i).to);
    }
  }
  for (const n of x.g.nodes) {
    if (n.type === "join" && !reachedJoin.has(n.id))
      ps.push({ code: P.JOIN, node: n.id, message: `${displayName(n)} joins nothing: a join closes the arms of one fork` });
  }
  return [out, ps];
}

function cycles(x, reached) {
  const ps = [];
  for (const scc of sccs(x, reached)) {
    const inside = new Set(scc);
    let looped = scc.length > 1;
    let exits = false;
    for (const id of scc) {
      for (const i of x.outs(id)) {
        const to = x.edge(i).to;
        if (to === id) looped = true;
        if (!inside.has(to)) exits = true;
      }
    }
    if (looped && !exits) ps.push({ code: P.CYCLE, node: scc[0], message: `the loop through ${x.name(scc[0])} has no way out` });
  }
  return ps;
}

function sccs(x, reached) {
  const ids = [...reached].sort();
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const out = [];
  let next = 0;
  const strong = (v) => {
    index.set(v, next);
    low.set(v, next);
    next++;
    stack.push(v);
    onStack.add(v);
    for (const i of x.outs(v)) {
      const w = x.edge(i).to;
      if (!index.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), index.get(w)));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp = [];
      for (;;) {
        const w = stack.pop();
        onStack.delete(w);
        comp.push(w);
        if (w === v) break;
      }
      out.push(comp.sort());
    }
  };
  for (const id of ids) if (!index.has(id)) strong(id);
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

function dominators(x) {
  const reached = reach(x);
  const all = x.g.nodes.filter((n) => reached.has(n.id)).map((n) => n.id);
  const start = x.g.nodes.find((n) => n.type === "start")?.id;
  const dom = new Map();
  for (const id of all) dom.set(id, id === start ? new Set([id]) : new Set(all));
  const ids = [...all].sort();
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of ids) {
      if (id === start) continue;
      let meet = null;
      for (const i of x.ins(id)) {
        const p = x.edge(i).from;
        if (!reached.has(p)) continue;
        if (meet === null) meet = new Set(dom.get(p));
        else for (const k of [...meet]) if (!dom.get(p).has(k)) meet.delete(k);
      }
      if (meet === null) meet = new Set();
      meet.add(id);
      if (meet.size !== dom.get(id).size) {
        dom.set(id, meet);
        changed = true;
      }
    }
  }
  return dom;
}

function validateScope(x, options, conditions) {
  const ps = [];
  const dom = dominators(x);
  const [regs] = regions(x);
  const armDone = (at) => {
    const out = new Set();
    for (const r of regs.values()) {
      if (r.cfg.join !== "all" || !dom.get(at)?.has(r.join)) continue;
      for (const a of r.arms) for (const id of a.nodes) out.add(id);
    }
    return out;
  };
  const check = (n, e, raw) => {
    const [parsed, err] = tryParse(conditions, raw);
    if (err) return;
    const done = armDone(n.id);
    const d = dom.get(n.id) ?? new Set();
    for (const f of conditions.fields(parsed)) {
      const parts = f.split(".");
      let p = null;
      if (parts[0] === "steps") {
        if (parts.length < 2) continue;
        const target = x.byID.get(parts[1]);
        if (!target || target.type === "start" || target.type === "join") {
          p = { code: P.UNKNOWN_STEP, node: n.id, message: `${displayName(n)} reads ${f}, which is not a step of this workflow` };
        } else {
          const happened = (target.id !== n.id && d.has(target.id)) || (target.id === n.id && isTask(n.type)) || done.has(target.id);
          if (!happened) p = { code: P.SCOPE, node: n.id, message: `${displayName(n)} reads ${f} before ${displayName(target)} has happened` };
        }
      } else if (parts[0] === "event") {
        if (options.trigger === "event") continue;
        const waited = [...d].some((id) => id !== n.id && x.byID.get(id)?.type === "wait_event");
        if (!waited)
          p = { code: P.SCOPE, node: n.id,
            message: `${displayName(n)} reads ${f}, but no event has happened by then: the run was not started by one and no wait comes before it` };
      }
      if (p) {
        if (e) p.edge = ref(e);
        ps.push(p);
      }
    }
  };
  for (const n of x.g.nodes) {
    if (n.type === "condition") check(n, null, (object(n.config) ?? {}).when);
    else if (x.chooses(n)) for (const i of x.outs(n.id)) if (hasWhen(x.edge(i))) check(n, x.edge(i), x.edge(i).when);
  }
  return ps;
}

/* ── compiling ── */

/**
 * Compile a graph into the engine's steps: {steps} or {problems}. The same
 * rows core writes, in the same order.
 */
export function compile(g, options = {}) {
  const problems = validate(g, options);
  if (problems.length) return { problems };
  const x = new Index(g);
  const [regs] = regions(x);
  const c = new Compiler(x, regs);
  c.order();
  c.decideImplicitEnd();
  c.rows.forEach((id, i) => c.emit(i, id));
  return { steps: c.steps };
}

class Compiler {
  constructor(x, regs) {
    this.x = x;
    this.regs = regs;
    this.rows = [];
    this.pos = new Map();
    this.silent = "";
    this.steps = [];
  }
  succs(id) {
    const x = this.x;
    const n = x.byID.get(id);
    const out = [];
    if (n.type === "fork") {
      const r = this.regs.get(id);
      const es = x.outs(r.join);
      if (es.length === 1) out.push(x.edge(es[0]).to);
    } else if (x.chooses(n)) {
      let def = "";
      for (const i of x.outs(id)) {
        const e = x.edge(i);
        if (e.default) def = e.to;
        else out.push(e.to);
      }
      if (def) out.push(def);
    } else if (n.type === "wait_event") {
      const [normal, timeout] = x.waitEdges(id);
      for (const i of [...normal, ...timeout]) out.push(x.edge(i).to);
    } else {
      for (const i of x.outs(id)) out.push(x.edge(i).to);
    }
    return out;
  }
  order() {
    const start = this.x.g.nodes.find((n) => n.type === "start").id;
    const visited = new Set();
    const post = [];
    const visit = (id) => {
      visited.add(id);
      const ss = this.succs(id);
      for (let i = ss.length - 1; i >= 0; i--) if (!visited.has(ss[i])) visit(ss[i]);
      post.push(id);
    };
    visit(start);
    for (let i = post.length - 1; i >= 0; i--) {
      if (post[i] === start) continue;
      this.pos.set(post[i], this.rows.length);
      this.rows.push(post[i]);
    }
  }
  next(id) {
    const x = this.x;
    const n = x.byID.get(id);
    if (n.type === "fork") return this.succs(id)[0] ?? "";
    if (n.type === "wait_event") {
      const [normal] = x.waitEdges(id);
      return normal.length ? x.edge(normal[0]).to : "";
    }
    if (x.chooses(n) || n.type === "end") return "";
    const es = x.outs(id);
    return es.length ? x.edge(es[0]).to : "";
  }
  decideImplicitEnd() {
    if (this.rows.length < 2) return;
    const last = this.rows[this.rows.length - 1];
    const n = this.x.byID.get(last);
    if (n.type !== "end" || !n.implicit) return;
    const prev = this.rows[this.rows.length - 2];
    if (this.next(prev) !== last) return;
    for (const id of this.rows.slice(0, -1)) {
      if (id === prev) continue;
      if (this.succs(id).includes(last)) return;
    }
    if (this.x.byID.get(prev).type !== "fork") {
      for (const i of this.x.ins(last)) if (this.x.edge(i).from !== prev) return;
    }
    this.silent = last;
  }
  stepName(id) {
    const n = this.x.byID.get(id);
    const s = typeof n.name === "string" ? n.name.trim() : "";
    return s || n.id;
  }
  add(s) {
    this.steps.push(s);
  }
  emit(i, id) {
    const x = this.x;
    const n = x.byID.get(id);
    const following = this.rows[i + 1] ?? "";
    if (n.type === "end") {
      if (id === this.silent) return;
      this.add({ code: id, name: this.stepName(id), kind: "end", config: canon(object(n.config) ?? {}) });
      return;
    }
    if (n.type === "condition") {
      const cfg = object(n.config) ?? {};
      let yes = "";
      let no = "";
      for (const ei of x.outs(id)) {
        const e = x.edge(ei);
        if (e.default) no = e.to;
        else yes = e.to;
      }
      const branch = { cases: [{ when: cfg.when ?? null, goto: yes }], default: no };
      this.passes(branch, id, [yes, no]);
      this.add({ code: id, name: this.stepName(id), kind: "branch", config: canon(branch) });
      return;
    }
    if (n.type === "decision") {
      this.add({ code: id, name: this.stepName(id), kind: "branch", config: this.choice(id, "") });
      return;
    }
    if (n.type === "fork") {
      this.fork(id);
    } else {
      const cfg = object(n.config) ?? {};
      if (n.type === "wait_event") {
        const [, timeout] = x.waitEdges(id);
        if (timeout.length) cfg.on_timeout = `branch:${x.edge(timeout[0]).to}`;
      }
      this.add({ code: id, name: this.stepName(id), kind: n.type, config: canon(cfg) });
      if (x.routes(n)) {
        this.add({ code: id + SUFFIX_ROUTE, name: `After ${this.stepName(id)}`, kind: "branch", config: this.choice(id, id) });
        return;
      }
    }
    const to = this.next(id);
    if (!to || to === following) return;
    const jump = { cases: [], default: to };
    this.passes(jump, id, [to]);
    this.add({ code: id + SUFFIX_GOTO, name: `Go to ${this.stepName(to)}`, kind: "branch", config: canon(jump) });
  }
  choice(id, outcomeOf) {
    const x = this.x;
    const cases = [];
    let def = "";
    const targets = [];
    for (const ei of x.outs(id)) {
      const e = x.edge(ei);
      targets.push(e.to);
      if (e.default) {
        def = e.to;
        continue;
      }
      const when = hasWhen(e) ? e.when : { field: `steps.${outcomeOf}.output.outcome`, op: "is", value: e.label };
      cases.push({ when, goto: e.to });
    }
    const branch = { cases, default: def };
    this.passes(branch, id, targets);
    return canon(branch);
  }
  passes(branch, from, targets) {
    const at = this.pos.get(from);
    let least = 0;
    for (const t of targets) {
      const p = this.pos.get(t);
      if (p === undefined || p > at) continue;
      const m = this.x.byID.get(t).max_passes ?? 0;
      if (m > 0 && (least === 0 || m < least)) least = m;
    }
    if (least > 0) branch.max_passes = least;
  }
  fork(id) {
    const r = this.regs.get(id);
    const arms = {};
    for (const a of r.arms) arms[a.name] = [...a.nodes];
    const cfg = { arms, join: r.cfg.join };
    if (r.cfg.join === "quorum") cfg.quorum = r.cfg.quorum;
    this.add({ code: id, name: this.stepName(id), kind: "parallel", config: canon(cfg) });
    for (const a of r.arms) {
      for (const nid of a.nodes) {
        const n = this.x.byID.get(nid);
        this.add({ code: nid, name: this.stepName(nid), kind: n.type, config: canon(object(n.config) ?? {}), parent: id, branch: a.name });
      }
    }
  }
}

/* ── decompiling ── */

export class NotDrawableError extends Error {
  constructor(message) {
    super(`these steps cannot be drawn yet: ${message}`);
    this.name = "NotDrawableError";
  }
}

const intOf = (v) => (Number.isInteger(v) ? v : null);

/** Steps back into a graph, as core does; throws NotDrawableError rather than guessing. */
export function decompile(steps) {
  const g = { format: FORMAT, nodes: [], edges: [] };
  const top = [];
  const children = new Map();
  const taken = new Set();
  for (const s of steps) {
    taken.add(s.code);
    if (!s.parent) {
      top.push(s);
      continue;
    }
    if (!children.has(s.parent)) children.set(s.parent, new Map());
    const arms = children.get(s.parent);
    if (!arms.has(s.branch ?? "")) arms.set(s.branch ?? "", []);
    arms.get(s.branch ?? "").push(s);
  }
  const fresh = (want) => {
    let id = want;
    for (let i = 1; taken.has(id); i++) id = `${want}--${i}`;
    taken.add(id);
    return id;
  };
  const start = fresh("start");
  g.nodes.push({ id: start, type: "start" });
  let implicit = "";
  const end = () => {
    if (!implicit) {
      implicit = fresh("end");
      g.nodes.push({ id: implicit, type: "end", implicit: true });
    }
    return implicit;
  };
  const edge = (e) => g.edges.push(e);
  const position = new Map(top.map((s, i) => [s.code, i]));
  const maxPasses = new Map();
  const goesBack = (from, to, m) => {
    if (!m || m <= 0) return;
    const p = position.get(to);
    if (p !== undefined && p <= from && (!maxPasses.has(to) || m < maxPasses.get(to))) maxPasses.set(to, m);
  };
  const named = (n, s) => {
    if (s.name !== s.code) n.name = s.name;
    return n;
  };
  const withConfig = (n, cfg) => {
    if (Object.keys(cfg).length > 0) n.config = cfg;
    return n;
  };
  const onwardFrom = (i) => (i < top.length ? top[i].code : end());
  const consumed = new Set();
  const onward = (i) => {
    if (i + 1 < top.length && top[i + 1].code === top[i].code + SUFFIX_GOTO) {
      consumed.add(i + 1);
      const cfg = object(top[i + 1].config) ?? {};
      const to = typeof cfg.default === "string" ? cfg.default : "";
      goesBack(i, to, intOf(cfg.max_passes));
      return to || onwardFrom(i + 2);
    }
    return onwardFrom(i + 1);
  };
  if (top.length === 0) edge({ from: start, to: end() });
  else edge({ from: start, to: top[0].code });
  top.forEach((s, i) => {
    if (consumed.has(i)) return;
    if (s.code.includes("--")) throw new NotDrawableError(`${s.code} was made by the compiler, and nothing before it explains it`);
    const cfg = object(s.config);
    if (cfg === null) throw new NotDrawableError(`${s.code}'s settings are not an object`);
    if (s.kind === "branch") {
      const [cases, def0, m] = readBranch(cfg);
      if (cases.length === 0) throw new NotDrawableError(`${s.code} is a jump with nothing to jump from`);
      const def = def0 || onwardFrom(i + 1);
      for (const cs of cases) goesBack(i, cs.to, m);
      goesBack(i, def, m);
      if (cases.length === 1) {
        g.nodes.push(named({ id: s.code, type: "condition", config: { when: cases[0].when } }, s));
        edge({ from: s.code, to: cases[0].to, label: "yes" });
        edge({ from: s.code, to: def, label: "no", default: true });
        return;
      }
      g.nodes.push(named({ id: s.code, type: "decision" }, s));
      cases.forEach((cs, k) => edge({ from: s.code, to: cs.to, label: `case-${k + 1}`, when: cs.when }));
      edge({ from: s.code, to: def, label: "otherwise", default: true });
      return;
    }
    if (s.kind === "end") {
      g.nodes.push(withConfig(named({ id: s.code, type: "end" }, s), cfg));
      return;
    }
    if (s.kind === "parallel") {
      const join = decompileFork(g, s, cfg, children.get(s.code) ?? new Map(), fresh);
      edge({ from: join, to: onward(i) });
      return;
    }
    if (!isStepType(s.kind)) throw new NotDrawableError(`${s.code} is a ${s.kind} step, which the canvas does not draw yet`);
    if (isTask(s.kind)) delete cfg.task_type;
    let timeoutTo = "";
    if (s.kind === "wait_event" && typeof cfg.on_timeout === "string" && cfg.on_timeout.startsWith("branch:")) {
      timeoutTo = cfg.on_timeout.slice("branch:".length);
      delete cfg.on_timeout;
    }
    g.nodes.push(withConfig(named({ id: s.code, type: s.kind }, s), cfg));
    if (isTask(s.kind) && i + 1 < top.length && top[i + 1].code === s.code + SUFFIX_ROUTE && top[i + 1].kind === "branch") {
      consumed.add(i + 1);
      const [cases, def0, m] = readBranch(object(top[i + 1].config) ?? {});
      const def = def0 || onwardFrom(i + 2);
      cases.forEach((cs, k) => {
        goesBack(i, cs.to, m);
        const label = outcomeCase(cs.when, s.code);
        if (label) edge({ from: s.code, to: cs.to, label });
        else edge({ from: s.code, to: cs.to, label: `case-${k + 1}`, when: cs.when });
      });
      goesBack(i, def, m);
      edge({ from: s.code, to: def, label: "otherwise", default: true });
      return;
    }
    edge({ from: s.code, to: onward(i) });
    if (timeoutTo) edge({ from: s.code, to: timeoutTo, label: TIMEOUT_LABEL });
  });
  for (const n of g.nodes) if (maxPasses.has(n.id)) n.max_passes = maxPasses.get(n.id);
  return g;
}

function readBranch(cfg) {
  const cases = (Array.isArray(cfg.cases) ? cfg.cases : []).map((c, i) => {
    if (!isObject(c)) throw new NotDrawableError(`case ${i + 1} is not an object`);
    return { when: c.when ?? [], to: typeof c.goto === "string" ? c.goto : "" };
  });
  return [cases, typeof cfg.default === "string" ? cfg.default : "", intOf(cfg.max_passes) ?? 0];
}

function outcomeCase(when, code) {
  if (!isObject(when) || Object.keys(when).length !== 3) return "";
  if (when.field !== `steps.${code}.output.outcome` || when.op !== "is" || typeof when.value !== "string") return "";
  return when.value;
}

function decompileFork(g, s, cfg, arms, fresh) {
  const fork = { id: s.code, type: "fork" };
  if (s.name !== s.code) fork.name = s.name;
  g.nodes.push(fork);
  const joinID = fresh(s.code + SUFFIX_JOIN);
  for (const name of [...arms.keys()].sort()) {
    let prev = s.code;
    let label = name;
    for (const child of arms.get(name)) {
      if (!isStepType(child.kind)) throw new NotDrawableError(`${child.code} in an arm of ${s.code} is a ${child.kind} step`);
      const ccfg = object(child.config);
      if (ccfg === null) throw new NotDrawableError(`${child.code}'s settings are not an object`);
      if (isTask(child.kind)) delete ccfg.task_type;
      const n = { id: child.code, type: child.kind };
      if (child.name !== child.code) n.name = child.name;
      if (Object.keys(ccfg).length > 0) n.config = ccfg;
      g.nodes.push(n);
      g.edges.push(label ? { from: prev, to: child.code, label } : { from: prev, to: child.code });
      prev = child.code;
      label = "";
    }
    g.edges.push(label ? { from: prev, to: joinID, label } : { from: prev, to: joinID });
  }
  const join = { join: typeof cfg.join === "string" && cfg.join ? cfg.join : "all" };
  if (join.join === "quorum" && Number.isInteger(cfg.quorum)) join.quorum = cfg.quorum;
  g.nodes.push({ id: joinID, type: "join", config: join });
  return joinID;
}
