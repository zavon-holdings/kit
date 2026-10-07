/**
 * Where the canvas looks: a view that can be read.
 *
 * The whole graph when it fits at a readable size (centred, never blown up
 * past `max`). Otherwise as wide as the canvas allows, never below `min`,
 * starting at the top: a tall, narrow tree — most workflows are a chain with
 * a few jumps — is read by scrolling down, not shrunk until its words go.
 */
export type Bounds = { x: number; y: number; width: number; height: number };
export type View = { x: number; y: number; zoom: number };

export const VIEW = Object.freeze({
  /** Below this a card's words are too small to read on the first view. */
  readable: 0.85,
  /** Fit never goes below this; the overview map shows the rest. */
  fitFloor: 0.45,
  /** A small graph is drawn a little larger, never more than this. */
  max: 1.1,
  pad: 32,
});

export function readableView(b: Bounds, width: number, height: number, min: number = VIEW.readable, max: number = VIEW.max, pad: number = VIEW.pad): View {
  const bw = Math.max(1, b.width);
  const bh = Math.max(1, b.height);
  const fitW = (width - 2 * pad) / bw;
  const fitH = (height - 2 * pad) / bh;
  const whole = Math.min(fitW, fitH);
  if (whole >= min) {
    const zoom = Math.min(max, whole);
    return { x: width / 2 - (b.x + bw / 2) * zoom, y: height / 2 - (b.y + bh / 2) * zoom, zoom };
  }
  const zoom = Math.max(min, Math.min(max, fitW));
  return { x: width / 2 - (b.x + bw / 2) * zoom, y: pad - b.y * zoom, zoom };
}

/**
 * Fit, on request: the whole graph, as small as it takes but never below
 * `floor`; a graph too tall for that is shown from the top at `floor`.
 */
export function fitView(b: Bounds, width: number, height: number, floor: number = VIEW.fitFloor, max = 1, pad: number = VIEW.pad): View {
  const bw = Math.max(1, b.width);
  const bh = Math.max(1, b.height);
  const whole = Math.min((width - 2 * pad) / bw, (height - 2 * pad) / bh);
  const zoom = Math.max(floor, Math.min(max, whole));
  const x = width / 2 - (b.x + bw / 2) * zoom;
  const y = whole >= floor ? height / 2 - (b.y + bh / 2) * zoom : pad - b.y * zoom;
  return { x, y, zoom };
}
