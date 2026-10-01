"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
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
import { connect, nodeById, setLayout, setPosition } from "../model.js";
import { lanePath, routeEdges, type Box } from "../routing.js";
import { nextFocus } from "../nav.js";
import { edgeKey, pathNodes, problemCount } from "../analysis.js";
import type { GraphNode, Point } from "../types.js";
import { nameOf, useEditor } from "./context.js";

type NodeData = {
  node: GraphNode;
  name: string;
  problems: number;
  onPath: boolean;
  step: number | null;
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
  const { node, name, problems, onPath } = data;
  const label = `${typeLabel(node.type)}: ${name}${problems ? `, ${problemCount(problems)}` : ""}${onPath ? ", on the simulated path" : ""}`;
  return (
    <div
      ref={ref}
      className="zwf-node"
      data-type={node.type}
      data-on-path={onPath ? "true" : undefined}
      data-problems={problems || undefined}
      data-selected={selected ? "true" : undefined}
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
      {typeLabel(node.type) !== name && <span className="zwf-node-type">{typeLabel(node.type)}</span>}
      <span className="zwf-node-name">{name}</span>
      {name !== node.id && node.type !== "start" && <code className="zwf-node-id">{node.id}</code>}
      {(problems > 0 || onPath) && (
        <span className="zwf-node-marks">
          {problems > 0 && (
            <span className="zwf-status zwf-status-danger">
              <span className="zwf-dot" aria-hidden="true" />
              {problemCount(problems)}
            </span>
          )}
          {onPath && (
            <span className="zwf-status zwf-status-path">
              <span className="zwf-dot" aria-hidden="true" />
              on the path
            </span>
          )}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={!ed.readOnly && node.type !== "end"} />
    </div>
  );
}
const NodeCard = memo(NodeCardImpl);

function LabelEdgeImpl({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, selected }: EdgeProps<Edge<EdgeData>>) {
  const ed = useEditor();
  const d = data!;
  const [path, lx, labelY] =
    d.lane !== undefined
      ? lanePath(sourceX, sourceY, targetX, targetY, d.lane)
      : getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10 });
  const labelX = lx + d.spread * 110;
  const words = [d.label, d.isDefault ? "default" : "", d.problems ? problemCount(d.problems) : ""].filter(Boolean).join(" · ");
  const cls = ["zwf-edge", d.onPath ? "zwf-edge-path" : "", d.problems ? "zwf-edge-problem" : "", selected ? "zwf-edge-selected" : ""].filter(Boolean).join(" ");
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={cls} />
      {words && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className={`zwf-edge-label nodrag nopan${d.problems ? " zwf-edge-label-problem" : ""}${d.onPath ? " zwf-edge-label-path" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            tabIndex={-1}
            onClick={() => ed.select({ kind: "edge", index: d.index })}
          >
            {d.problems > 0 && <span className="zwf-dot" aria-hidden="true" />}
            {words}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
const LabelEdge = memo(LabelEdgeImpl);

const nodeTypes = { zwf: NodeCard };
const edgeTypes = { zwf: LabelEdge };

function Zoom() {
  const ed = useEditor();
  const rf = useReactFlow();
  const duration = ed.reducedMotion ? 0 : 180;
  return (
    <Panel position="top-right" className="zwf-zoom">
      <button type="button" className="zwf-button" onClick={() => rf.zoomIn({ duration })}>
        Zoom in
      </button>
      <button type="button" className="zwf-button" onClick={() => rf.zoomOut({ duration })}>
        Zoom out
      </button>
      <button type="button" className="zwf-button" onClick={() => rf.fitView({ padding: 0.2, duration })}>
        Fit
      </button>
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
 * The first view: the whole graph when it fits at a readable size, else its
 * top at a readable size, centred. A tree taller than the canvas is panned,
 * not shrunk until its words cannot be read.
 */
function FirstView() {
  const rf = useReactFlow();
  const ready = useNodesInitialized();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current || !width || !height) return;
    const nodes = rf.getNodes();
    if (nodes.length === 0) return;
    done.current = true;
    const b = rf.getNodesBounds(nodes);
    const pad = 32;
    const fit = Math.min((width - 2 * pad) / Math.max(1, b.width), (height - 2 * pad) / Math.max(1, b.height));
    const zoom = Math.max(MIN_READABLE_ZOOM, Math.min(1, fit));
    const x = width / 2 - (b.x + b.width / 2) * zoom;
    const y = b.height * zoom + 2 * pad <= height ? height / 2 - (b.y + b.height / 2) * zoom : pad - b.y * zoom;
    void rf.setViewport({ x, y, zoom }, { duration: 0 });
  }, [ready, width, height, rf]);
  return null;
}

/** Below this the node text is too small to read; the first view pans instead. */
const MIN_READABLE_ZOOM = 0.75;

function Canvas() {
  const ed = useEditor();
  const { graph, analysis, readOnly } = ed;
  const at = useMemo(() => positions(graph), [graph]);
  const pathSet = useMemo(() => pathNodes(graph, ed.path), [graph, ed.path]);
  const stepNumber = useMemo(() => new Map(analysis.order.map((id, i) => [id, i])), [analysis.order]);

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
        },
        selected: ed.selection?.kind === "node" && ed.selection.id === n.id,
        draggable: !readOnly,
        connectable: !readOnly,
      })),
    [graph, at, analysis, pathSet, stepNumber, ed.selection, readOnly],
  );

  const [rfNodes, setRfNodes] = useState<Node<NodeData>[]>(derived);
  useEffect(() => {
    setRfNodes((prev) => {
      const before = new Map(prev.map((p) => [p.id, p]));
      return derived.map((d) => {
        const p = before.get(d.id);
        return p ? { ...d, measured: p.measured, width: p.width, height: p.height } : d;
      });
    });
  }, [derived]);

  const heights = useMemo(() => new Map(rfNodes.map((n) => [n.id, n.measured?.height ?? NODE_HEIGHT])), [rfNodes]);
  const routes = useMemo(() => {
    const boxes = new Map<string, Box>(graph.nodes.map((n) => [n.id, { ...(at[n.id] ?? { x: 0, y: 0 }), w: NODE_WIDTH, h: heights.get(n.id) ?? NODE_HEIGHT }]));
    return routeEdges(graph.edges, boxes);
  }, [graph, at, heights]);

  const edges: Edge<EdgeData>[] = useMemo(
    () =>
      graph.edges.map((e, index) => {
        const fromOn = pathSet.has(e.from);
        return {
          id: `e${index}`,
          source: e.from,
          target: e.to,
          type: "zwf",
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
          selected: ed.selection?.kind === "edge" && ed.selection.index === index,
          data: {
            index,
            label: e.label,
            isDefault: !!e.default,
            problems: analysis.byEdge.get(edgeKey(e))?.length ?? 0,
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

  return (
    <div className="zwf-canvas" data-readonly={readOnly ? "true" : undefined}>
      <ReactFlow
        nodes={rfNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_, __, dragged) => {
          ed.update((g) => {
            let out = g;
            for (const n of dragged) out = setPosition(out, n.id, n.position);
            return out;
          });
        }}
        onConnect={onConnect}
        isValidConnection={(c) => {
          const a = nodeById(graph, c.source);
          const b = nodeById(graph, c.target);
          return !!a && !!b && a.type !== "end" && b.type !== "start" && c.source !== c.target;
        }}
        onNodeClick={(_, n) => {
          ed.select({ kind: "node", id: n.id });
          ed.setFocus(n.id);
        }}
        onEdgeClick={(_, e) => ed.select({ kind: "edge", index: Number(e.id.slice(1)) })}
        onPaneClick={() => ed.select(null)}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        nodesFocusable={false}
        edgesFocusable={false}
        disableKeyboardA11y
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        minZoom={0.2}
        maxZoom={1.75}
        defaultEdgeOptions={{ type: "zwf" }}
        aria-label="Workflow canvas"
      >
        <Zoom />
        <FirstView />
        <FollowFocus at={at} />
        {graph.nodes.length >= 30 && <MiniMap pannable zoomable ariaLabel="Overview of the whole workflow" />}
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
