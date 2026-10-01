export declare const OPERATORS: readonly string[];
export declare const MAX_PATTERN: number;
export declare const MAX_SUBJECT: number;
export declare const MAX_DEPTH: number;

export type Mode = "branch" | "trigger";

export interface Grant {
  app: string;
  action: string;
  resource: string;
}

export interface Permits {
  holds(subject: string, grant: Grant): boolean;
}

/** A parsed condition. Opaque: build it with parse(). */
export interface Node {
  readonly empty?: true;
  readonly all?: Node[];
  readonly any?: Node[];
  readonly not?: Node;
  readonly field?: string;
  readonly op?: string;
  readonly value?: unknown;
}

export interface Scope {
  vars?: Record<string, unknown>;
  subject?: Record<string, unknown>;
  steps?: Record<string, unknown>;
  event?: Record<string, unknown>;
  /** The frozen instant {now: true} means: a Date, epoch milliseconds or RFC 3339. */
  now?: Date | number | string;
  permits?: Permits;
  mode?: Mode;
}

export declare function parse(raw: string | unknown, options?: { mode?: Mode; allowHolds?: boolean }): Node;
export declare function evaluate(node: Node, scope: Scope): boolean;
export declare function lookup(scope: Scope, path: string): [unknown, boolean];
export declare function describe(node: Node): string;
export declare function fields(node: Node): string[];
