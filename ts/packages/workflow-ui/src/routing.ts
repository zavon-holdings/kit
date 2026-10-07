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
  // Two sides: an edge going back up runs on the left of what it passes, one
  // skipping down on the right, so a loop and a jump out of the same node
  // never share a line. On each side, lanes that overlap in height, or leave
  // the same node, each get their own.
  const lanes: { side: -1 | 1; top: number; bottom: number; from: string }[] = [];
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
    const side: -1 | 1 = back ? -1 : 1;
    const slot = lanes.filter((l) => l.side === side && ((l.top < bottom && l.bottom > top) || l.from === e.from)).length;
    lanes.push({ side, top, bottom, from: e.from });
    const step = GAP + slot * LANE_STEP;
    const band = [...boxes.values()].filter((b) => b.y < bottom + 14 && b.y + b.h > top - 14);
    const passed = [s, t, ...blocking.map(([, b]) => b)];
    let lane = side > 0 ? Math.max(...passed.map((b) => b.x + b.w)) + step : Math.min(...passed.map((b) => b.x)) - step;
    // Clear of anything else in the rows it runs beside.
    for (let moved = true; moved; ) {
      moved = false;
      for (const b of band) {
        if (b.x < lane + 4 && b.x + b.w > lane - 4) {
          lane = side > 0 ? b.x + b.w + step : b.x - step;
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

/**
 * The same lane with its corners rounded, and where its label sits: beside
 * the lane on the side away from the nodes it passes, so a long label never
 * lies under a card. `side` is -1 when the lane runs left of the source.
 */
export function roundedLanePath(sx: number, sy: number, tx: number, ty: number, lane: number, radius = 10): { d: string; labelX: number; labelY: number; side: -1 | 1 } {
  const out = sy + 14;
  const into = ty - 14;
  const pts: [number, number][] = [
    [sx, sy],
    [sx, out],
    [lane, out],
    [lane, into],
    [tx, into],
    [tx, ty],
  ];
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.5) {
      d += ` L ${cx} ${cy}`;
      continue;
    }
    const ax = cx - ((cx - px) / inLen) * r;
    const ay = cy - ((cy - py) / inLen) * r;
    const bx = cx + ((nx - cx) / outLen) * r;
    const by = cy + ((ny - cy) / outLen) * r;
    d += ` L ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
  }
  d += ` L ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]}`;
  return { d, labelX: lane, labelY: (out + into) / 2, side: lane < sx ? -1 : 1 };
}
