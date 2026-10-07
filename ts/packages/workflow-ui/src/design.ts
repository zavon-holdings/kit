/**
 * How a node and an edge look, worked out from the graph alone: the
 * category a node type is coloured by, the one line that sums a node up on
 * its card, and the tone an outcome is drawn in. Pure, so the canvas, the
 * List tab and the tests agree.
 *
 * Colour is never the only signal: a category also has an icon and a word,
 * and an outcome keeps its own label.
 */
import { TIMEOUT_LABEL } from "@zavon/workflow-graph";
import { kindOf } from "./catalogue.js";
import type { Graph, GraphNode } from "./types.js";

/** What a node is coloured by. Start and end are "structure". */
export type NodeCategory = "logic" | "people" | "messages" | "money" | "timing" | "apps" | "structure";

export const CATEGORY_LABELS: Readonly<Record<NodeCategory, string>> = Object.freeze({
  logic: "Logic",
  people: "People and approvals",
  messages: "Messages",
  money: "Money",
  timing: "Timing",
  apps: "Apps and integrations",
  structure: "Start and end",
});

export function categoryOf(type: string): NodeCategory {
  if (type === "start" || type === "end") return "structure";
  return kindOf(type).group.toLowerCase() as NodeCategory;
}

/** The meaning an outcome carries, for its colour. "neutral" when the words say nothing. */
export type Tone = "ok" | "danger" | "warn" | "neutral";

const OK = new Set(["approved", "approve", "yes", "true", "paid", "completed", "complete", "accepted", "accept", "succeeded", "success", "done", "passed", "pass", "confirmed", "signed"]);
const DANGER = new Set(["rejected", "reject", "no", "false", "declined", "decline", "failed", "fail", "voided", "void", "cancelled", "canceled", "denied", "refused", "error", "unpaid", "abandoned"]);
const WARN = new Set([TIMEOUT_LABEL, "timeout", "timed_out", "timed out", "expired", "expire", "overdue", "withdrawn", "withdraw", "escalated", "escalate", "late", "unanswered", "lapsed", "stale"]);

/** The tone of an outcome's words: "approved" is ok, "rejected" danger, "timeout" warn. */
export function outcomeTone(label: string | undefined | null): Tone {
  const w = (label ?? "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (!w) return "neutral";
  const plain = w.replace(/_/g, " ");
  if (OK.has(w) || OK.has(plain)) return "ok";
  if (DANGER.has(w) || DANGER.has(plain)) return "danger";
  if (WARN.has(w) || WARN.has(plain)) return "warn";
  return "neutral";
}

/** The outcome an end node finishes a run with (its config's, else "completed"). */
export function endOutcome(node: GraphNode): string {
  const o = (node.config as { outcome?: unknown } | undefined)?.outcome;
  return typeof o === "string" && o.trim() ? o.trim() : "completed";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function duration(v: unknown): string {
  const d = v as { value?: unknown; unit?: unknown } | undefined;
  if (!d || typeof d !== "object") return "";
  const n = Number(d.value);
  const unit = typeof d.unit === "string" ? d.unit.replace(/_/g, " ") : "";
  if (!Number.isFinite(n) || !unit) return "";
  const one = unit.endsWith("s") ? unit.slice(0, -1) : unit;
  return n === 1 ? `1 ${one}` : `${n} ${unit}`;
}

/** Who a task's assignees are, as briefly as words allow. */
function people(v: unknown): string {
  if (!Array.isArray(v) || v.length === 0) return "";
  const names: string[] = [];
  let other = 0;
  for (const src of v) {
    const s = src as Record<string, unknown> | null;
    if (!s || typeof s !== "object") continue;
    if (Array.isArray(s.people)) {
      for (const p of s.people) {
        const e = (p as { email?: unknown; name?: unknown } | null) ?? {};
        const who = typeof e.name === "string" && e.name ? e.name : typeof e.email === "string" ? e.email : "";
        if (who) names.push(who);
      }
    } else if (typeof s.email === "string") names.push(s.email);
    else if (s.subject) names.push("the subject");
    else if (typeof s.role === "string") names.push(`role ${s.role}`);
    else other++;
  }
  if (names.length === 0) return other ? plural(other, "source") : "";
  return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
}

function money(c: Record<string, unknown>): string {
  const v = c.amount as { var?: unknown } | number | undefined;
  if (v && typeof v === "object" && typeof v.var === "string") return `Amount from ${v.var}`;
  const amount = Number(v);
  const cur = typeof c.currency === "string" ? c.currency : "";
  if (!Number.isFinite(amount) || amount <= 0) return "";
  // Amounts are minor units (cents).
  const major = amount / 100;
  return `${cur} ${major.toLocaleString("en", { minimumFractionDigits: major % 1 ? 2 : 0, maximumFractionDigits: 2 })}`.trim();
}

/**
 * One line that says who, when or what: "office@example.org", "1 day",
 * "ZAR 1,250 · expires in 3 days". Empty when the settings say nothing yet.
 */
export function summarize(node: GraphNode, graph?: Graph): string {
  const c = (node.config ?? {}) as Record<string, unknown>;
  const outs = graph ? graph.edges.filter((e) => e.from === node.id).length : 0;
  switch (node.type) {
    case "condition":
    case "decision":
      return outs ? plural(outs, "branch", "branches") : "";
    case "fork":
      return outs ? `${outs} in parallel` : "";
    case "join":
      return c.join === "any" ? "When any arm arrives" : c.join === "quorum" ? `When ${Number(c.quorum) || 2} arms arrive` : "When all arms arrive";
    case "loop": {
      const over = c.over as Record<string, unknown> | undefined;
      if (over && typeof over.count === "number") return `${plural(over.count, "time")}`;
      if (over && typeof over.list === "string") return `For each in ${over.list}`;
      if (c.while) return "While a condition holds";
      return "";
    }
    case "sub_workflow":
      return typeof c.definition === "string" && c.definition ? `Runs ${c.definition}` : "";
    case "review":
    case "form":
    case "approval":
    case "todo": {
      const who = people(c.assignees);
      const due = duration(c.due);
      if (node.type === "approval" && who) return `${who}${c.mode === "all" ? " · all must approve" : ""}`;
      return [who, due && `due in ${due}`].filter(Boolean).join(" · ");
    }
    case "email":
      return typeof c.template_code === "string" && c.template_code ? `Template ${c.template_code}` : "";
    case "notification": {
      const ch = c.channel === "in_app" ? "In the app" : c.channel === "email" ? "By email" : "";
      const title = (c.in_app as { title?: unknown } | undefined)?.title;
      return [ch, typeof title === "string" ? title : ""].filter(Boolean).join(" · ");
    }
    case "payment_request": {
      const exp = duration(c.expires);
      return [money(c), exp && `expires in ${exp}`].filter(Boolean).join(" · ");
    }
    case "invoice": {
      const due = duration(c.due);
      return [money(c), due && `due in ${due}`].filter(Boolean).join(" · ");
    }
    case "delay":
      return duration(c) ? `Wait ${duration(c)}` : "";
    case "wait_event": {
      const ev = Array.isArray(c.event) ? c.event.filter((x) => typeof x === "string") : typeof c.event === "string" ? [c.event] : [];
      const t = duration(c.timeout);
      return [ev.length ? (ev.length === 1 ? ev[0] : `${ev[0]} +${ev.length - 1}`) : "", t && `times out in ${t}`].filter(Boolean).join(" · ");
    }
    case "call":
      return typeof c.action === "string" ? c.action : "";
    case "webhook": {
      if (typeof c.url !== "string" || !c.url) return "";
      try {
        return `POST ${new URL(c.url).host}`;
      } catch {
        return c.url;
      }
    }
    case "set_var": {
      const keys = c.set && typeof c.set === "object" ? Object.keys(c.set as object) : [];
      return keys.length ? `Sets ${keys.slice(0, 2).join(", ")}${keys.length > 2 ? ` +${keys.length - 2}` : ""}` : "";
    }
    case "end":
      return endOutcome(node);
    default:
      return "";
  }
}
