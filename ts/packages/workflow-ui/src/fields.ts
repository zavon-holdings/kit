/**
 * The fields a condition is likely to read, offered as somebody types: the
 * sample's vars, the subject, each review or form's outcome, the event.
 * Suggestions only — any field the condition language reads may be typed.
 */
import { isTask } from "./catalogue.js";
import type { Graph, Sample } from "./types.js";

export function fieldSuggestions(g: Graph, sample?: Sample): string[] {
  const out = new Set<string>();
  for (const k of Object.keys(sample?.vars ?? {})) out.add(`vars.${k}`);
  out.add("subject.type");
  out.add("subject.pid");
  for (const n of g.nodes) {
    if (isTask(n.type)) out.add(`steps.${n.id}.output.outcome`);
    if (n.type === "wait_event") out.add(`steps.${n.id}.output.event`);
    if (n.type === "decide") {
      const qs = (n.config as { questions?: { key?: unknown }[] } | undefined)?.questions;
      for (const q of Array.isArray(qs) ? qs : []) if (typeof q?.key === "string" && q.key) out.add(`steps.${n.id}.output.${q.key}.answer`);
    }
  }
  out.add("event.type");
  for (const k of Object.keys(sample?.event?.vars ?? {})) out.add(`event.vars.${k}`);
  return [...out];
}
