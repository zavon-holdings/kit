/**
 * The node vocabulary the editor offers, grouped as the palette shows it.
 *
 * The types are the ones @zavon/workflow-graph compiles. Generated steps
 * (`<id>--goto`, `<id>--route`) are never nodes: they are how an edge is
 * written down, and the Steps panel maps them back with nodeOf.
 */

export type NodeGroup = "Logic" | "People" | "Messages" | "Money" | "Timing" | "Apps";

export type NodeKind = {
  type: string;
  label: string;
  group: NodeGroup | "Structure";
  blurb: string;
  /** The config a freshly added node starts with. */
  config?: Record<string, unknown>;
};

export const NODE_KINDS: readonly NodeKind[] = Object.freeze([
  { type: "start", label: "Start", group: "Structure", blurb: "Where every run begins. The trigger is set on the workflow." },
  { type: "condition", label: "Condition", group: "Logic", blurb: "A yes/no branch.", config: { when: {} } },
  { type: "decision", label: "Decision", group: "Logic", blurb: "Multiple branches, each with a condition, plus a default." },
  { type: "fork", label: "Fork", group: "Logic", blurb: "Runs two or more branches in parallel." },
  { type: "join", label: "Join", group: "Logic", blurb: "Merges parallel branches: all, any, or a quorum.", config: { join: "all" } },
  { type: "end", label: "End", group: "Logic", blurb: "Ends the run with an outcome.", config: { outcome: "completed" } },
  {
    type: "loop",
    label: "Loop",
    group: "Logic",
    blurb: "Repeats a chain of steps: over a list, a number of times, or while a condition holds.",
    config: { over: { count: 3 }, max_iterations: 100 },
  },
  {
    type: "sub_workflow",
    label: "Sub-workflow",
    group: "Logic",
    blurb: "Runs another workflow and, by default, waits for its outcome.",
    config: { definition: "", wait: true },
  },
  {
    type: "review",
    label: "Review",
    group: "People",
    blurb: "A reviewer chooses an outcome; each outcome can branch.",
    config: { outcomes: [{ name: "approved" }, { name: "rejected" }] },
  },
  { type: "form", label: "Form", group: "People", blurb: "Collects information from a person." },
  {
    type: "approval",
    label: "Approval",
    group: "People",
    blurb: "Named approvers approve or reject. No approvers found is never an approval.",
    config: { assignees: [], mode: "any" },
  },
  {
    type: "todo",
    label: "To-do",
    group: "People",
    blurb: "A task for named people, with a due date; complete when they mark it done.",
    config: { assignees: [], due: { value: 3, unit: "business_days" } },
  },
  { type: "email", label: "Email", group: "Messages", blurb: "Sends one email.", config: { template_code: "" } },
  { type: "notification", label: "Notification", group: "Messages", blurb: "Notifies people by email or in the app.", config: { channel: "email", to: [] } },
  {
    type: "payment_request",
    label: "Payment request",
    group: "Money",
    blurb: "Requests a payment link, notifies the payer, and waits: paid, failed or expired.",
    config: { action: "", amount: 0, currency: "ZAR", expires: { value: 7, unit: "days" } },
  },
  {
    type: "invoice",
    label: "Invoice",
    group: "Money",
    blurb: "Issues a numbered invoice, sends it, reminds, and waits: paid, voided or overdue.",
    config: { action: "", amount: 0, currency: "ZAR", due: { value: 14, unit: "days" } },
  },
  { type: "delay", label: "Delay", group: "Timing", blurb: "Pauses for a set time.", config: { value: 1, unit: "days" } },
  { type: "wait_event", label: "Wait for event", group: "Timing", blurb: "Waits for an event, with an optional timeout.", config: { event: [] } },
  { type: "call", label: "Call an app", group: "Apps", blurb: "Runs an action in an app.", config: { action: "" } },
  { type: "webhook", label: "Webhook", group: "Apps", blurb: "Calls an allowed address over HTTPS.", config: { url: "" } },
  { type: "set_var", label: "Set a value", group: "Apps", blurb: "Stores values for later steps.", config: { set: {} } },
]);

export const PALETTE_GROUPS: readonly NodeGroup[] = ["Logic", "People", "Messages", "Money", "Timing", "Apps"];

const byType = new Map(NODE_KINDS.map((k) => [k.type, k]));

export function kindOf(type: string): NodeKind {
  return byType.get(type) ?? { type, label: type, group: "Apps", blurb: "" };
}

export function typeLabel(type: string): string {
  return kindOf(type).label;
}

/** A node type whose outcome edges route by name: a task, or a sub-workflow (its child's outcome). */
export const isTask = (type: string) => type === "review" || type === "form" || type === "approval" || type === "sub_workflow";

/** The only outcomes a node type can finish with, when the type decides them; the default is listed first. */
export const FIXED_OUTCOMES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  approval: ["approved", "rejected"],
  payment_request: ["paid", "failed", "expired"],
  invoice: ["paid", "voided", "overdue"],
});

/** The outcome a money node falls back on when nothing else is reported. */
export const FALLBACK_OUTCOME: Readonly<Record<string, string>> = Object.freeze({ payment_request: "expired", invoice: "overdue" });

/** A node whose ways out are always its outcomes, by name. */
export const isMoney = (type: string) => type === "payment_request" || type === "invoice";

/**
 * How a node's ways out are written, which decides what the edge editor
 * offers:
 *  - sequence: one unlabelled way on;
 *  - condition: yes and no, one of them the default, the question on the node;
 *  - decision: labelled ways out, each with a condition, exactly one default;
 *  - routes: a review or form's outcomes, by name, exactly one default;
 *  - fork: unlabelled or named arms (step-code words);
 *  - wait: one way on, and one more labelled "timeout";
 *  - loop: "body" to the first step it repeats, and "next" to what follows;
 *  - none: an end.
 */
export type EdgeRole = "sequence" | "condition" | "decision" | "routes" | "fork" | "wait" | "loop" | "none";

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
    case "loop":
      return "loop";
    case "payment_request":
    case "invoice":
      return "routes";
    default:
      if (isTask(type) && (outCount > 1 || labelled)) return "routes";
      return "sequence";
  }
}

/** Roles whose edges carry a label and exactly one default. */
export const chooses = (role: EdgeRole) => role === "condition" || role === "decision" || role === "routes";
