/**
 * Auto-layout: layered, top to bottom, for the few dozen nodes a workflow
 * has. A short Sugiyama: back-edges set aside, each node on the layer of its
 * longest path from the start, a few barycentre sweeps to cut crossings, and
 * each layer centred. Deterministic: the same graph lays out the same way.
 *
 * Only ever run on demand or for nodes with no stored position. A person's
 * arrangement is theirs; the editor never moves a node on its own.
 */
import type { Graph, Point } from "./types.js";

export const LAYOUT = Object.freeze({ columnGap: 230, rowGap: 120 });

/** Edges that close a cycle, found by a depth-first walk from the start. */
export function backEdges(g: Graph): Set<number> {
  const outs = new Map<string, number[]>();
  g.edges.forEach((e, i) => {
    if (!outs.has(e.from)) outs.set(e.from, []);
    outs.get(e.from)!.push(i);
  });
  const back = new Set<number>();
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const i of outs.get(id) ?? []) {
      const to = g.edges[i].to;
      const s = state.get(to);
      if (s === 1) back.add(i);
      else if (s === undefined) visit(to);
    }
    state.set(id, 2);
  };
  const roots = [...g.nodes.filter((n) => n.type === "start"), ...g.nodes.filter((n) => n.type !== "start")];
  for (const n of roots) if (!state.has(n.id)) visit(n.id);
  return back;
}

/** Positions for every node. */
export function autoLayout(g: Graph): Record<string, Point> {
  const ids = g.nodes.map((n) => n.id);
  const known = new Set(ids);
  const back = backEdges(g);
  const forward = g.edges.filter((e, i) => !back.has(i) && known.has(e.from) && known.has(e.to) && e.from !== e.to);
  const succ = new Map<string, string[]>(ids.map((id) => [id, []]));
  const pred = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of forward) {
    succ.get(e.from)!.push(e.to);
    pred.get(e.to)!.push(e.from);
  }

  // Layers: longest path, in a topological order (Kahn, ties by graph order).
  const indegree = new Map(ids.map((id) => [id, pred.get(id)!.length]));
  const queue = ids.filter((id) => indegree.get(id) === 0);
  queue.sort((a, b) => Number(g.nodes.find((n) => n.id === b)?.type === "start") - Number(g.nodes.find((n) => n.id === a)?.type === "start"));
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const to of succ.get(id)!) {
      layer.set(to, Math.max(layer.get(to)!, layer.get(id)! + 1));
      indegree.set(to, indegree.get(to)! - 1);
      if (indegree.get(to) === 0) queue.push(to);
    }
  }

  const layers: string[][] = [];
  for (const id of order) {
    const l = layer.get(id)!;
    (layers[l] ??= []).push(id);
  }

  // Crossing reduction: barycentres, down then up, a few times.
  const pos = new Map<string, number>();
  const index = () => layers.forEach((row) => row.forEach((id, i) => pos.set(id, i)));
  index();
  const sweep = (row: string[], neighbours: Map<string, string[]>) => {
    const bary = new Map<string, number>();
    row.forEach((id, i) => {
      const ns = neighbours.get(id)!.filter((n) => pos.has(n));
      bary.set(id, ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : i);
    });
    row.sort((a, b) => bary.get(a)! - bary.get(b)! || pos.get(a)! - pos.get(b)!);
    row.forEach((id, i) => pos.set(id, i));
  };
  for (let pass = 0; pass < 4; pass++) {
    for (let l = 1; l < layers.length; l++) sweep(layers[l], pred);
    for (let l = layers.length - 2; l >= 0; l--) sweep(layers[l], succ);
  }

  const out: Record<string, Point> = {};
  layers.forEach((row, l) => {
    row.forEach((id, i) => {
      out[id] = { x: Math.round((i - (row.length - 1) / 2) * LAYOUT.columnGap), y: l * LAYOUT.rowGap };
    });
  });
  return out;
}

/**
 * The stored layout, with a position worked out for every node that has
 * none. Placed by the auto-layout of the whole graph, so a graph drawn by
 * the decompiler (no layout at all) arrives tidy.
 */
export function positions(g: Graph): Record<string, Point> {
  const stored = (g.layout ?? {}) as Record<string, Point>;
  const missing = g.nodes.some((n) => !isPoint(stored[n.id]));
  if (!missing) return stored;
  const auto = autoLayout(g);
  const out: Record<string, Point> = {};
  for (const n of g.nodes) out[n.id] = isPoint(stored[n.id]) ? stored[n.id] : auto[n.id];
  return out;
}

function isPoint(p: unknown): p is Point {
  return !!p && typeof p === "object" && Number.isFinite((p as Point).x) && Number.isFinite((p as Point).y);
}
