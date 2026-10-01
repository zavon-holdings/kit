/**
 * Edits on several nodes at once — remove, move, align, distribute — and the
 * grid nodes snap to. Positions are presentation, so nothing here changes
 * what runs except removal, which goes through removeNode and so keeps its
 * rule: the start stays.
 */
import { positions } from "./layout.js";
import { removeNode, setLayout } from "./model.js";
import type { Graph, Point } from "./types.js";

/** The canvas's grid, in canvas units. */
export const GRID = 10;

/** A node's drawn size, for aligning edges and centres. */
export const NODE_SIZE = Object.freeze({ w: 190, h: 72 });

export function snap(p: Point, grid = GRID): Point {
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid };
}

/** Removes every named node (never the start) and the edges touching them. */
export function removeNodes(g: Graph, ids: Iterable<string>): Graph {
  let out = g;
  for (const id of ids) out = removeNode(out, id);
  return out;
}

/** Moves the named nodes by (dx, dy); every other node keeps its place. */
export function moveNodes(g: Graph, ids: Iterable<string>, dx: number, dy: number): Graph {
  const at = positions(g);
  const layout = { ...at };
  let moved = false;
  for (const id of ids) {
    if (!layout[id]) continue;
    layout[id] = { x: Math.round(layout[id].x + dx), y: Math.round(layout[id].y + dy) };
    moved = true;
  }
  return moved ? setLayout(g, layout) : g;
}

export type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";

/**
 * Lines the named nodes up along one edge or centre line of the group.
 * Every node is drawn the same size, so aligning left, centre or right all
 * line up the same corner; the three differ in WHICH line the group meets on.
 */
export function alignNodes(g: Graph, ids: string[], how: Alignment): Graph {
  const at = positions(g);
  const chosen = ids.filter((id) => at[id]);
  if (chosen.length < 2) return g;
  const xs = chosen.map((id) => at[id].x);
  const ys = chosen.map((id) => at[id].y);
  const target = {
    left: Math.min(...xs),
    right: Math.max(...xs),
    center: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
    middle: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
  }[how];
  const layout = { ...at };
  for (const id of chosen) {
    if (how === "left" || how === "center" || how === "right") layout[id] = { x: target, y: at[id].y };
    else layout[id] = { x: at[id].x, y: target };
  }
  return setLayout(g, layout);
}

/** Spaces the named nodes evenly between the outermost two, across or down. */
export function distributeNodes(g: Graph, ids: string[], axis: "horizontal" | "vertical"): Graph {
  const at = positions(g);
  const chosen = ids.filter((id) => at[id]);
  if (chosen.length < 3) return g;
  const key = axis === "horizontal" ? "x" : "y";
  const sorted = [...chosen].sort((a, b) => at[a][key] - at[b][key] || a.localeCompare(b));
  const first = at[sorted[0]][key];
  const last = at[sorted[sorted.length - 1]][key];
  const step = (last - first) / (sorted.length - 1);
  const layout = { ...at };
  sorted.forEach((id, i) => {
    layout[id] = { ...at[id], [key]: Math.round(first + i * step) };
  });
  return setLayout(g, layout);
}
