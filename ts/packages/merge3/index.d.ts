/** Any JSON value. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * One node of a tree. `key` identifies it across versions (keys beginning
 * with "~" are reserved); `fields` maps a path to a JSON value; `slots`
 * maps a name to ordered children.
 */
export interface Unit {
  key?: string;
  kind: string;
  fields?: Record<string, Json>;
  slots?: Record<string, Unit[]>;
}

/** Where a unit sits: its parent's key ("~" is the root) and the slot. */
export interface Place {
  parent: string;
  slot: string;
}

/** The key conflicts use for the root unit. */
export const ROOT: "~";
export const KIND_FIELD: "field";
export const KIND_DELETE: "delete";
export const KIND_MOVE: "move";
export const KIND_ORDER: "order";

interface ConflictBase {
  /** Stable: kind, the unit's key and the path. */
  id: string;
  /** The unit's key (a parent's, for an order). Synthetic for a unit without one. */
  key: string;
}

/**
 * One stretch of a text merge: nobody changed it, one side did, both did the
 * same, or both did differently.
 */
export type TextChunk =
  | { op: "same"; text: string }
  | { op: "a"; base: string; a: string }
  | { op: "b"; base: string; b: string }
  | { op: "both"; base: string; text: string }
  | { op: "conflict"; base: string; a: string; b: string };

/** Both sides changed one field (or "@kind") differently. A side's value is absent when it removed the field. */
export interface FieldConflict extends ConflictBase {
  kind: "field";
  path: string;
  base?: Json;
  a?: Json;
  b?: Json;
  /**
   * A text field's merge (MergeOptions.text): the merged chunks with the
   * clashing ones among them. On such a conflict "a"/"b" take that side in
   * every clash (the merged words elsewhere), "both" A's then B's, and
   * "manual" the whole value.
   */
  chunks?: TextChunk[];
}

/** One side deleted the unit; the other changed it, beneath it, or its place. Tentatively kept. */
export interface DeleteConflict extends ConflictBase {
  kind: "delete";
  /** The side that deleted it. */
  side: "a" | "b";
}

/** The sides put the unit in different places, or their moves would make a cycle. */
export interface MoveConflict extends ConflictBase {
  kind: "move";
  path: "@parent";
  base?: Place;
  a?: Place;
  b?: Place;
}

/** Both sides reordered a slot differently; the orders list the keys all three kept there. */
export interface OrderConflict extends ConflictBase {
  kind: "order";
  /** The slot's name. */
  path: string;
  base: string[];
  a: string[];
  b: string[];
}

export type Conflict = FieldConflict | DeleteConflict | MoveConflict | OrderConflict;

/**
 * How to settle one conflict. "manual" needs `value`: a field's value, a
 * boolean (keep) for a delete, a Place for a move, the keys in order for an
 * order. "both" keeps a moved unit in A's place and a copy in B's, keeps a
 * deleted one, and — only with `duplicateAsUnits` — keeps a unit with a
 * field conflict twice (A's value, then a copy with B's). An order has no
 * "both".
 */
export interface Decision {
  /** On a text conflict "both" needs no duplicateAsUnits: it is A's words then B's in each clash. */
  choice: "a" | "b" | "both" | "manual";
  value?: Json | Place;
}

export interface ResolveOptions {
  duplicateAsUnits?: boolean;
  /** Names a copy; must return a key for which taken() is false. Default: key + "~b", "~b2", …. */
  mintKey?: (old: string, taken: (key: string) => boolean) => string;
}

export interface Resolution {
  tree: Unit;
  /** The key of every unit "both" copied → its copy's key. */
  ids: Record<string, string>;
  /** Conflicts no decision settled; they keep their tentative outcome. */
  conflicts: Conflict[];
}

export interface MergeResult {
  /** The merged tree, each conflict tentatively settled (A's side; a deleted-and-changed unit kept). */
  tree: Unit;
  /** Sorted by id. */
  conflicts: Conflict[];
  /** Same as resolve(result, decisions, options). */
  resolve(decisions: Record<string, Decision>, options?: ResolveOptions): Resolution;
}

export interface MergeOptions {
  /** Field paths merged as text, token by token, when all three values are strings. Only words: never an address or a colour. */
  text?: string[];
}

/** Three-way merge of a and b, two edits of base. Throws on an invalid tree. */
export function merge3(base: Unit, a: Unit, b: Unit, options?: MergeOptions): MergeResult;

/** The text merge on its own: the chunks, and whether any clashed. */
export function mergeText(base: string, a: string, b: string): { chunks: TextChunk[]; conflict: boolean };
/** The chunks written out, each clash chosen with pick ("a" by default; "both" is A's then B's). */
export function joinText(chunks: TextChunk[], pick?: "a" | "b" | "both"): string;
/** A string split as the text merge splits it. */
export function tokens(s: string): string[];
export const MAX_TEXT_CELLS: number;

/** Settle the named conflicts. Throws on an unknown id, a refused "both" or a manual without a value. */
export function resolve(result: MergeResult, decisions: Record<string, Decision>, options?: ResolveOptions): Resolution;

/** Throws unless every key is unique and unreserved and slots hold units. */
export function validate(root: Unit): void;
export function isValid(root: unknown): boolean;

/** The unit as written: an empty key, fields or slots map left out. */
export function unitValue(u: Unit): Unit;
/** JSON with object keys sorted, no spaces: the same text the Go twin writes. */
export function canonical(v: unknown): string;
/** Hex SHA-256 of a string's UTF-8 bytes. */
export function sha256(s: string): string;
