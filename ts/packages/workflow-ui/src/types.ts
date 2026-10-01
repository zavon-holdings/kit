import type { ComponentType } from "react";
import type { Graph, GraphEdge, GraphNode, Problem, Step } from "@zavon/workflow-graph";

export type { Graph, GraphEdge, GraphNode, Problem, Step };

/** A node's position on the canvas. Presentation only: never compiled. */
export type Point = { x: number; y: number };

/** What is selected: a node, or one edge by its index in graph.edges. */
export type Selection = { kind: "node"; id: string } | { kind: "edge"; index: number } | null;

/** What a host's inspector for one node type is given. */
export type InspectorProps = {
  node: GraphNode;
  /** Replaces the node's config. */
  onChange: (config: Record<string, unknown>) => void;
  readOnly: boolean;
};

/** Inspectors by node type, supplied by the host app. */
export type Inspectors = Partial<Record<string, ComponentType<InspectorProps>>>;

/** A subject a simulation is about. */
export type SampleSubject = { property?: string; type: string; pid: string; label?: string };

/** The sample a simulation walks with. */
export type Sample = {
  subject: SampleSubject;
  vars: Record<string, unknown>;
  event?: { type: string; ref?: string; vars?: Record<string, unknown> };
  now?: string;
};

export type SimulateRequest = Sample & {
  graph: Graph;
  /** Answers at stops: {<step code>: outcome | event type | "timeout"}. */
  decisions: Record<string, string>;
  outputs?: Record<string, Record<string, unknown>>;
};

export type SimulatedStep = {
  code: string;
  node: string;
  name: string;
  kind: string;
  parent?: string;
  branch?: string;
  at: string;
  until?: string;
  says: string;
  would?: string[];
  to?: string[];
  outcome?: string;
  goto?: string;
  skipped?: boolean;
};

export type SimulateResult = {
  path: string[];
  steps: SimulatedStep[];
  recipients: string[];
  stopped: { code: string; node: string; reason: string; choices?: string[]; message: string } | null;
  ended: { outcome: string; at: string } | null;
  vars: Record<string, unknown>;
};

/**
 * What the host does for the editor. The package holds no fetch code: each
 * app routes these through its own backend. Every member is optional; a
 * panel whose call is missing says so instead of offering a button.
 */
export type WorkflowApi = {
  /** The server's own check of a graph; problems carry node and edge. */
  validate?: (graph: Graph) => Promise<Problem[]>;
  /** A dry walk of the graph with a sample. Writes nothing. */
  simulate?: (request: SimulateRequest) => Promise<SimulateResult>;
};

/** A thrown error a host api may raise with the server's problems attached. */
export type ApiError = Error & { problems?: Problem[] };
