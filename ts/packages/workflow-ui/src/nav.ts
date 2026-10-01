/**
 * Keyboard movement between nodes, the same on the canvas and in the list.
 *
 *  - ArrowDown follows the node's first way out, ArrowUp its first way in:
 *    focus moves ALONG the edges;
 *  - ArrowRight and ArrowLeft step through the nodes in list order (the
 *    compiled order), so every node is reachable even across a fork;
 *  - Home and End go to the first and last node.
 */
import type { Graph } from "./types.js";

export function nextFocus(g: Graph, order: string[], from: string | null, key: string): string | null {
  if (order.length === 0) return null;
  const at = from ? order.indexOf(from) : -1;
  switch (key) {
    case "Home":
      return order[0];
    case "End":
      return order[order.length - 1];
    case "ArrowRight":
      return order[Math.min(order.length - 1, at + 1)] ?? null;
    case "ArrowLeft":
      return order[Math.max(0, at - 1)] ?? null;
    case "ArrowDown": {
      if (!from) return order[0];
      const e = g.edges.find((x) => x.from === from);
      return e ? e.to : null;
    }
    case "ArrowUp": {
      if (!from) return order[0];
      const e = g.edges.find((x) => x.to === from);
      return e ? e.from : null;
    }
    default:
      return null;
  }
}
