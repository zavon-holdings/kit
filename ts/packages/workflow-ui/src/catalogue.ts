/**
 * The node vocabulary the editor offers, grouped as the palette shows it.
 *
 * The types are the ones @zavon/workflow-graph compiles. Generated steps
 * (`<id>--goto`, `<id>--route`) are never nodes: they are how an edge is
 * written down, and the Steps panel maps them back with nodeOf.
 */

export type NodeGroup = "Logic" | "People" | "Messages" | "Timing" | "Apps";

export type NodeKind = {
  type: string;
  label: string;
  group: NodeGroup | "Structure";
  blurb: string;
  /** The config a freshly added node starts with. */
  config?: Record<string, unknown>;
};

export const NODE_KINDS: readonly NodeKind[] = Object.freeze([
  { type: "start", label: "Start", group: "Structure", blurb: "Where every run begins. The trigger belongs to the definition." },
  { type: "condition", label: "Condition", group: "Logic", blurb: "Asks one question: yes or no.", config: { when: {} } },
  { type: "decision", label: "Decision", group: "Logic", blurb: "Several ways out, each with its own condition, and a default." },
  { type: "fork", label: "Fork", group: "Logic", blurb: "Runs two or more arms at once." },
  { type: "join", label: "Join", group: "Logic", blurb: "Where a fork's arms meet: all, any, or a quorum.", config: { join: "all" } },
  { type: "end", label: "End", group: "Logic", blurb: "Ends the run with an outcome.", config: { outcome: "completed" } },
  {
    type: "review",
    label: "Review",
    group: "People",
    blurb: "Somebody decides; each outcome can lead somewhere else.",
    config: { outcomes: [{ name: "approved" }, { name: "rejected" }] },
  },
  { type: "form", label: "Form", group: "People", blurb: "Somebody fills something in." },
  { type: "email", label: "Email", group: "Messages", blurb: "Sends one email.", config: { template_code: "" } },
  { type: "notification", label: "Notification", group: "Messages", blurb: "Tells people by email or in the app.", config: { channel: "email", to: [] } },
  { type: "delay", label: "Delay", group: "Timing", blurb: "Waits a while before going on.", config: { value: 1, unit: "days" } },
  { type: "wait_event", label: "Wait for event", group: "Timing", blurb: "Waits until something happens, with an optional timeout.", config: { event: [] } },
  { type: "call", label: "Call an app", group: "Apps", blurb: "Asks an app to do something.", config: { action: "" } },
  { type: "webhook", label: "Webhook", group: "Apps", blurb: "Calls an allowed address over HTTPS.", config: { url: "" } },
  { type: "set_var", label: "Set a value", group: "Apps", blurb: "Writes values the rest of the run can read.", config: { set: {} } },
]);

export const PALETTE_GROUPS: readonly NodeGroup[] = ["Logic", "People", "Messages", "Timing", "Apps"];

const byType = new Map(NODE_KINDS.map((k) => [k.type, k]));

export function kindOf(type: string): NodeKind {
  return byType.get(type) ?? { type, label: type, group: "Apps", blurb: "" };
}

export function typeLabel(type: string): string {
  return kindOf(type).label;
}

/** A node type whose outcome edges route by name (a task with outcomes). */
export const isTask = (type: string) => type === "review" || type === "form";

/**
 * How a node's ways out are written, which decides what the edge editor
 * offers:
 *  - sequence: one unlabelled way on;
 *  - condition: yes and no, one of them the default, the question on the node;
 *  - decision: labelled ways out, each with a condition, exactly one default;
 *  - routes: a review or form's outcomes, by name, exactly one default;
 *  - fork: unlabelled or named arms (step-code words);
 *  - wait: one way on, and one more labelled "timeout";
 *  - none: an end.
 */
export type EdgeRole = "sequence" | "condition" | "decision" | "routes" | "fork" | "wait" | "none";

export function edgeRole(type: string, outCount = 0, labelled = false): EdgeRole {
  switch (type) {
    case "end":
      return "none";
    case "condition":
      return "condition";
    case "decision":
      return "decision";
    case "fork":
      return "fork";
    case "wait_event":
      return "wait";
    default:
      if (isTask(type) && (outCount > 1 || labelled)) return "routes";
      return "sequence";
  }
}

/** Roles whose edges carry a label and exactly one default. */
export const chooses = (role: EdgeRole) => role === "condition" || role === "decision" || role === "routes";
