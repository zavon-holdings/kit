import type { Graph } from "../types.js";

/**
 * A decision tree with one of everything the editor draws: a condition, a
 * review that routes by outcome, a fork and its join, a delay and a decision.
 * Neutral names; it compiles.
 */
export function sampleTree(): Graph {
  return {
    format: "workflow.graph/1",
    nodes: [
      { id: "start", type: "start" },
      { id: "large", name: "Large request?", type: "condition", config: { when: { field: "vars.amount", op: "gte", value: 1000 } } },
      { id: "approve", name: "Review", type: "review", config: { outcomes: [{ name: "approved" }, { name: "rejected" }] } },
      { id: "declined", name: "Say no", type: "email", config: { template_code: "declined" } },
      { id: "prepare", name: "Prepare", type: "fork" },
      { id: "confirm", name: "Confirm", type: "email", config: { template_code: "confirmed" } },
      { id: "pause", name: "Two days", type: "delay", config: { unit: "days", value: 2 } },
      { id: "both", name: "Both done", type: "join", config: { join: "all" } },
      { id: "tier", name: "Which tier?", type: "decision" },
      { id: "high", name: "Mark high", type: "set_var", config: { set: { priority: "high" } } },
      { id: "normal", name: "Mark normal", type: "set_var", config: { set: { priority: "normal" } } },
      { id: "done", name: "Done", type: "end", config: { outcome: "completed" } },
      { id: "refused", name: "Refused", type: "end", config: { outcome: "declined" } },
    ],
    edges: [
      { from: "start", to: "large" },
      { from: "large", to: "approve", label: "yes" },
      { from: "large", to: "prepare", label: "no", default: true },
      { from: "approve", to: "prepare", label: "approved" },
      { from: "approve", to: "declined", label: "rejected" },
      { from: "approve", to: "declined", label: "otherwise", default: true },
      { from: "declined", to: "refused" },
      { from: "prepare", to: "confirm", label: "tell" },
      { from: "prepare", to: "pause", label: "wait" },
      { from: "confirm", to: "both" },
      { from: "pause", to: "both" },
      { from: "both", to: "tier" },
      { from: "tier", to: "high", label: "gold", when: { field: "vars.tier", op: "is", value: "gold" } },
      { from: "tier", to: "normal", label: "standard", default: true },
      { from: "high", to: "done" },
      { from: "normal", to: "done" },
    ],
  };
}
