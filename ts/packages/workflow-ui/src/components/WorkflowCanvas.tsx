"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { typeLabel } from "../catalogue.js";
import { autoLayout, positions } from "../layout.js";
import { connect, nodeById, notesOf, removeNote, setLayout, setNote, setPosition } from "../model.js";
import { GRID } from "../arrange.js";
import { roundedLanePath, routeEdges, type Box } from "../routing.js";
import { categoryOf, endOutcome, outcomeTone, summarize, type Tone } from "../design.js";
import { fitView, readableView, VIEW } from "../viewport.js";
import { Icon } from "./icons.js";
import { addFromPalette, DRAG_TYPE } from "./Palette.js";
import { nextFocus } from "../nav.js";
import { edgeKey, pathNodes, problemCount } from "../analysis.js";
import type { GraphNode, Note, Point } from "../types.js";
import { nameOf, useEditor } from "./context.js";

type NodeData = {
  node: GraphNode;
  name: string;
  problems: number;
  onPath: boolean;
  step: number | null;
  /** A word from the host: "added", "removed", "changed". */
  mark?: string;
};

type EdgeData = {
  index: number;
  label?: string;
  isDefault: boolean;
  problems: number;
  onPath: boolean;
  /** A lane beside the nodes, for an edge that skips rows or goes back up. */
  lane?: number;
  /** Labels of edges sharing both ends, spread apart. */
  spread: number;
  /** What the outcome means: approved is ok, rejected danger, timeout warn. */
  tone: Tone;
};

const NODE_WIDTH = 190;
const NODE_HEIGHT = 72;

function NodeCardImpl({ id, data, selected }: NodeProps<Node<NodeData>>) {
  const ed = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  const tabStop = ed.focusId ? ed.focusId === id : ed.analysis.order[0] === id;
  useEffect(() => {
    if (ed.focusId === id && ed.focusTick > 0 && ref.current && document.activeElement !== ref.current) ref.current.focus({ preventScroll: true });
  }, [ed.focusId, ed.focusTick, id]);
  const { node, name, problems, onPath, mark } = data;
  const label = `${typeLabel(node.type)}: ${name}${problems ? `, ${problemCount(problems)}` : ""}${onPath ? ", on the simulated path" : ""}${mark ? `, ${mark}` : ""}`;
  const category = categoryOf(node.type);
  const isEnd = node.type === "end";
  const isStart = node.type === "start";
  const outcome = isEnd ? endOutcome(node) : "";
  const tone: Tone | undefined = isEnd ? (outcomeTone(outcome) !== "neutral" ? outcomeTone(outcome) : outcomeTone(name)) : undefined;
  const summary = isStart ? ed.triggerSummary ?? "" : isEnd ? "" : summarize(node, ed.graph) || (name !== node.id ? node.id : "");
  const kicker = typeLabel(node.type) !== name ? typeLabel(node.type) : "";
  return (
    <div
      ref={ref}
      className="zwf-node"
      data-type={node.type}
      data-category={category}
      data-tone={tone}
      data-on-path={onPath ? "true" : undefined}
      data-problems={problems || undefined}
      data-selected={selected ? "true" : undefined}
      data-mark={mark || undefined}
      role="button"
      tabIndex={tabStop ? 0 : -1}
      aria-label={label}
      aria-pressed={selected ? true : false}
      onFocus={() => ed.focusId !== id && ed.setFocus(id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          ed.select({ kind: "node", id });
          return;
        }
        const to = nextFocus(ed.graph, ed.analysis.order, id, e.key);
        if (to) {
          e.preventDefault();
          ed.setFocus(to, true);
        }
      }}
      style={{ width: NODE_WIDTH }}
    >
      <Handle type="target" position={Position.Top} isConnectable={!ed.readOnly && node.type !== "start"} />
      {(problems > 0 || onPath || mark) && (
        <span className="zwf-node-marks">
          {mark && (
            <span className={`zwf-status zwf-badge zwf-status-${mark === "removed" ? "danger" : mark === "added" ? "ok" : "warn"}`}>
              <span className="zwf-dot" aria-hidden="true" />
              {mark}
            </span>
          )}
          {problems > 0 && (
            <span className="zwf-status zwf-badge zwf-status-danger">
              <Icon name="alert" size={12} />
              {problemCount(problems)}
            </span>
          )}
          {onPath && (
            <span className="zwf-status zwf-badge zwf-status-path">
              <span className="zwf-dot" aria-hidden="true" />
              on the path
            </span>
          )}
        </span>
      )}
      <span className="zwf-node-head">
        <span className="zwf-node-chip" aria-hidden="true">
          <Icon name={node.type} size={isStart || isEnd ? 14 : 16} />
        </span>
        <span className="zwf-node-title">
          <span className="zwf-node-name">{name}</span>
          {(kicker && !isStart) || summary ? (
            <span className="zwf-node-meta" title={summary || undefined}>
              {kicker && !isStart && <span className="zwf-node-type">{kicker}</span>}
              {kicker && !isStart && summary && <span aria-hidden="true"> · </span>}
              {summary && <span className="zwf-node-summary">{summary}</span>}
            </span>
          ) : null}
        </span>
        {isEnd && (
          <span className="zwf-node-outcome" data-tone={tone}>
            {outcome}
          </span>
        )}
      </span>
      <Handle type="source" position={Position.Bottom} isConnectable={!ed.readOnly && node.type !== "end"} />
    </div>
  );
}
const NodeCard = memo(NodeCardImpl);

function LabelEdgeImpl({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, selected }: EdgeProps<Edge<EdgeData>>) {
  const ed = useEditor();
  const d = data!;
  let path: string;
  let lx: number;
  let labelY: number;
  let side: -1 | 0 | 1 = 0;
  if (d.lane !== undefined) {
    const r = roundedLanePath(sourceX, sourceY, targetX, targetY, d.lane);
    path = r.d;
    lx = r.labelX;
    labelY = r.labelY;
    side = r.side;
  } else {
    [path, lx, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 });
  }
  const labelX = lx + d.spread * 110;
  const tone = d.tone;
  const cls = ["zwf-edge", `zwf-edge-tone-${tone}`, d.onPath ? "zwf-edge-path" : "", d.problems ? "zwf-edge-problem" : "", selected ? "zwf-edge-selected" : ""].filter(Boolean).join(" ");
  const shown = d.label || d.isDefault || d.problems;
  const anchor = side < 0 ? "translate(calc(-100% + 10px), -50%)" : side > 0 ? "translate(-10px, -50%)" : "translate(-50%, -50%)";
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={cls} interactionWidth={16} />
      {shown && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className={`zwf-edge-label nodrag nopan${d.problems ? " zwf-edge-label-problem" : ""}${d.onPath ? " zwf-edge-label-path" : ""}${selected ? " zwf-edge-label-selected" : ""}`}
            data-tone={tone}
            data-side={side < 0 ? "left" : side > 0 ? "right" : undefined}
            style={{ transform: `${anchor} translate(${labelX}px, ${labelY}px)` }}
            tabIndex={-1}
            onClick={() => ed.select({ kind: "edge", index: d.index })}
          >
            {d.problems > 0 ? <Icon name="alert" size={12} /> : tone !== "neutral" ? <span className="zwf-dot" aria-hidden="true" /> : null}
            {[d.label, d.isDefault ? "default" : "", d.problems ? problemCount(d.problems) : ""].filter(Boolean).join(" · ")}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
const LabelEdge = memo(LabelEdgeImpl);

type NoteData = { note: Note; about?: string };

/** A comment on the canvas: a box of text, dragged like a node, never compiled. */
function NoteCardImpl({ data }: NodeProps<Node<NoteData>>) {
  const ed = useEditor();
  const { note, about } = data;
  const [draft, setDraft] = useState(note.text);
  useEffect(() => setDraft(note.text), [note.text]);
  return (
    <div className="zwf-note" data-note={note.id}>
      <span className="zwf-note-head">
        Note{about ? ` about ${about}` : ""}
        {!ed.readOnly && (
          <button type="button" className="zwf-link nodrag" onClick={() => ed.update((g) => removeNote(g, note.id))} aria-label={`Remove note ${note.id}`}>
            Remove
          </button>
        )}
      </span>
      <textarea
        className="nodrag nowheel"
        aria-label={`Note ${note.id}${about ? ` about ${about}` : ""}`}
        value={draft}
        readOnly={ed.readOnly}
        rows={3}
        onChange={(e) => {
          setDraft(e.target.value);
          const text = e.target.value;
          ed.update((g) => setNote(g, note.id, { text }), { coalesce: `note:${note.id}` });
        }}
      />
    </div>
  );
}
const NoteCard = memo(NoteCardImpl);

const nodeTypes = { zwf: NodeCard, zwfNote: NoteCard };
const edgeTypes = { zwf: LabelEdge };

/** The canvas's own controls: zoom, a readable fit, and the overview map. */
function Zoom() {
  const ed = useEditor();
  const rf = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const duration = ed.reducedMotion ? 0 : 180;
  const fit = () => {
    const nodes = rf.getNodes();
    if (nodes.length === 0 || !width || !height) return void rf.fitView({ padding: 0.2, duration });
    void rf.setViewport(fitView(widen(rf.getNodesBounds(nodes)), width, height, VIEW.fitFloor, 1), { duration });
  };

  return (
    <Panel position="bottom-left" className="zwf-zoom" role="group" aria-label="Zoom">
      <button type="button" className="zwf-icon-button" aria-label="Zoom in" data-tip="Zoom in" onClick={() => rf.zoomIn({ duration })}>
        <Icon name="plus" />
      </button>
      <button type="button" className="zwf-icon-button" aria-label="Zoom out" data-tip="Zoom out" onClick={() => rf.zoomOut({ duration })}>
        <Icon name="minus" />
      </button>
      <button type="button" className="zwf-icon-button" aria-label="Fit" data-tip="Fit to view" onClick={fit}>
        <Icon name="fit" />
      </button>
      {ed.setMinimap && (
        <>
          <span className="zwf-zoom-sep" aria-hidden="true" />
          <button
            type="button"
            className="zwf-icon-button"
            aria-label="Show the overview map"
            aria-pressed={ed.minimap}
            data-tip={ed.minimap ? "Hide the overview map" : "Show the overview map"}
            onClick={() => ed.setMinimap?.(!ed.minimap)}
          >
            <Icon name="map" />
          </button>
        </>
      )}
    </Panel>
  );
}

/** Keeps the node with keyboard focus in view, without animating when asked not to. */
function FollowFocus({ at }: { at: Record<string, Point> }) {
  const ed = useEditor();
  const rf = useReactFlow();
  useEffect(() => {
    if (!ed.focusId || ed.focusTick === 0) return;
    const p = at[ed.focusId];
    if (!p) return;
    rf.setCenter(p.x + NODE_WIDTH / 2, p.y + 40, { zoom: rf.getZoom(), duration: ed.reducedMotion ? 0 : 150 });
    // Only on a keyboard move: a click must not jump the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed.focusTick]);
  return null;
}

/**
 * The first view: the whole graph when it fits at a readable size, else as
 * wide as the canvas allows at a readable size, from the top. A tree taller
 * than the canvas is scrolled, not shrunk until its words cannot be read.
 */
function FirstView({ lone }: { lone: boolean }) {
  const rf = useReactFlow();
  const ready = useNodesInitialized();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const done = useRef(false);
  const wasLone = useRef(lone);
  // Emptied after the first view: look again, so the start sits above "Add your first step".
  if (lone && !wasLone.current) done.current = false;
  wasLone.current = lone;
  useEffect(() => {
    if (!ready || done.current || !width || !height) return;
    const nodes = rf.getNodes();
    if (nodes.length === 0) return;
    done.current = true;
    const b = rf.getNodesBounds(nodes);
    const view = readableView(widen(b, 40), width, height);
    // A lone start sits high, leaving room for "Add your first step" below it.
    if (lone) view.y = Math.min(view.y, height * 0.2 - b.y * view.zoom);
    void rf.setViewport(view, { duration: 0 });
  }, [ready, width, height, rf, lone]);
  return null;
}

/** Room beside the nodes for the lanes an edge takes round them, and their labels. */
const widen = (b: { x: number; y: number; width: number; height: number }, room = 96) => ({ ...b, x: b.x - room, width: b.width + 2 * room });

/** Below this zoom a card drops its details and shows its name larger. */
const FAR_ZOOM = 0.62;

const TONE_COLOUR: Record<Tone, string> = {
  ok: "var(--_edge-ok)",
  danger: "var(--_edge-danger)",
  warn: "var(--_edge-warn)",
  neutral: "var(--_edge)",
};

/** What the canvas shows when nothing follows the start yet. */
function EmptyState() {
  const ed = useEditor();
  const suggestions: { type: string; words: string }[] = [
    { type: "approval", words: "Start with an approval" },
    { type: "condition", words: "Start with a condition" },
    { type: "email", words: "Start with an email" },
  ];
  return (
    <div className="zwf-empty" role="group" aria-label="Add your first step">
      <svg className="zwf-empty-art" width="132" height="76" viewBox="0 0 132 76" aria-hidden="true" focusable="false">
        <rect x="44" y="2" width="44" height="18" rx="9" className="zwf-art-start" />
        <path d="M66 20v12M66 32c0 6-30 4-30 12M66 32c0 6 30 4 30 12" className="zwf-art-line" fill="none" />
        <rect x="8" y="44" width="56" height="28" rx="8" className="zwf-art-card" />
        <rect x="68" y="44" width="56" height="28" rx="8" className="zwf-art-card zwf-art-ghost" />
        <rect x="14" y="51" width="12" height="12" rx="4" className="zwf-art-chip" />
        <rect x="30" y="52" width="26" height="4" rx="2" className="zwf-art-text" />
        <rect x="30" y="60" width="18" height="3" rx="1.5" className="zwf-art-text zwf-art-soft" />
        <path d="M96 52v12M90 58h12" className="zwf-art-plus" />
      </svg>
      <p className="zwf-empty-title">Add your first step</p>
      <p className="zwf-muted zwf-empty-text">Pick a step from the palette or drag one onto the canvas. Each new step connects to the one selected.</p>
      <div className="zwf-row zwf-empty-actions">
        {suggestions
          .filter((x) => !ed.unavailable[x.type])
          .map((x) => (
            <button key={x.type} type="button" className="zwf-button zwf-chip-button" onClick={() => addFromPalette(ed, x.type, { from: ed.graph.nodes.find((n) => n.type === "start")?.id })}>
              <Icon name={x.type} size={14} />
              {x.words}
            </button>
          ))}
      </div>
    </div>
  );
}

function Canvas() {
  const ed = useEditor();
  const rf = useReactFlow();
  const far = useStore((st) => st.transform[2] < FAR_ZOOM);
  const [dropping, setDropping] = useState(false);
  const { graph, analysis, readOnly } = ed;
  const at = useMemo(() => positions(graph), [graph]);
  const pathSet = useMemo(() => pathNodes(graph, ed.path), [graph, ed.path]);
  const stepNumber = useMemo(() => new Map(analysis.order.map((id, i) => [id, i])), [analysis.order]);

  const chosen = useMemo(() => new Set(ed.selectedIds), [ed.selectedIds]);
  const derived: Node<NodeData>[] = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: "zwf",
        position: at[n.id] ?? { x: 0, y: 0 },
        data: {
          node: n,
          name: nameOf(graph, n.id),
          problems: analysis.byNode.get(n.id)?.length ?? 0,
          onPath: pathSet.has(n.id),
          step: stepNumber.get(n.id) ?? null,
          mark: ed.marks?.[n.id],
        },
        selected: chosen.has(n.id),
        draggable: !readOnly,
        connectable: !readOnly,
      })),
    [graph, at, analysis, pathSet, stepNumber, chosen, readOnly, ed.marks],
  );

  const noteNodes = useMemo(
    () =>
      notesOf(graph).map(
        (n) =>
          ({
            id: `note:${n.id}`,
            type: "zwfNote",
            position: { x: n.x, y: n.y },
            data: { note: n, about: n.node ? nameOf(graph, n.node) : undefined },
            draggable: !readOnly,
            connectable: false,
            selectable: false,
          }) as unknown as Node<NodeData>,
      ),
    [graph, readOnly],
  );
  const all = useMemo(() => [...derived, ...noteNodes], [derived, noteNodes]);
  const [rfNodes, setRfNodes] = useState<Node<NodeData>[]>(all);
  useEffect(() => {
    setRfNodes((prev) => {
      const before = new Map(prev.map((p) => [p.id, p]));
      return all.map((d) => {
        const p = before.get(d.id);
        return p ? { ...d, measured: p.measured, width: p.width, height: p.height } : d;
      });
    });
  }, [all]);

  const heights = useMemo(() => new Map(rfNodes.filter((n) => !n.id.startsWith("note:")).map((n) => [n.id, n.measured?.height ?? NODE_HEIGHT])), [rfNodes]);
  const routes = useMemo(() => {
    const boxes = new Map<string, Box>(graph.nodes.map((n) => [n.id, { ...(at[n.id] ?? { x: 0, y: 0 }), w: NODE_WIDTH, h: heights.get(n.id) ?? NODE_HEIGHT }]));
    return routeEdges(graph.edges, boxes);
  }, [graph, at, heights]);

  const edges: Edge<EdgeData>[] = useMemo(
    () =>
      graph.edges.map((e, index) => {
        const fromOn = pathSet.has(e.from);
        const problems = analysis.byEdge.get(edgeKey(e))?.length ?? 0;
        const tone: Tone = problems ? "danger" : outcomeTone(e.label);
        return {
          id: `e${index}`,
          source: e.from,
          target: e.to,
          type: "zwf",
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: TONE_COLOUR[tone] },
          selected: ed.selection?.kind === "edge" && ed.selection.index === index,
          data: {
            index,
            label: e.label,
            isDefault: !!e.default,
            problems,
            tone,
            onPath: fromOn && pathSet.has(e.to),
            lane: routes[index]?.lane,
            spread: routes[index]?.spread ?? 0,
          },
        };
      }),
    [graph, analysis, pathSet, ed.selection, routes],
  );

  const onNodesChange = useCallback((changes: NodeChange<Node<NodeData>>[]) => {
    const kept = changes.filter((c) => c.type === "dimensions" || c.type === "position");
    if (kept.length) setRfNodes((nds) => applyNodeChanges(kept, nds));
  }, []);

  const onConnect = useCallback((c: Connection) => ed.update((g) => connect(g, c.source, c.target).graph), [ed]);
  const empty = !readOnly && graph.nodes.every((n) => n.type === "start");

  return (
    <div
      className="zwf-canvas"
      data-readonly={readOnly ? "true" : undefined}
      data-zoom={far ? "far" : undefined}
      data-dropping={dropping ? "true" : undefined}
      onDragOver={(e) => {
        if (readOnly || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!dropping) setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={(e) => {
        setDropping(false);
        const type = e.dataTransfer.getData(DRAG_TYPE);
        if (readOnly || !type || ed.unavailable[type]) return;
        e.preventDefault();
        const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        addFromPalette(ed, type, { at: { x: Math.round(p.x - NODE_WIDTH / 2), y: Math.round(p.y - 30) } });
      }}
    >
      {empty && <EmptyState />}
      <ReactFlow
        nodes={rfNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_, __, dragged) => {
          ed.update((g) => {
            let out = g;
            for (const n of dragged) {
              if (n.id.startsWith("note:")) out = setNote(out, n.id.slice(5), { x: n.position.x, y: n.position.y });
              else out = setPosition(out, n.id, n.position);
            }
            return out;
          });
        }}
        onConnect={onConnect}
        isValidConnection={(c) => {
          const a = nodeById(graph, c.source);
          const b = nodeById(graph, c.target);
          return !!a && !!b && a.type !== "end" && b.type !== "start" && c.source !== c.target;
        }}
        onNodeClick={(e, n) => {
          if (n.id.startsWith("note:")) return;
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            // Add to (or take out of) the selection.
            const now = new Set(ed.selectedIds);
            if (now.has(n.id)) now.delete(n.id);
            else now.add(n.id);
            const ids = graph.nodes.map((x) => x.id).filter((id) => now.has(id));
            ed.select(ids.length === 0 ? null : ids.length === 1 ? { kind: "node", id: ids[0] } : { kind: "nodes", ids });
          } else {
            ed.select({ kind: "node", id: n.id });
          }
          ed.setFocus(n.id);
        }}
        onSelectionChange={({ nodes }) => {
          // A box drawn with Shift held: the nodes inside it become the selection.
          nodes = nodes.filter((n) => !n.id.startsWith("note:"));
          if (nodes.length < 2) return;
          const ids = graph.nodes.map((x) => x.id).filter((id) => nodes.some((n) => n.id === id));
          const same = ids.length === ed.selectedIds.length && ids.every((id, i) => ed.selectedIds[i] === id);
          if (!same) ed.select({ kind: "nodes", ids });
        }}
        onEdgeClick={(_, e) => ed.select({ kind: "edge", index: Number(e.id.slice(1)) })}
        onPaneClick={() => ed.select(null)}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        nodesFocusable={false}
        edgesFocusable={false}
        disableKeyboardA11y
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={null}
        snapToGrid={ed.snapToGrid}
        snapGrid={[GRID, GRID]}
        minZoom={0.2}
        maxZoom={1.75}
        defaultEdgeOptions={{ type: "zwf" }}
        aria-label="Workflow canvas"
      >
        <Zoom />
        <FirstView lone={graph.nodes.length === 1} />
        <FollowFocus at={at} />
        {ed.minimap && (
          <MiniMap
            pannable
            zoomable
            ariaLabel="Overview of the whole workflow"
            nodeBorderRadius={6}
            nodeColor={(n) => (n.id.startsWith("note:") ? "var(--zwf-note)" : `var(--zwf-cat-${categoryOf((n.data as NodeData).node.type)})`)}
            maskColor="var(--_minimap-mask)"
          />
        )}
      </ReactFlow>
    </div>
  );
}

/** The graph drawn: nodes, edges, pan and zoom. A view of the same graph the List tab edits. */
export function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}

/** Lays every node out afresh. Only ever on request. */
export function layoutAll(g: Parameters<typeof autoLayout>[0]) {
  return setLayout(g, autoLayout(g));
}
