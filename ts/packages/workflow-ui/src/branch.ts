/**
 * A node's branch: the node and every node that can only be reached through
 * it. Removing a branch never takes a step another path still needs — an end
 * shared with another branch, or a step a loop reaches from before the node,
 * stays.
 */
import type { Graph } from "./types.js";

function reachable(g: Graph, from: string[], without?: string): Set<string> {
  const outs = new Map<string, string[]>();
  for (const e of g.edges) outs.set(e.from, [...(outs.get(e.from) ?? []), e.to]);
  const seen = new Set<string>();
  const stack = from.filter((id) => id !== without);
  while (stack.length) {
    const at = stack.pop()!;
    if (seen.has(at)) continue;
    seen.add(at);
    for (const to of outs.get(at) ?? []) if (to !== without && !seen.has(to)) stack.push(to);
  }
  return seen;
}

/** The ids a branch removal takes, in the graph's node order; never the start. */
export function branchOf(g: Graph, id: string): string[] {
  const node = g.nodes.find((n) => n.id === id);
  if (!node || node.type === "start") return [];
  const starts = g.nodes.filter((n) => n.type === "start").map((n) => n.id);
  const kept = reachable(g, starts, id);
  const after = reachable(g, [id]);
  return g.nodes.filter((n) => n.type !== "start" && after.has(n.id) && !kept.has(n.id)).map((n) => n.id);
}
