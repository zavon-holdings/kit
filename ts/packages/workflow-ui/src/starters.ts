/**
 * Decision trees to start from, so a new workflow opens as something to
 * change rather than a blank page. Each compiles as it stands and saves
 * with a manual trigger (messages go in-app to the run's subject, the one
 * recipient every workflow has); names and the waited-for event are
 * placeholders to change.
 */
import { FORMAT } from "@zavon/workflow-graph";
import { emptyGraph } from "./model.js";
import type { Graph } from "./types.js";

export type Starter = { code: string; name: string; blurb: string; graph: () => Graph; trigger?: string };

export const STARTERS: readonly Starter[] = Object.freeze([
  { code: "blank", name: "Blank", blurb: "A start and an end.", graph: emptyGraph },
  {
    code: "review-and-route",
    name: "Somebody decides",
    blurb: "A review; approved goes on, anything else is told no.",
    graph: (): Graph => ({
      format: FORMAT,
      nodes: [
        { id: "start", type: "start" },
        { id: "review", name: "Review", type: "review", config: { outcomes: [{ name: "approved" }, { name: "rejected" }] } },
        { id: "tell-yes", name: "Say yes", type: "notification", config: { channel: "in_app", in_app: { title: "Approved" }, to: [{ subject: true }] } },
        { id: "tell-no", name: "Say no", type: "notification", config: { channel: "in_app", in_app: { title: "Not approved" }, to: [{ subject: true }] } },
        { id: "approved", name: "Approved", type: "end", config: { outcome: "approved" } },
        { id: "declined", name: "Declined", type: "end", config: { outcome: "declined" } },
      ],
      edges: [
        { from: "start", to: "review" },
        { from: "review", to: "tell-yes", label: "approved" },
        { from: "review", to: "tell-no", label: "otherwise", default: true },
        { from: "tell-yes", to: "approved" },
        { from: "tell-no", to: "declined" },
      ],
    }),
  },
  {
    code: "route-by-value",
    name: "Route by a value",
    blurb: "A decision on a run value, three ways, each ending its own way.",
    graph: (): Graph => ({
      format: FORMAT,
      nodes: [
        { id: "start", type: "start" },
        { id: "how-much", name: "How much?", type: "decision" },
        { id: "large", name: "Large", type: "review", config: { outcomes: [{ name: "approved" }, { name: "rejected" }] } },
        { id: "medium", name: "Medium", type: "notification", config: { channel: "in_app", in_app: { title: "A medium request" }, to: [{ subject: true }] } },
        { id: "small", name: "Small", type: "set_var", config: { set: { route: "small" } } },
        { id: "done", name: "Done", type: "end", config: { outcome: "completed" } },
      ],
      edges: [
        { from: "start", to: "how-much" },
        { from: "how-much", to: "large", label: "large", when: { field: "vars.amount", op: "gte", value: 10000 } },
        { from: "how-much", to: "medium", label: "medium", when: { field: "vars.amount", op: "gte", value: 1000 } },
        { from: "how-much", to: "small", label: "small", default: true },
        { from: "large", to: "done" },
        { from: "medium", to: "done" },
        { from: "small", to: "done" },
      ],
    }),
  },
  {
    code: "wait-or-chase",
    name: "Wait, then chase",
    blurb: "Wait for an event; if it does not come in time, remind once and wait again.",
    trigger: "event",
    graph: (): Graph => ({
      format: FORMAT,
      nodes: [
        { id: "start", type: "start" },
        { id: "wait", name: "Wait for the answer", type: "wait_event", config: { event: ["app.thing.answered"], timeout: { value: 3, unit: "days" } } },
        { id: "chased", name: "Chased already?", type: "condition", config: { when: { field: "vars.chased", op: "is", value: true } } },
        { id: "remind", name: "Remind", type: "notification", config: { channel: "in_app", in_app: { title: "A reminder" }, to: [{ subject: true }] } },
        { id: "mark", name: "Mark chased", type: "set_var", config: { set: { chased: true } } },
        { id: "answered", name: "Answered", type: "end", config: { outcome: "answered" } },
        { id: "gave-up", name: "No answer", type: "end", config: { outcome: "unanswered" } },
      ],
      edges: [
        { from: "start", to: "wait" },
        { from: "wait", to: "answered" },
        { from: "wait", to: "chased", label: "timeout" },
        { from: "chased", to: "gave-up", label: "yes" },
        { from: "chased", to: "remind", label: "no", default: true },
        { from: "remind", to: "mark" },
        { from: "mark", to: "wait" },
      ],
    }),
  },
  {
    code: "do-both",
    name: "Two things at once",
    blurb: "A fork whose arms run together, joined when both are done.",
    graph: (): Graph => ({
      format: FORMAT,
      nodes: [
        { id: "start", type: "start" },
        { id: "both", name: "Both at once", type: "fork" },
        { id: "tell", name: "Tell them", type: "notification", config: { channel: "in_app", in_app: { title: "It has started" }, to: [{ subject: true }] } },
        { id: "ask", name: "Give it a day", type: "delay", config: { value: 1, unit: "days" } },
        { id: "meet", name: "Both done", type: "join", config: { join: "all" } },
        { id: "done", name: "Done", type: "end", config: { outcome: "completed" } },
      ],
      edges: [
        { from: "start", to: "both" },
        { from: "both", to: "tell" },
        { from: "both", to: "ask" },
        { from: "tell", to: "meet" },
        { from: "ask", to: "meet" },
        { from: "meet", to: "done" },
      ],
    }),
  },
]);
