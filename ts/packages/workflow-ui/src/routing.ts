/**
 * Where an edge is drawn when the plain route would mislead.
 *
 * A canvas edge runs from the bottom of one node to the top of the next. Two
 * cases make that a lie: an edge that skips rows (a review whose outcome jumps
 * three steps on) would run straight over the nodes between, its label sitting
 * on one of them; and an edge that goes back up (a loop) would cut through
 * everything. Those take a lane beside the nodes they pass instead. Edges that
 * share both ends (two outcomes to one place) keep one line and spread their
 * labels apart, so each can still be read and clicked.
 */

export type Box = { x: number; y: number; w: number; h: number };
export type Route = { lane?: number; spread: number };

const GAP = 28;
const LANE_STEP = 18;

export function routeEdges(edges: { from: string; to: string }[], boxes: Map<string, Box>): Route[] {
  const pairs = new Map<string, number[]>();
  edges.forEach((e, i) => {
    const k = `${e.from}\u0000${e.to}`;
    pairs.set(k, [...(pairs.get(k) ?? []), i]);
  });
  const lanes: { top: number; bottom: number }[] = [];
  return edges.map((e, i) => {
    const group = pairs.get(`${e.from}\u0000${e.to}`)!;
    const spread = group.indexOf(i) - (group.length - 1) / 2;
    const s = boxes.get(e.from);
    const t = boxes.get(e.to);
    if (!s || !t) return { spread };
    const sx = s.x + s.w / 2;
    const sy = s.y + s.h;
    const tx = t.x + t.w / 2;
    const ty = t.y;
    const back = ty <= sy;
    const lo = Math.min(sx, tx) - 8;
    const hi = Math.max(sx, tx) + 8;
    const top = Math.min(sy, ty);
    const bottom = Math.max(sy, ty);
    const blocking = [...boxes.entries()].filter(
      ([id, b]) => id !== e.from && id !== e.to && b.y < bottom && b.y + b.h > top && b.x < hi && b.x + b.w > lo,
    );
    if (!back && blocking.length === 0) return { spread };
    const slot = lanes.filter((l) => l.top < bottom && l.bottom > top).length;
    lanes.push({ top, bottom });
    // Right of what it passes, then further right of anything else in the
    // rows it runs beside, so the lane itself crosses no node.
    const band = [...boxes.values()].filter((b) => b.y < bottom + 14 && b.y + b.h > top - 14);
    let lane = Math.max(s.x + s.w, t.x + t.w, ...blocking.map(([, b]) => b.x + b.w)) + GAP + slot * LANE_STEP;
    for (let moved = true; moved; ) {
      moved = false;
      for (const b of band) {
        if (b.x < lane + 4 && b.x + b.w > lane - 4) {
          lane = b.x + b.w + GAP + slot * LANE_STEP;
          moved = true;
        }
      }
    }
    return { spread, lane };
  });
}

/** The lane's path: down out of the source, along the lane, into the target from above. */
export function lanePath(sx: number, sy: number, tx: number, ty: number, lane: number): [string, number, number] {
  const out = sy + 14;
  const into = ty - 14;
  return [`M ${sx} ${sy} L ${sx} ${out} L ${lane} ${out} L ${lane} ${into} L ${tx} ${into} L ${tx} ${ty}`, lane, (out + into) / 2];
}
