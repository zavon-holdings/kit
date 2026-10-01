export declare const FORMAT: "workflow.graph/1";
export declare const SUFFIX_GOTO: "--goto";
export declare const SUFFIX_ROUTE: "--route";
export declare const SUFFIX_JOIN: "--join";
export declare const TIMEOUT_LABEL: "timeout";
/** A loop's two ways out: to the first step of its body, and to what follows. */
export declare const BODY_LABEL: "body";
export declare const NEXT_LABEL: "next";
/** The codes a payment_request or invoice node's steps carry after its id. */
export declare const MONEY_SUFFIXES: Readonly<{
  VARS: "--vars";
  REQUEST: "--request";
  ISSUE: "--issue";
  NOTIFY: "--notify";
  WAIT: "--wait";
  OUTCOME: "--outcome";
  TIMEOUT: "--timeout";
  TIMEOUT_GOTO: "--timeout-goto";
}>;
export declare const PROBLEMS: Readonly<Record<string, string>>;
export declare const NOT_YET: Readonly<Record<string, string>>;

export interface GraphNode {
  id: string;
  type: string;
  name?: string;
  config?: Record<string, unknown>;
  /** How often a back-edge may send a run back here (1-100; 25 when unset). */
  max_passes?: number;
  /** The end a linear flow runs off: compiles to nothing when only fallen into. */
  implicit?: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  when?: unknown;
  default?: boolean;
}

/** A comment on the canvas. Presentation, like the layout: never compiled. */
export interface Note {
  id: string;
  text: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** The node the note is about, when it is about one. */
  node?: string;
}

export interface Graph {
  format: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout?: Record<string, unknown>;
  notes?: Note[];
}

export interface Step {
  code: string;
  name: string;
  kind: string;
  config: Record<string, unknown>;
  parent?: string;
  branch?: string;
}

export interface Problem {
  code: string;
  node?: string;
  edge?: { from: string; to: string; label?: string };
  message: string;
}

/** @zavon/conditions, passed in: this package depends on nothing. */
export interface Conditions {
  parse(raw: unknown, options?: { mode?: "branch" | "trigger"; allowHolds?: boolean }): unknown;
  fields(node: unknown): string[];
}

export interface Options {
  /** The definition's trigger kind; "event" puts event.* in scope from the start. */
  trigger?: string;
  conditions: Conditions;
}

export declare function canon<T>(value: T): T;
export declare function canonical(g: Graph): Graph;
export declare function equal(a: Graph, b: Graph): boolean;
export declare function sameSteps(a: Step[], b: Step[]): [boolean, string];
export declare function nodeOf(code: string): string;
export declare function validate(g: Graph, options: Options): Problem[];
export declare function compile(g: Graph, options: Options): { steps: Step[]; problems?: undefined } | { problems: Problem[]; steps?: undefined };
export declare function decompile(steps: Step[]): Graph;
export declare class NotDrawableError extends Error {}
