/**
 * What a graph comes to: its problems, its compiled steps, and the order the
 * editor lists nodes in. One function, so the canvas, the List tab and the
 * Steps panel can never disagree about any of it.
 */
import * as conditions from "@zavon/conditions";
import { compile, nodeOf, validate, NotDrawableError } from "@zavon/workflow-graph";
import type { Graph, GraphEdge, Problem, Step } from "./types.js";

export type Analysis = {
  /** The browser's twin's problems, then any the server added. */
  problems: Problem[];
  /** The compiled steps, when the graph compiles. */
  steps: Step[] | null;
  /** Node ids in the order the List tab shows them: compiled order when it compiles. */
  order: string[];
  /** The fork a node sits in an arm of, and the arm's name. */
  arms: Map<string, { fork: string; arm: string }>;
  /** Problems by node id, and by edge key (edgeKey). */
  byNode: Map<string, Problem[]>;
  byEdge: Map<string, Problem[]>;
};

export const edgeKey = (e: Pick<GraphEdge, "from" | "to" | "label">) => `${e.from}\u0000${e.to}\u0000${e.label ?? ""}`;

const graphConditions = { parse: conditions.parse, fields: conditions.fields } as const;

function safeValidate(g: Graph, trigger: string): Problem[] {
  try {
    return validate(g, { trigger, conditions: graphConditions });
  } catch (e) {
    if (e instanceof NotDrawableError || e instanceof Error) return [{ code: "graph_error", message: e.message }];
    return [{ code: "graph_error", message: String(e) }];
  }
}

/** The order nodes are met walking from the start, edges in their written order. */
function walkOrder(g: Graph): string[] {
  const outs = new Map<string, string[]>();
  for (const e of g.edges) {
    if (!outs.has(e.from)) outs.set(e.from, []);
    outs.get(e.from)!.push(e.to);
  }
  const seen = new Set<string>();
  const order: string[] = [];
  const queue = g.nodes.filter((n) => n.type === "start").map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    queue.push(...(outs.get(id) ?? []));
  }
  for (const n of g.nodes) if (!seen.has(n.id)) order.push(n.id);
  return order;
}

export function analyse(g: Graph, options: { trigger?: string; serverProblems?: Problem[] } = {}): Analysis {
  const trigger = options.trigger ?? "";
  const local = safeValidate(g, trigger);
  let steps: Step[] | null = null;
  if (local.length === 0) {
    try {
      const out = compile(g, { trigger, conditions: graphConditions });
      steps = out.steps ?? null;
    } catch {
      steps = null;
    }
  }

  const arms = new Map<string, { fork: string; arm: string }>();
  let order: string[];
  if (steps) {
    const ids = new Set(g.nodes.map((n) => n.id));
    const seen = new Set<string>();
    order = [];
    const start = g.nodes.find((n) => n.type === "start");
    if (start) {
      order.push(start.id);
      seen.add(start.id);
    }
    // Top-level steps in order, each block followed by its arms' steps.
    const top = steps.filter((s) => !s.parent);
    const children = steps.filter((s) => s.parent);
    const add = (id: string) => {
      if (ids.has(id) && !seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    };
    for (const s of top) {
      add(nodeOf(s.code));
      if (s.kind === "parallel") {
        for (const c of children.filter((c) => c.parent === s.code)) {
          add(c.code);
          arms.set(c.code, { fork: s.code, arm: c.branch ?? "" });
        }
        // The join is not a step; it follows its arms.
        const join = g.edges.find((e) => children.some((c) => c.parent === s.code && c.code === e.from))?.to;
        if (join) add(join);
      }
    }
    for (const id of walkOrder(g)) add(id);
  } else {
    order = walkOrder(g);
  }

  const problems: Problem[] = [];
  const byNode = new Map<string, Problem[]>();
  const byEdge = new Map<string, Problem[]>();
  const seenProblem = new Set<string>();
  for (const p of [...local, ...(options.serverProblems ?? [])]) {
    const sig = `${p.code}\u0000${p.node ?? ""}\u0000${p.edge ? edgeKey(p.edge) : ""}\u0000${p.message}`;
    if (seenProblem.has(sig)) continue;
    seenProblem.add(sig);
    problems.push(p);
    if (p.edge) {
      const k = edgeKey(p.edge);
      byEdge.set(k, [...(byEdge.get(k) ?? []), p]);
    }
    if (p.node) byNode.set(p.node, [...(byNode.get(p.node) ?? []), p]);
  }
  return { problems, steps, order, arms, byNode, byEdge };
}

/** "1 problem", "3 problems". */
export const problemCount = (n: number) => `${n} problem${n === 1 ? "" : "s"}`;

/**
 * The nodes a simulated path passes. The server names the nodes whose steps
 * it walked; the start is where every path begins, and a join is passed when
 * the walk went into it and on out of it — neither is a step of its own.
 */
export function pathNodes(g: Graph, path: string[]): Set<string> {
  const on = new Set(path);
  if (path.length === 0) return on;
  for (const n of g.nodes) if (n.type === "start") on.add(n.id);
  for (const n of g.nodes) {
    if (n.type !== "join") continue;
    const inOn = g.edges.some((e) => e.to === n.id && on.has(e.from));
    const outOn = g.edges.some((e) => e.from === n.id && on.has(e.to));
    if (inOn && outOn) on.add(n.id);
  }
  return on;
}
