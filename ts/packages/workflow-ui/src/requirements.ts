/**
 * Step requirements in the editor: which fields a review step may require
 * before an item moves on, and the fields a step keeps on the item itself.
 *
 * A review node's config carries both:
 *   required_fields: ["score", "reviewer"]          — what must be filled
 *   fields: [{key, label, type, options?}]           — fields this step keeps
 * The server checks required_fields against the same catalogue at save and
 * refuses a key it cannot check, so a step can never require the impossible.
 */
import type { Graph, GraphNode } from "./types.js";

/** One field a step may require. Same shape as @zavon/step-gates CatalogueField. */
export type RequirementField = {
  key: string;
  label: string;
  type?: string;
  /** Where the value comes from, in words: "Form: Application", "Kept on the item". */
  source?: string;
  options?: string[];
};

/** The types a field kept on the item may have. */
export const ITEM_FIELD_TYPES: { type: string; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "number", label: "Number" },
  { type: "date", label: "Date" },
  { type: "choice", label: "Choice" },
  { type: "email", label: "Email address" },
];

export const KEPT_ON_ITEM = "Kept on the item";

type RawField = { key?: unknown; label?: unknown; type?: unknown; options?: unknown };

function readFields(node: GraphNode): RequirementField[] {
  const raw = (node.config as { fields?: unknown } | undefined)?.fields;
  if (!Array.isArray(raw)) return [];
  const out: RequirementField[] = [];
  for (const f of raw as RawField[]) {
    if (!f || typeof f.key !== "string" || !f.key.trim()) continue;
    const field: RequirementField = {
      key: f.key.trim().toLowerCase(),
      label: typeof f.label === "string" && f.label.trim() ? f.label.trim() : f.key,
      type: typeof f.type === "string" && f.type ? f.type : "text",
    };
    if (Array.isArray(f.options)) field.options = f.options.filter((o): o is string => typeof o === "string");
    out.push(field);
  }
  return out;
}

/** The fields a review node requires, as stored. */
export function requiredOf(node: GraphNode): string[] {
  const raw = (node.config as { required_fields?: unknown } | undefined)?.required_fields;
  return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : [];
}

/** The fields a review node keeps on the item. */
export function itemFieldsOf(node: GraphNode): RequirementField[] {
  return readFields(node).map((f) => ({ ...f, source: KEPT_ON_ITEM }));
}

/**
 * Every field a step of this graph may require: the host's (the record's own
 * fields and saved forms, from the server's catalogue), then the questions of
 * form nodes in the graph, then fields kept on the item by review nodes. The
 * first source to name a key wins; the graph's are what the editor has not
 * saved yet.
 */
export function catalogueFromGraph(g: Graph, host: RequirementField[] = []): RequirementField[] {
  const seen = new Set<string>();
  const out: RequirementField[] = [];
  const add = (f: RequirementField) => {
    if (seen.has(f.key)) return;
    seen.add(f.key);
    out.push(f);
  };
  host.forEach(add);
  for (const n of g.nodes) {
    if (n.type === "form") readFields(n).forEach((f) => add({ ...f, source: `Form: ${n.name || n.id}` }));
  }
  for (const n of g.nodes) {
    if (n.type === "review") itemFieldsOf(n).forEach(add);
  }
  return out;
}

/** A key for a new field, from its label, that no field in `taken` uses. */
export function keyFor(label: string, taken: Iterable<string>): string {
  let base = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!base) base = "field";
  if (/^[0-9]/.test(base)) base = `f_${base}`;
  const used = new Set(taken);
  let key = base;
  for (let i = 2; used.has(key); i++) key = `${base}_${i}`;
  return key;
}

/** Writes a review node's requirements and kept fields back into its config. */
export function withRequirements(
  config: Record<string, unknown> | undefined,
  required: string[],
  fields: RequirementField[],
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(config ?? {}) };
  if (required.length) next.required_fields = required;
  else delete next.required_fields;
  const kept = fields.map(({ key, label, type, options }) => (options?.length ? { key, label, type, options } : { key, label, type }));
  if (kept.length) next.fields = kept;
  else delete next.fields;
  return next;
}

/** What "Suggest requirements" sends: the workflow's steps and the fields they may require. */
export type RequirementSuggestInput = {
  workflow?: string;
  stages: { code: string; name: string; required: string[] }[];
  fields: { key: string; label: string; type?: string; source?: string }[];
};

/** One proposal for one step: draft chips a person accepts one by one. */
export type RequirementSuggestion = { stage: string; fields: string[]; reason: string };

/** The input for every review step of a graph, with the catalogue the editor offers. */
export function suggestInput(g: Graph, catalogue: RequirementField[], workflow?: string): RequirementSuggestInput {
  return {
    ...(workflow ? { workflow } : {}),
    stages: g.nodes.filter((n) => n.type === "review").map((n) => ({ code: n.id, name: n.name || n.id, required: requiredOf(n) })),
    fields: catalogue.map(({ key, label, type, source }) => ({ key, label, ...(type ? { type } : {}), ...(source ? { source } : {}) })),
  };
}

/** Drafts for one step: keys the catalogue holds that the step does not require yet. */
export function draftsFor(stage: string, suggestions: RequirementSuggestion[], required: string[], catalogue: RequirementField[]): { fields: string[]; reason: string } {
  const known = new Set(catalogue.map((f) => f.key));
  const have = new Set(required);
  const s = suggestions.find((x) => x.stage === stage);
  if (!s) return { fields: [], reason: "" };
  return { fields: s.fields.filter((k) => known.has(k) && !have.has(k)), reason: s.reason };
}
