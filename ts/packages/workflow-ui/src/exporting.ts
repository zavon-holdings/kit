/**
 * A graph out of the editor and back in: as JSON (the document itself, for
 * a file or another definition), and as a picture (SVG, which a browser can
 * turn into a PNG or print). The picture is drawn here from the same
 * positions and lanes the canvas uses, not captured from the screen, so it
 * needs no library and looks the same on every machine.
 */
import { FORMAT } from "@zavon/workflow-graph";
import { typeLabel } from "./catalogue.js";
import { positions } from "./layout.js";
import { lanePath, routeEdges, type Box } from "./routing.js";
import type { Graph } from "./types.js";
import { NODE_SIZE } from "./arrange.js";

/** The document, as a person would want to read it in a file. */
export function graphToJson(g: Graph): string {
  return `${JSON.stringify(g, null, 2)}\n`;
}

const KNOWN_KEYS = new Set(["format", "nodes", "edges", "layout", "notes"]);

/**
 * Reads a graph from a file's text. Refuses what core would refuse on
 * sight — not JSON, another format, a field nobody reads — and leaves the
 * graph's own problems (a missing default, a dead end) to the editor, which
 * shows them on the canvas.
 */
export function readGraphJson(text: string): { graph: Graph; error?: undefined } | { error: string; graph?: undefined } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { error: `That file is not JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { error: "That file is not a workflow graph: it is not a JSON object." };
  const o = v as Record<string, unknown>;
  if (o.format !== FORMAT) return { error: `That file is not a ${FORMAT} graph${typeof o.format === "string" ? ` (it says ${o.format})` : ""}.` };
  const unknown = Object.keys(o).filter((k) => !KNOWN_KEYS.has(k));
  if (unknown.length) return { error: `That graph has unsupported ${unknown.length === 1 ? "field" : "fields"}: ${unknown.join(", ")}.` };
  if (!Array.isArray(o.nodes) || !Array.isArray(o.edges)) return { error: "That graph has no nodes or edges list." };
  for (const n of o.nodes as unknown[]) {
    const node = n as Record<string, unknown>;
    if (!node || typeof node.id !== "string" || typeof node.type !== "string") return { error: "Every node needs an id and a type." };
  }
  for (const e of o.edges as unknown[]) {
    const edge = e as Record<string, unknown>;
    if (!edge || typeof edge.from !== "string" || typeof edge.to !== "string") return { error: "Every edge needs a from and a to." };
  }
  if (!(o.nodes as { type: string }[]).some((n) => n.type === "start")) return { error: "That graph has no start." };
  return { graph: o as unknown as Graph };
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Long names are cut to fit a node, with an ellipsis. */
function fit(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export type SvgOptions = {
  /** Shown above the drawing. */
  title?: string;
  /** Node ids on a simulated path, drawn heavier. */
  path?: string[];
  /** Words per node (e.g. "added"), drawn under its name. */
  marks?: Record<string, string>;
};

/**
 * The graph as a standalone SVG document: every node a box with its type,
 * name and id; every edge a line with its arrow and label, in the lanes the
 * canvas uses for loops and long jumps. Black ink on white, so it prints.
 */
export function graphSvg(g: Graph, options: SvgOptions = {}): string {
  const at = positions(g);
  const { w, h } = NODE_SIZE;
  const boxes = new Map<string, Box>(g.nodes.map((n) => [n.id, { ...(at[n.id] ?? { x: 0, y: 0 }), w, h }]));
  const routes = routeEdges(g.edges, boxes);
  const onPath = new Set(options.path ?? []);

  // Bounds, with room for lanes either side and the title.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes.values()) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  for (const note of (g.notes ?? []) as { x: number; y: number }[]) {
    minX = Math.min(minX, note.x);
    minY = Math.min(minY, note.y);
    maxX = Math.max(maxX, note.x + 180);
    maxY = Math.max(maxY, note.y + 64);
  }
  for (const r of routes) {
    if (r.lane !== undefined) {
      minX = Math.min(minX, r.lane - 20);
      maxX = Math.max(maxX, r.lane + 20);
    }
  }
  if (!Number.isFinite(minX)) {
    minX = minY = 0;
    maxX = maxY = 0;
  }
  const pad = 40;
  const titleH = options.title ? 36 : 0;
  const ox = pad - minX;
  const oy = pad + titleH - minY;
  const width = Math.ceil(maxX - minX + 2 * pad);
  const height = Math.ceil(maxY - minY + 2 * pad + titleH);

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">`);
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  out.push(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#333333"/></marker></defs>`);
  if (options.title) out.push(`<text x="${pad}" y="${pad}" font-size="18" font-weight="600" fill="#111111">${xml(options.title)}</text>`);

  out.push(`<g transform="translate(${ox} ${oy})">`);
  g.edges.forEach((e, i) => {
    const s = boxes.get(e.from);
    const t = boxes.get(e.to);
    if (!s || !t) return;
    const sx = s.x + s.w / 2;
    const sy = s.y + s.h;
    const tx = t.x + t.w / 2;
    const ty = t.y;
    const r = routes[i];
    let d: string;
    let lx: number;
    let ly: number;
    if (r?.lane !== undefined) {
      const [p, x, y] = lanePath(sx, sy, tx, ty, r.lane);
      d = p;
      lx = x;
      ly = y;
    } else {
      const mid = (sy + ty) / 2;
      d = `M ${sx} ${sy} L ${sx} ${mid} L ${tx} ${mid} L ${tx} ${ty}`;
      lx = (sx + tx) / 2;
      ly = mid;
    }
    const heavy = onPath.has(e.from) && onPath.has(e.to);
    out.push(`<path d="${d}" fill="none" stroke="${heavy ? "#111111" : "#555555"}" stroke-width="${heavy ? 3 : 1.5}" marker-end="url(#arrow)"/>`);
    const words = [e.label, e.default ? "default" : ""].filter(Boolean).join(" · ");
    if (words) {
      const lxs = lx + (r?.spread ?? 0) * 110;
      const tw = Math.max(30, words.length * 6.6 + 12);
      out.push(`<rect x="${lxs - tw / 2}" y="${ly - 10}" width="${tw}" height="20" rx="10" fill="#ffffff" stroke="#888888"/>`);
      out.push(`<text x="${lxs}" y="${ly + 4}" font-size="11" text-anchor="middle" fill="#222222">${xml(words)}</text>`);
    }
  });
  for (const note of (g.notes ?? []) as { id: string; text: string; x: number; y: number }[]) {
    out.push(`<g data-note="${xml(note.id)}"><rect x="${note.x}" y="${note.y}" width="180" height="64" fill="#fff8db" stroke="#a08a2c"/>`);
    note.text
      .split("\n")
      .slice(0, 3)
      .forEach((line, i) => out.push(`<text x="${note.x + 8}" y="${note.y + 18 + i * 15}" font-size="11" fill="#333333">${xml(fit(line, 30))}</text>`));
    out.push(`</g>`);
  }
  for (const n of g.nodes) {
    const b = boxes.get(n.id)!;
    const name = n.name?.trim() || (n.type === "start" ? "Start" : n.id);
    const heavy = onPath.has(n.id);
    out.push(`<g data-node="${xml(n.id)}">`);
    out.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10" fill="#ffffff" stroke="#222222" stroke-width="${heavy ? 3 : 1.25}"/>`);
    out.push(`<text x="${b.x + 12}" y="${b.y + 18}" font-size="10" fill="#555555">${xml(typeLabel(n.type).toUpperCase())}</text>`);
    out.push(`<text x="${b.x + 12}" y="${b.y + 38}" font-size="14" font-weight="600" fill="#111111">${xml(fit(name, 24))}</text>`);
    const sub = options.marks?.[n.id] ?? (name !== n.id && n.type !== "start" ? n.id : "");
    if (sub) out.push(`<text x="${b.x + 12}" y="${b.y + 58}" font-size="11" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="#555555">${xml(fit(sub, 28))}</text>`);
    out.push(`</g>`);
  }
  out.push(`</g></svg>`);
  return out.join("\n");
}

/**
 * The SVG drawn onto a canvas and encoded as PNG. Browser only; answers
 * null where there is no canvas (a test, a server).
 */
export async function svgToPng(svg: string, scale = 2): Promise<Blob | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  const w = Number(/width="(\d+)"/.exec(svg)?.[1] ?? 800);
  const h = Number(/height="(\d+)"/.exec(svg)?.[1] ?? 600);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return null;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve();
    };
    img.onerror = () => reject(new Error("the drawing could not be rendered"));
    img.src = url;
  });
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

/** Offers a file to the person, by a link they never see. Browser only. */
export function download(name: string, data: Blob | string, type = "application/json"): void {
  if (typeof document === "undefined") return;
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Prints the drawing with the outline beneath it, from a frame of its own:
 * the canvas on screen is a live editor, the wrong thing to put on paper.
 */
export function printGraph(svg: string, title: string, outline: string[]): void {
  if (typeof document === "undefined") return;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(
    `<!doctype html><html><head><title>${xml(title)}</title><style>body{font-family:system-ui,sans-serif;margin:24px;color:#111}svg{max-width:100%;height:auto}ol{columns:2;font-size:12px}@page{margin:12mm}</style></head><body><h1 style="font-size:18px">${xml(title)}</h1>${svg}<h2 style="font-size:14px">Steps in order</h2><ol>${outline.map((l) => `<li>${xml(l)}</li>`).join("")}</ol></body></html>`,
  );
  doc.close();
  const win = frame.contentWindow;
  setTimeout(() => {
    win?.focus();
    win?.print();
    setTimeout(() => frame.remove(), 1000);
  }, 50);
}
