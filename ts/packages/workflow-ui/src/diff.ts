/**
 * What changed between two versions of a workflow: in the drawing (nodes and
 * edges) and in what runs (the compiled steps). Two different questions — a
 * renamed node changes the drawing and nothing that runs; a re-ordered case
 * changes what runs and barely the drawing — so they are answered apart.
 *
 * Layout is never a change: moving a box is not a new workflow.
 */
import { canon, sameSteps } from "@zavon/workflow-graph";
import type { Graph, GraphEdge, GraphNode, Step } from "./types.js";

export type Change = "added" | "removed" | "changed" | "same";

export type NodeDiff = {
  id: string;
  change: Change;
  before?: GraphNode;
  after?: GraphNode;
  /** What differs on a changed node: type, name, config, max_passes. */
  fields: string[];
};

export type EdgeDiff = {
  /** from → to, with the label when there is one. */
  key: string;
  change: Change;
  before?: GraphEdge;
  after?: GraphEdge;
  fields: string[];
};

export type GraphDiff = {
  nodes: NodeDiff[];
  edges: EdgeDiff[];
  counts: { added: number; removed: number; changed: number };
};

const same = (a: unknown, b: unknown) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

const edgeId = (e: GraphEdge) => `${e.from} → ${e.to}${e.label ? ` (${e.label})` : ""}`;

export function diffGraphs(before: Graph, after: Graph): GraphDiff {
  const a = new Map(before.nodes.map((n) => [n.id, n]));
  const b = new Map(after.nodes.map((n) => [n.id, n]));
  const nodes: NodeDiff[] = [];
  for (const n of before.nodes) {
    const m = b.get(n.id);
    if (!m) {
      nodes.push({ id: n.id, change: "removed", before: n, fields: [] });
      continue;
    }
    const fields: string[] = [];
    if (n.type !== m.type) fields.push("type");
    if ((n.name ?? "") !== (m.name ?? "")) fields.push("name");
    if (!same(n.config, m.config)) fields.push("config");
    if ((n.max_passes ?? 0) !== (m.max_passes ?? 0)) fields.push("max_passes");
    nodes.push({ id: n.id, change: fields.length ? "changed" : "same", before: n, after: m, fields });
  }
  for (const m of after.nodes) if (!a.has(m.id)) nodes.push({ id: m.id, change: "added", after: m, fields: [] });

  // Edges by from, to and label; their order among a node's ways out matters
  // to a decision, so a move is a change of "order".
  const order = (g: Graph, e: GraphEdge) => g.edges.filter((x) => x.from === e.from).indexOf(e);
  const ea = new Map(before.edges.map((e) => [edgeId(e), e]));
  const eb = new Map(after.edges.map((e) => [edgeId(e), e]));
  const edges: EdgeDiff[] = [];
  for (const e of before.edges) {
    const k = edgeId(e);
    const f = eb.get(k);
    if (!f) {
      edges.push({ key: k, change: "removed", before: e, fields: [] });
      continue;
    }
    const fields: string[] = [];
    if (!same(e.when, f.when)) fields.push("condition");
    if (!!e.default !== !!f.default) fields.push("default");
    if (order(before, e) !== order(after, f)) fields.push("order");
    edges.push({ key: k, change: fields.length ? "changed" : "same", before: e, after: f, fields });
  }
  for (const f of after.edges) if (!ea.has(edgeId(f))) edges.push({ key: edgeId(f), change: "added", after: f, fields: [] });

  const count = (c: Change) => nodes.filter((n) => n.change === c).length + edges.filter((e) => e.change === c).length;
  return { nodes, edges, counts: { added: count("added"), removed: count("removed"), changed: count("changed") } };
}

/** Per node, the word the canvas shows: added, removed or changed. Unchanged nodes are left out. */
export function nodeMarks(diff: GraphDiff, side: "before" | "after"): Record<string, Change> {
  const out: Record<string, Change> = {};
  for (const n of diff.nodes) {
    if (n.change === "same") continue;
    if (side === "before" && n.change === "added") continue;
    if (side === "after" && n.change === "removed") continue;
    out[n.id] = n.change;
  }
  return out;
}

export type StepRow = {
  code: string;
  change: Change | "moved";
  before?: Step;
  after?: Step;
  /** Why a changed step differs, in words. */
  why?: string;
};

/**
 * The compiled steps side by side, aligned by code: added, removed, changed
 * (behaviour), moved (the same step in another place), or the same. Rows in
 * the AFTER version's order, removed ones where they used to be.
 */
export function diffSteps(before: Step[], after: Step[]): StepRow[] {
  const a = new Map(before.map((s) => [s.code, s]));
  const b = new Map(after.map((s) => [s.code, s]));
  // A step moved when its place among the steps both versions share changed,
  // or it now sits in another block; a removal before it is not a move.
  const common = (list: Step[], other: Map<string, Step>) => list.filter((s) => other.has(s.code)).map((s) => s.code);
  const ia = new Map(common(before, b).map((c, i) => [c, i]));
  const ib = new Map(common(after, a).map((c, i) => [c, i]));
  const moved = (x: Step, y: Step) => ia.get(x.code) !== ib.get(y.code) || (x.parent ?? "") !== (y.parent ?? "") || (x.branch ?? "") !== (y.branch ?? "");
  const rows: StepRow[] = [];
  const placed = new Set<string>();
  const removedBefore = (code: string) => {
    // Emit removed steps that came before `code` in the old order.
    const at = before.findIndex((s) => s.code === code);
    for (const s of before.slice(0, at < 0 ? before.length : at)) {
      if (!b.has(s.code) && !placed.has(s.code)) {
        rows.push({ code: s.code, change: "removed", before: s });
        placed.add(s.code);
      }
    }
  };
  for (const s of after) {
    const old = a.get(s.code);
    if (old) removedBefore(s.code);
    if (!old) {
      rows.push({ code: s.code, change: "added", after: s });
    } else {
      const [ok, why] = sameSteps([old], [s]);
      const kindOrName = old.kind !== s.kind || old.name !== s.name;
      if (!ok || kindOrName) rows.push({ code: s.code, change: "changed", before: old, after: s, why: why || (old.name !== s.name ? "renamed" : "") });
      else if (moved(old, s)) rows.push({ code: s.code, change: "moved", before: old, after: s });
      else rows.push({ code: s.code, change: "same", before: old, after: s });
    }
    placed.add(s.code);
  }
  removedBefore("\u0000");
  return rows;
}
