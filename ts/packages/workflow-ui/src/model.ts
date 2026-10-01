/**
 * Editing a graph, as pure functions. Every screen in the package goes
 * through these, so the rules an editor must keep are kept in one place and
 * tested without a screen:
 *
 *  - a node's out-edges are in the order its cases are evaluated, so
 *    reordering is a real edit and the canonical form keeps it;
 *  - a chooser (condition, decision, a review or form that routes) has
 *    exactly one default way out; making one the default unmakes the other;
 *  - a condition asks its question on the node, a decision on its edges;
 *  - "timeout" is the label a wait's second way out carries, and nothing else;
 *  - the start has one way out, nothing leads into it, and it cannot go;
 *  - the layout is presentation: moving a node changes nothing that runs.
 *
 * What these functions do NOT do is validate: an edit that leaves the graph
 * wrong (a decision without a default yet) is allowed, and the problem shows
 * on the canvas until it is fixed, exactly as the server would say it.
 */
import { TIMEOUT_LABEL, FORMAT, BODY_LABEL, NEXT_LABEL } from "@zavon/workflow-graph";
import { chooses, edgeRole, FALLBACK_OUTCOME, FIXED_OUTCOMES, isTask, kindOf, type EdgeRole } from "./catalogue.js";
import type { Graph, GraphEdge, GraphNode, Note, Point } from "./types.js";

/** A step id: lower-case words, digits and _, joined by single hyphens. */
export const STEP_ID = /^[a-z0-9_]+(-[a-z0-9_]+)*$/;

/** A new graph: a start and an end, joined. */
export function emptyGraph(): Graph {
  return {
    format: FORMAT,
    nodes: [
      { id: "start", type: "start" },
      { id: "done", type: "end", name: "Done", config: { outcome: "completed" } },
    ],
    edges: [{ from: "start", to: "done" }],
  };
}

export const nodeById = (g: Graph, id: string): GraphNode | undefined => g.nodes.find((n) => n.id === id);

export type IndexedEdge = { edge: GraphEdge; index: number };

export function outEdges(g: Graph, id: string): IndexedEdge[] {
  const out: IndexedEdge[] = [];
  g.edges.forEach((edge, index) => {
    if (edge.from === id) out.push({ edge, index });
  });
  return out;
}

export function inEdges(g: Graph, id: string): IndexedEdge[] {
  const out: IndexedEdge[] = [];
  g.edges.forEach((edge, index) => {
    if (edge.to === id) out.push({ edge, index });
  });
  return out;
}

/** How the node's ways out are written (see catalogue.edgeRole). */
export function roleOf(g: Graph, id: string): EdgeRole {
  const n = nodeById(g, id);
  if (!n) return "none";
  if (n.type === "start") return "sequence";
  const outs = outEdges(g, id);
  return edgeRole(n.type, outs.length, outs.some(({ edge }) => Boolean(edge.label || edge.default || edge.when !== undefined)));
}

/** A string as a step id: "Send the welcome!" → "send-the-welcome". */
export function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "step";
}

/** An id not yet used in the graph, from a base: email, email-2, email-3… */
export function freshId(g: Graph, base: string): string {
  const root = slug(base);
  const taken = new Set(g.nodes.map((n) => n.id));
  if (!taken.has(root)) return root;
  for (let i = 2; ; i++) {
    const id = `${root}-${i}`;
    if (!taken.has(id)) return id;
  }
}

const withLayout = (g: Graph, layout: Record<string, Point>): Graph => {
  const out: Graph = { ...g };
  if (Object.keys(layout).length > 0) out.layout = layout;
  else delete out.layout;
  return out;
};

export const layoutOf = (g: Graph): Record<string, Point> => (g.layout ?? {}) as Record<string, Point>;

/**
 * Adds a node of a type. With `from`, connects it after that node (the edge
 * labelled as `connect` would); with `at`, places it there.
 */
export function addNode(
  g: Graph,
  type: string,
  options: { from?: string; at?: Point; name?: string; id?: string } = {},
): { graph: Graph; id: string } {
  if (type === "start" && g.nodes.some((n) => n.type === "start")) return { graph: g, id: "" };
  const kind = kindOf(type);
  const base = type === "wait_event" ? "wait" : type === "payment_request" ? "pay" : type === "sub_workflow" ? "sub" : type.replace("_", "-");
  const id = options.id && !nodeById(g, options.id) ? options.id : freshId(g, base);
  const node: GraphNode = { id, type };
  if (options.name) node.name = options.name;
  if (kind.config) node.config = structuredClone(kind.config);
  let graph: Graph = { ...g, nodes: [...g.nodes, node] };
  if (options.at) graph = setPosition(graph, id, options.at);
  if (options.from) graph = connect(graph, options.from, id).graph;
  return { graph, id };
}

/** Removes a node and every edge touching it. The start stays. */
export function removeNode(g: Graph, id: string): Graph {
  const n = nodeById(g, id);
  if (!n || n.type === "start") return g;
  const layout = { ...layoutOf(g) };
  delete layout[id];
  const out = withLayout(
    { ...g, nodes: g.nodes.filter((x) => x.id !== id), edges: g.edges.filter((e) => e.from !== id && e.to !== id) },
    layout,
  );
  // A note about the node stays, about nothing in particular.
  if (!g.notes) return out;
  return {
    ...out,
    notes: (g.notes as Note[]).map((n) => {
      if (n.node !== id) return n;
      const loose = { ...n };
      delete loose.node;
      return loose;
    }),
  };
}

export class EditError extends Error {}

/**
 * Renames a node's id, which is its step's code: edges, layout and
 * references that name it follow. Refused for an id that is not a step id or
 * is already taken.
 */
export function renameNode(g: Graph, from: string, to: string): Graph {
  const next = to.trim();
  if (next === from) return g;
  if (!STEP_ID.test(next)) throw new EditError(`"${next}" is not an id: lower-case letters, digits, _ and single hyphens`);
  if (nodeById(g, next)) throw new EditError(`"${next}" is already a node`);
  const layout = { ...layoutOf(g) };
  if (layout[from]) {
    layout[next] = layout[from];
    delete layout[from];
  }
  return withLayout(
    {
      ...g,
      nodes: g.nodes.map((n) => (n.id === from ? { ...n, id: next } : n)),
      edges: g.edges.map((e) => ({ ...e, from: e.from === from ? next : e.from, to: e.to === from ? next : e.to })),
      ...(g.notes ? { notes: (g.notes as Note[]).map((n) => (n.node === from ? { ...n, node: next } : n)) } : {}),
    },
    layout,
  );
}

function patchNode(g: Graph, id: string, patch: (n: GraphNode) => GraphNode): Graph {
  return { ...g, nodes: g.nodes.map((n) => (n.id === id ? patch(n) : n)) };
}

export function setNodeName(g: Graph, id: string, name: string): Graph {
  return patchNode(g, id, (n) => {
    const out = { ...n };
    if (name.trim()) out.name = name;
    else delete out.name;
    return out;
  });
}

export function setNodeConfig(g: Graph, id: string, config: Record<string, unknown>): Graph {
  return patchNode(g, id, (n) => {
    const out = { ...n };
    if (config && Object.keys(config).length > 0) out.config = config;
    else delete out.config;
    return out;
  });
}

/** How often a back-edge may send a run back here; undefined clears it. */
export function setMaxPasses(g: Graph, id: string, value: number | undefined): Graph {
  return patchNode(g, id, (n) => {
    const out = { ...n };
    if (value && value > 0) out.max_passes = value;
    else delete out.max_passes;
    return out;
  });
}

function outcomeNames(n: GraphNode): string[] {
  if (FIXED_OUTCOMES[n.type]) return [...FIXED_OUTCOMES[n.type]];
  const outcomes = (n.config as { outcomes?: unknown } | undefined)?.outcomes;
  if (!Array.isArray(outcomes)) return [];
  return outcomes
    .map((o) => (o && typeof o === "object" && typeof (o as { name?: unknown }).name === "string" ? (o as { name: string }).name : ""))
    .filter(Boolean);
}

/** The label (and default) a new way out of `from` starts with. */
function newEdgeShape(g: Graph, from: GraphNode): Pick<GraphEdge, "label" | "default"> {
  const outs = outEdges(g, from.id).map(({ edge }) => edge);
  const hasDefault = outs.some((e) => e.default);
  const used = new Set(outs.map((e) => (e.label ?? "").toLowerCase()));
  const nextCase = () => {
    for (let i = 1; ; i++) if (!used.has(`case-${i}`)) return `case-${i}`;
  };
  switch (from.type) {
    case "condition":
      if (!used.has("yes")) return { label: "yes" };
      if (!used.has("no")) return hasDefault ? { label: "no" } : { label: "no", default: true };
      return { label: nextCase() };
    case "decision":
      if (!hasDefault && outs.length > 0) return { label: "otherwise", default: true };
      return { label: nextCase() };
    case "loop":
      if (!used.has(BODY_LABEL)) return { label: BODY_LABEL };
      if (!used.has(NEXT_LABEL)) return { label: NEXT_LABEL };
      return { label: nextCase() };
    case "payment_request":
    case "invoice": {
      const names = outcomeNames(from).filter((name) => !used.has(name));
      const fallback = FALLBACK_OUTCOME[from.type];
      if (names.length === 0) return { label: nextCase() };
      // The fallback outcome is the default; take the others first.
      const pick = names.find((x) => x !== fallback) ?? names[0];
      return pick === fallback && !hasDefault ? { label: pick, default: true } : { label: pick };
    }
    case "wait_event": {
      const normal = outs.filter((e) => e.label !== TIMEOUT_LABEL);
      if (normal.length > 0 && !outs.some((e) => e.label === TIMEOUT_LABEL)) return { label: TIMEOUT_LABEL };
      return {};
    }
    default:
      if (isTask(from.type)) {
        const names = outcomeNames(from).filter((name) => !used.has(name.toLowerCase()));
        if (names.length > 0 && (outs.length > 0 || outcomeNames(from).length > 0)) return { label: names[0] };
        if (outs.length > 0 && !hasDefault) return { label: "otherwise", default: true };
      }
      return {};
  }
}

/**
 * Connects `from` to `to`. The new edge is labelled for the node's kind: yes
 * then no (the default) on a condition; the next unused outcome on a review;
 * "timeout" for a wait's second way out; case-n on a decision, with the
 * first one after another becoming the default. Answers index -1 when the
 * connection cannot be drawn at all (out of an end, into the start, a node
 * to itself, or a plain step to the same node twice).
 */
export function connect(g: Graph, from: string, to: string): { graph: Graph; index: number } {
  const a = nodeById(g, from);
  const b = nodeById(g, to);
  if (!a || !b || a.type === "end" || b.type === "start" || from === to) return { graph: g, index: -1 };
  const shape = newEdgeShape(g, a);
  if (!shape.label && g.edges.some((e) => e.from === from && e.to === to)) return { graph: g, index: -1 };
  const edge: GraphEdge = { from, to };
  if (shape.label) edge.label = shape.label;
  if (shape.default) edge.default = true;
  return { graph: { ...g, edges: [...g.edges, edge] }, index: g.edges.length };
}

export function disconnect(g: Graph, index: number): Graph {
  if (index < 0 || index >= g.edges.length) return g;
  return { ...g, edges: g.edges.filter((_, i) => i !== index) };
}

/** Changes an edge's label, condition or target. `when: undefined` clears it. */
export function setEdge(g: Graph, index: number, patch: { label?: string; when?: unknown; to?: string }): Graph {
  if (index < 0 || index >= g.edges.length) return g;
  return {
    ...g,
    edges: g.edges.map((e, i) => {
      if (i !== index) return e;
      const out: GraphEdge = { ...e };
      if ("label" in patch) {
        if (patch.label) out.label = patch.label;
        else delete out.label;
      }
      if ("when" in patch) {
        if (patch.when === undefined) delete out.when;
        else out.when = patch.when;
      }
      if (patch.to !== undefined && nodeById(g, patch.to)) out.to = patch.to;
      return out;
    }),
  };
}

/**
 * Makes one way out the default for its node, and the node's other ways out
 * not. The default is taken when nothing else matches, so it carries no
 * condition of its own; the edge that stops being the default keeps (or is
 * given) a name, because every other branch needs one.
 */
export function setDefault(g: Graph, index: number): Graph {
  const target = g.edges[index];
  if (!target) return g;
  const used = new Set(g.edges.filter((e) => e.from === target.from).map((e) => (e.label ?? "").toLowerCase()));
  let n = 1;
  const nextCase = () => {
    while (used.has(`case-${n}`)) n++;
    used.add(`case-${n}`);
    return `case-${n}`;
  };
  return {
    ...g,
    edges: g.edges.map((e, i) => {
      if (e.from !== target.from) return e;
      const out: GraphEdge = { ...e };
      if (i === index) {
        out.default = true;
        delete out.when;
        return out;
      }
      if (out.default) {
        delete out.default;
        if (!out.label) out.label = nextCase();
      }
      return out;
    }),
  };
}

/**
 * Moves one of a node's ways out earlier (-1) or later (+1) among that
 * node's ways out. A decision tries its cases in this order.
 */
export function moveEdge(g: Graph, index: number, delta: -1 | 1): Graph {
  const e = g.edges[index];
  if (!e) return g;
  const siblings = outEdges(g, e.from).map((x) => x.index);
  const at = siblings.indexOf(index);
  const swapWith = siblings[at + delta];
  if (swapWith === undefined) return g;
  const edges = [...g.edges];
  [edges[index], edges[swapWith]] = [edges[swapWith], edges[index]];
  return { ...g, edges };
}

export function setPosition(g: Graph, id: string, at: Point): Graph {
  return withLayout(g, { ...layoutOf(g), [id]: { x: Math.round(at.x), y: Math.round(at.y) } });
}

export function setLayout(g: Graph, layout: Record<string, Point>): Graph {
  return withLayout(g, layout);
}

/** Whether removing this edge would leave a chooser without its default. */
export function isLastDefault(g: Graph, index: number): boolean {
  const e = g.edges[index];
  if (!e || !e.default) return false;
  return chooses(roleOf(g, e.from));
}


/* ── Notes: comments on the canvas, presentation only ── */

export const notesOf = (g: Graph): Note[] => (g.notes ?? []) as Note[];

const withNotes = (g: Graph, notes: Note[]): Graph => {
  const out: Graph = { ...g };
  if (notes.length) out.notes = notes;
  else delete out.notes;
  return out;
};

/** Adds a note at a point, about a node when one is named. Answers its id. */
export function addNote(g: Graph, at: Point, text = "", node?: string): { graph: Graph; id: string } {
  const taken = new Set(notesOf(g).map((n) => n.id));
  let i = 1;
  while (taken.has(`note-${i}`)) i++;
  const note: Note = { id: `note-${i}`, text, x: Math.round(at.x), y: Math.round(at.y) };
  if (node && nodeById(g, node)) note.node = node;
  return { graph: withNotes(g, [...notesOf(g), note]), id: note.id };
}

export function setNote(g: Graph, id: string, patch: Partial<Omit<Note, "id">>): Graph {
  return withNotes(
    g,
    notesOf(g).map((n) => {
      if (n.id !== id) return n;
      const out: Note = { ...n, ...patch };
      if (patch.x !== undefined) out.x = Math.round(patch.x);
      if (patch.y !== undefined) out.y = Math.round(patch.y);
      if (!out.node) delete out.node;
      return out;
    }),
  );
}

export function removeNote(g: Graph, id: string): Graph {
  return withNotes(
    g,
    notesOf(g).filter((n) => n.id !== id),
  );
}
