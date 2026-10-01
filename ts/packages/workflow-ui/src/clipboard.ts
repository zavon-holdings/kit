/**
 * Copying and pasting nodes, and whole sub-trees, as pure functions.
 *
 * A copy is a fragment: the nodes, the edges BETWEEN them (an edge to a node
 * left behind has nowhere to land), and their positions relative to the
 * fragment's top-left corner. Pasting gives every node an id not yet in the
 * graph and rewrites the references the fragment makes to its own steps
 * (`steps.<id>.…` in a condition or a template), so a pasted decision reads
 * the pasted review, not the original.
 *
 * The start is never copied: a graph has one, and it is the definition's.
 */
import { freshId, layoutOf, nodeById, setPosition } from "./model.js";
import { positions } from "./layout.js";
import type { Graph, GraphEdge, GraphNode, Point } from "./types.js";

export const FRAGMENT_FORMAT = "workflow.fragment/1";

export type Fragment = {
  format: typeof FRAGMENT_FORMAT;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Positions relative to the fragment's top-left node corner. */
  layout: Record<string, Point>;
};

/** The ids a sub-tree from `id` holds: it and everything reachable from it, never the start. */
export function subtree(g: Graph, id: string): string[] {
  const outs = new Map<string, string[]>();
  for (const e of g.edges) outs.set(e.from, [...(outs.get(e.from) ?? []), e.to]);
  const seen = new Set<string>();
  const order: string[] = [];
  const stack = [id];
  while (stack.length) {
    const at = stack.shift()!;
    if (seen.has(at)) continue;
    const n = nodeById(g, at);
    if (!n || n.type === "start") continue;
    seen.add(at);
    order.push(at);
    stack.push(...(outs.get(at) ?? []));
  }
  return order;
}

/** A fragment of the named nodes (the start left out), in the graph's node order. */
export function copyNodes(g: Graph, ids: Iterable<string>): Fragment {
  const want = new Set(ids);
  const nodes = g.nodes.filter((n) => want.has(n.id) && n.type !== "start").map((n) => structuredClone(n));
  const kept = new Set(nodes.map((n) => n.id));
  const edges = g.edges.filter((e) => kept.has(e.from) && kept.has(e.to)).map((e) => structuredClone(e));
  const at = positions(g);
  const xs = nodes.map((n) => at[n.id]?.x ?? 0);
  const ys = nodes.map((n) => at[n.id]?.y ?? 0);
  const x0 = xs.length ? Math.min(...xs) : 0;
  const y0 = ys.length ? Math.min(...ys) : 0;
  const layout: Record<string, Point> = {};
  for (const n of nodes) layout[n.id] = { x: (at[n.id]?.x ?? 0) - x0, y: (at[n.id]?.y ?? 0) - y0 };
  return { format: FRAGMENT_FORMAT, nodes, edges, layout };
}

/** Reads a fragment from text (the system clipboard); null when it is not one. */
export function parseFragment(text: string): Fragment | null {
  try {
    const v = JSON.parse(text) as Partial<Fragment>;
    if (!v || v.format !== FRAGMENT_FORMAT || !Array.isArray(v.nodes) || !Array.isArray(v.edges)) return null;
    for (const n of v.nodes) if (!n || typeof n.id !== "string" || typeof n.type !== "string") return null;
    for (const e of v.edges) if (!e || typeof e.from !== "string" || typeof e.to !== "string") return null;
    return { format: FRAGMENT_FORMAT, nodes: v.nodes, edges: v.edges, layout: (v.layout ?? {}) as Record<string, Point> };
  } catch {
    return null;
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every string in a value with `steps.<old>.` (and `steps.<old>` at the end) renamed. */
function renameReferences<T>(value: T, renames: Map<string, string>): T {
  if (renames.size === 0) return value;
  const patterns = [...renames].map(([from, to]) => [new RegExp(`(^|[^a-z0-9_-])steps\\.${escape(from)}(?=$|[.\\s}])`, "g"), `$1steps.${to}`] as const);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return patterns.reduce((s, [re, to]) => s.replace(re, to), v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/**
 * Pastes a fragment: fresh ids, its own references followed, its edges
 * re-pointed, placed with its top-left corner at `at` (or beside where it
 * was copied from). Answers the new graph and the pasted ids, in order.
 */
export function pasteFragment(g: Graph, fragment: Fragment, at?: Point): { graph: Graph; ids: string[] } {
  const pasteable = fragment.nodes.filter((n) => n.type !== "start");
  if (pasteable.length === 0) return { graph: g, ids: [] };
  let graph: Graph = g;
  const renames = new Map<string, string>();
  for (const n of pasteable) {
    const id = freshId(graph, n.id);
    renames.set(n.id, id);
    // Reserve the id so the next fresh one cannot take it.
    graph = { ...graph, nodes: [...graph.nodes, { id, type: n.type }] };
  }
  const renamed = new Map([...renames].filter(([from, to]) => from !== to));
  const nodes: GraphNode[] = pasteable.map((n) => {
    const out: GraphNode = { ...structuredClone(n), id: renames.get(n.id)! };
    if (out.config) out.config = renameReferences(out.config, renamed);
    return out;
  });
  const edges: GraphEdge[] = fragment.edges
    .filter((e) => renames.has(e.from) && renames.has(e.to))
    .map((e) => {
      const out: GraphEdge = { ...structuredClone(e), from: renames.get(e.from)!, to: renames.get(e.to)! };
      if (out.when !== undefined) out.when = renameReferences(out.when, renamed);
      return out;
    });
  graph = { ...g, nodes: [...g.nodes, ...nodes], edges: [...g.edges, ...edges] };

  // Where: at the point asked, else a step down and right of the originals,
  // else below everything.
  let origin = at;
  if (!origin) {
    const stored = layoutOf(g);
    const first = pasteable.find((n) => stored[n.id]);
    if (first) {
      const rel = fragment.layout[first.id] ?? { x: 0, y: 0 };
      origin = { x: stored[first.id].x - rel.x + 40, y: stored[first.id].y - rel.y + 40 };
    } else {
      const all = Object.values(positions(g));
      origin = { x: 0, y: (all.length ? Math.max(...all.map((p) => p.y)) : 0) + 140 };
    }
  }
  for (const n of pasteable) {
    const rel = fragment.layout[n.id] ?? { x: 0, y: 0 };
    graph = setPosition(graph, renames.get(n.id)!, { x: origin.x + rel.x, y: origin.y + rel.y });
  }
  return { graph, ids: pasteable.map((n) => renames.get(n.id)!) };
}
