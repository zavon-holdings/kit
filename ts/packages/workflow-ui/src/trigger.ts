/**
 * What starts a run. The trigger belongs to the definition, not the graph,
 * so the editor holds it only when the host hands it in; this module is its
 * shape, its words, and the checks the trigger panel shows while somebody
 * edits. The server's own checks decide — these say early what it will say.
 */
import { parse } from "@zavon/conditions";

export type TriggerKind = "manual" | "event" | "schedule" | "date" | "api";
export type SubjectKind = "person" | "org" | "external";

/** A definition's trigger, in the shape a workflow service takes it. */
export type Trigger = {
  kind: TriggerKind | string;
  event_type?: string;
  cron_expression?: string;
  subject_kind?: SubjectKind | string;
  subject_var?: string;
  subject_type?: string;
  /** The event filter: a condition tree, read in trigger mode (a bare name is an event var). */
  filter?: unknown;
  date_var?: string;
  date_offset_days?: number;
  date_recurs?: boolean;
  once_per_subject?: boolean;
};

/** An event a trigger can start on, as a service's catalogue lists it. */
export type CatalogueEvent = { type: string; label?: string; subject?: string; vars?: string[] };

export const TRIGGER_KINDS: readonly { kind: TriggerKind; label: string; blurb: string }[] = Object.freeze([
  { kind: "manual", label: "By hand", blurb: "Somebody starts each run." },
  { kind: "event", label: "When something happens", blurb: "An event an app reports starts a run, when its filter matches." },
  { kind: "schedule", label: "On a schedule", blurb: "A run starts at set times." },
  { kind: "date", label: "On a date", blurb: "A run starts on (or before or after) a date the subject carries." },
  { kind: "api", label: "When an app asks", blurb: "An app starts each run itself." },
]);

export const CRON_PRESETS: readonly { cron: string; label: string }[] = Object.freeze([
  { cron: "0 8 * * *", label: "Every day at 08:00" },
  { cron: "0 8 * * 1-5", label: "Every weekday at 08:00" },
  { cron: "0 9 * * 1", label: "Every Monday at 09:00" },
  { cron: "0 9 1 * *", label: "The first of every month at 09:00" },
  { cron: "*/15 * * * *", label: "Every fifteen minutes" },
  { cron: "0 * * * *", label: "Every hour, on the hour" },
]);

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const two = (n: number) => String(n).padStart(2, "0");

/** A five-field cron expression in words, for the shapes people write; null when it is something else. */
export function describeCron(expr: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  const preset = CRON_PRESETS.find((p) => p.cron === parts.join(" "));
  if (preset) return preset.label;
  const step = /^\*\/(\d+)$/.exec(min);
  if (step && hour === "*" && dom === "*" && mon === "*" && dow === "*") return `Every ${step[1]} minutes`;
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return null;
  const at = `${two(Number(hour))}:${two(Number(min))}`;
  if (dom === "*" && mon === "*" && dow === "*") return `Every day at ${at}`;
  if (dom === "*" && mon === "*" && /^\d$/.test(dow)) return `Every ${DAYS[Number(dow) % 7]} at ${at}`;
  if (dom === "*" && mon === "*" && dow === "1-5") return `Every weekday at ${at}`;
  if (/^\d+$/.test(dom) && mon === "*" && dow === "*") return `Day ${dom} of every month at ${at}`;
  return null;
}

/** A cron field: *, a number, a range, a list or a step, within bounds. */
function cronFieldOk(f: string, lo: number, hi: number): boolean {
  return f.split(",").every((part) => {
    const [range, step] = part.split("/");
    if (step !== undefined && !/^\d+$/.test(step)) return false;
    if (range === "*") return true;
    const m = /^(\d+)(?:-(\d+))?$/.exec(range);
    if (!m) return false;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    return a >= lo && b <= hi && a <= b;
  });
}

export function cronProblem(expr: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (!expr.trim()) return "Say when: a schedule needs its times.";
  if (parts.length !== 5) return "A schedule is five fields: minute, hour, day of the month, month, day of the week.";
  const bounds: [number, number][] = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ];
  const names = ["minute", "hour", "day of the month", "month", "day of the week"];
  for (let i = 0; i < 5; i++) if (!cronFieldOk(parts[i], bounds[i][0], bounds[i][1])) return `The ${names[i]} field "${parts[i]}" is not one this schedule can read.`;
  return null;
}

/** What is wrong with a trigger as written, in words; empty when nothing the panel can see. */
export function triggerProblems(t: Trigger): string[] {
  const out: string[] = [];
  switch (t.kind) {
    case "event":
      if (!t.event_type?.trim()) out.push("An event trigger needs the event it starts on.");
      break;
    case "schedule": {
      const p = cronProblem(t.cron_expression ?? "");
      if (p) out.push(p);
      break;
    }
    case "date":
      if (!t.date_var?.trim()) out.push("A date trigger needs to say which date it watches.");
      if (t.date_offset_days !== undefined && Math.abs(t.date_offset_days) > 366) out.push("A date trigger fires within a year of the date, before or after.");
      if (t.date_recurs && t.once_per_subject) out.push("A date that comes round every year cannot also be once per subject.");
      if (filterWritten(t.filter)) out.push("A date trigger has no event to test a filter against.");
      break;
    case "manual":
    case "api":
      break;
    default:
      out.push(`"${t.kind}" is not a kind of trigger.`);
  }
  if ((t.kind === "schedule" || t.kind === "manual" || t.kind === "api") && filterWritten(t.filter)) {
    out.push("Only an event trigger has an event to filter.");
  }
  if (t.kind === "event" && filterWritten(t.filter)) {
    try {
      parse(t.filter, { mode: "trigger" });
    } catch (e) {
      out.push(`The filter cannot be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (t.subject_kind === "external") {
    if (t.kind !== "event" && t.kind !== "api" && t.kind !== "manual") out.push("Only an event, or a start by an app, names the thing a run is about.");
    if (t.subject_type?.trim() && !/^[^:\s]+:\S+$/.test(t.subject_type.trim()))
      out.push("Write the kind of thing as app:type, for instance orders:order.");
  }
  if (t.subject_kind === "person" && t.kind !== "event" && t.kind !== "date") out.push("Only an event or a date trigger names a person.");
  return out;
}

export function filterWritten(f: unknown): boolean {
  if (f === undefined || f === null) return false;
  if (typeof f === "object" && !Array.isArray(f) && Object.keys(f as object).length === 0) return false;
  if (Array.isArray(f) && f.length === 0) return false;
  return true;
}

/** The trigger in one sentence. */
export function describeTrigger(t: Trigger | null | undefined): string {
  if (!t) return "No trigger: started by hand.";
  switch (t.kind) {
    case "event": {
      const f = filterWritten(t.filter) ? ", when its filter matches" : "";
      return `Starts when ${t.event_type?.trim() || "an event"} happens${f}.`;
    }
    case "schedule": {
      const words = describeCron(t.cron_expression ?? "");
      return words ? `Starts on a schedule: ${words.charAt(0).toLowerCase()}${words.slice(1)}.` : `Starts on the schedule ${t.cron_expression || "(none yet)"}.`;
    }
    case "date": {
      const off = t.date_offset_days ?? 0;
      const when = off === 0 ? "on" : off < 0 ? `${-off} day${off === -1 ? "" : "s"} before` : `${off} day${off === 1 ? "" : "s"} after`;
      return `Starts ${when} each subject's ${t.date_var || "date"}${t.date_recurs ? ", every year" : ""}.`;
    }
    case "api":
      return "Starts when an app asks for a run.";
    default:
      return "Started by hand.";
  }
}

/** What a trigger becomes when its kind changes: fields the new kind does not read are dropped. */
export function withKind(t: Trigger, kind: TriggerKind): Trigger {
  const keep: Trigger = { kind };
  if (t.subject_kind) keep.subject_kind = t.subject_kind;
  if (t.subject_type) keep.subject_type = t.subject_type;
  if (kind === "event") {
    if (t.event_type) keep.event_type = t.event_type;
    if (filterWritten(t.filter)) keep.filter = t.filter;
    if (t.once_per_subject) keep.once_per_subject = true;
  }
  if (kind === "schedule") keep.cron_expression = t.cron_expression || CRON_PRESETS[0].cron;
  if (kind === "date") {
    keep.date_var = t.date_var ?? "";
    if (t.date_offset_days) keep.date_offset_days = t.date_offset_days;
    if (t.date_recurs) keep.date_recurs = true;
  }
  if ((kind === "schedule" || kind === "manual") && keep.subject_kind === "person") delete keep.subject_kind;
  return keep;
}

/** A definition-level interrupt: while a run is open, this event about its subject sends it to `goto`. */
export type Interrupt = { event: string; goto: string; when?: unknown };

export function interruptProblems(list: Interrupt[], targets: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  list.forEach((it, i) => {
    const n = `Interrupt ${i + 1}`;
    if (!it.event.trim()) out.push(`${n} needs the event that interrupts.`);
    if (!it.goto) out.push(`${n} needs the step a run goes to.`);
    else if (!targets.includes(it.goto)) out.push(`${n} goes to ${it.goto}, which is not a step of this workflow.`);
    if (seen.has(it.event)) out.push(`${n}: ${it.event} already interrupts; one event, one place to go.`);
    seen.add(it.event);
    if (filterWritten(it.when)) {
      try {
        parse(it.when, { mode: "branch" });
      } catch (e) {
        out.push(`${n}'s condition cannot be read: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  });
  return out;
}
