"use client";

import { useEffect, useRef, useState } from "react";
import type { InspectorProps } from "../types.js";
import { ConditionBuilder } from "./ConditionBuilder.js";
import { ADVANCED_HINT, useAdvanced, useEditor } from "./context.js";
import { fieldSuggestions } from "../fields.js";
import { DecideInspector } from "./DecideInspector.js";
import { SmsInspector, WhatsAppInspector } from "./MessageInspectors.js";

/**
 * The settings of any node as JSON. The fallback for a node type the host
 * gave no inspector for, and the "Advanced" view under every inspector:
 * nothing a node can hold is out of reach.
 */
export function JsonInspector({ node, onChange, readOnly }: InspectorProps) {
  const text = JSON.stringify(node.config ?? {}, null, 2);
  const [draft, setDraft] = useState(text);
  const [error, setError] = useState("");
  // What this editor last wrote: the config coming back as that is our own
  // edit, and re-printing it would move the cursor while somebody types.
  const sent = useRef("");
  useEffect(() => {
    if (text === sent.current) return;
    setDraft(text);
    setError("");
  }, [text]);
  const advanced = useAdvanced();
  if (!advanced)
    return (
      <p className="zwf-muted zwf-advanced-hint" data-advanced-hint="settings">
        This step has no form here; its settings are kept as JSON. {ADVANCED_HINT}
      </p>
    );
  return (
    <label className="zwf-field">
      <span>Settings (JSON)</span>
      <textarea
        rows={Math.min(14, Math.max(4, draft.split("\n").length))}
        value={draft}
        readOnly={readOnly}
        spellCheck={false}
        onChange={(e) => {
          setDraft(e.target.value);
          try {
            const v = JSON.parse(e.target.value);
            if (v === null || typeof v !== "object" || Array.isArray(v)) {
              setError("settings are a JSON object");
              return;
            }
            setError("");
            sent.current = JSON.stringify(v, null, 2);
            onChange(v);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      />
      {error && <span className="zwf-ink-danger">Not saved yet: {error}</span>}
    </label>
  );
}

/** A condition asks its one question on the node. */
export function ConditionInspector({ node, onChange, readOnly }: InspectorProps) {
  const ed = useEditor();
  const config = (node.config ?? {}) as Record<string, unknown>;
  return (
    <ConditionBuilder
      legend="Ask"
      value={config.when}
      readOnly={readOnly}
      fields={fieldSuggestions(ed.graph, ed.sample)}
      sample={ed.sample}
      onChange={(when) => onChange({ ...config, when })}
    />
  );
}

/** How a fork's arms meet. */
export function JoinInspector({ node, onChange, readOnly }: InspectorProps) {
  const config = (node.config ?? {}) as { join?: string; quorum?: number };
  const join = config.join || "all";
  return (
    <fieldset className="zwf-group" disabled={readOnly}>
      <legend>The Arms Meet When</legend>
      <label className="zwf-field">
        <span>Wait For</span>
        <select value={join} onChange={(e) => onChange(e.target.value === "quorum" ? { join: "quorum", quorum: config.quorum || 2 } : { join: e.target.value })}>
          <option value="all">every arm</option>
          <option value="any">any one arm</option>
          <option value="quorum">a number of arms</option>
        </select>
      </label>
      {join === "quorum" && (
        <label className="zwf-field">
          <span>How Many Arms</span>
          <input type="number" min={1} value={config.quorum ?? ""} onChange={(e) => onChange({ join: "quorum", quorum: Number(e.target.value) || undefined })} />
        </label>
      )}
    </fieldset>
  );
}

/** The outcome a run ends with here. */
export function EndInspector({ node, onChange, readOnly }: InspectorProps) {
  const config = (node.config ?? {}) as { outcome?: string };
  return (
    <label className="zwf-field">
      <span>Outcome (one lower-case word)</span>
      <input value={config.outcome ?? ""} readOnly={readOnly} placeholder="completed" onChange={(e) => onChange(e.target.value ? { ...config, outcome: e.target.value } : {})} />
    </label>
  );
}

type Span = { value?: number; unit?: string };
const UNITS = ["minutes", "hours", "days", "weeks", "business_days", "business_hours"];

const FIXED_UNITS = ["minutes", "hours", "days", "weeks"];

function SpanField({ label, value, onChange, units = UNITS }: { label: string; value: Span | undefined; onChange: (v: Span) => void; units?: string[] }) {
  const v = value ?? {};
  return (
    <div className="zwf-row">
      <label className="zwf-field">
        <span>{label}</span>
        <input type="number" min={1} value={v.value ?? ""} onChange={(e) => onChange({ ...v, value: Number(e.target.value) || undefined })} />
      </label>
      <label className="zwf-field">
        <span>{label}: unit</span>
        <select value={v.unit ?? "days"} onChange={(e) => onChange({ ...v, unit: e.target.value })}>
          {units.map((u) => (
            <option key={u} value={u}>
              {u.replace("_", " ")}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** What a loop repeats over: a count, a list in a run value, or while a condition holds. */
export function LoopInspector({ node, onChange, readOnly }: InspectorProps) {
  const ed = useEditor();
  const config = (node.config ?? {}) as { over?: { count?: number; var?: string; while?: unknown }; item_var?: string; index_var?: string; max_iterations?: number; on_limit?: string };
  const over = config.over ?? {};
  const mode = over.var !== undefined ? "var" : over.while !== undefined ? "while" : "count";
  const set = (patch: Partial<typeof config>) => onChange({ ...config, ...patch });
  return (
    <fieldset className="zwf-group" disabled={readOnly}>
      <legend>Repeat</legend>
      <label className="zwf-field">
        <span>Repeat</span>
        <select
          value={mode}
          onChange={(e) =>
            set({ over: e.target.value === "var" ? { var: "vars.items" } : e.target.value === "while" ? { while: {} } : { count: 3 } })
          }
        >
          <option value="count">a number of times</option>
          <option value="var">for each item in a list</option>
          <option value="while">while a condition holds</option>
        </select>
      </label>
      {mode === "count" && (
        <label className="zwf-field">
          <span>Times</span>
          <input type="number" min={1} value={over.count ?? ""} onChange={(e) => set({ over: { count: Number(e.target.value) || undefined } })} />
        </label>
      )}
      {mode === "var" && (
        <>
          <label className="zwf-field">
            <span>The List (a run value)</span>
            <input value={over.var ?? ""} spellCheck={false} onChange={(e) => set({ over: { var: e.target.value } })} />
          </label>
          <label className="zwf-field">
            <span>Each Item Is Called</span>
            <input value={config.item_var ?? ""} placeholder="item" spellCheck={false} onChange={(e) => set({ item_var: e.target.value || undefined })} />
          </label>
        </>
      )}
      {mode === "while" && (
        <ConditionBuilder legend="Keep Going While" value={over.while} readOnly={readOnly} fields={fieldSuggestions(ed.graph, ed.sample)} onChange={(w) => set({ over: { while: w } })} />
      )}
      <label className="zwf-field">
        <span>At Most This Many Times (a while loop must say)</span>
        <input type="number" min={1} max={1000} value={config.max_iterations ?? ""} onChange={(e) => set({ max_iterations: Number(e.target.value) || undefined })} />
      </label>
      <label className="zwf-field">
        <span>On Reaching It</span>
        <select value={config.on_limit ?? "continue"} onChange={(e) => set({ on_limit: e.target.value })}>
          <option value="continue">go on to what follows</option>
          <option value="pause">pause the run</option>
        </select>
      </label>
    </fieldset>
  );
}

/** Another workflow, run as a step: which, about what, and whether to wait for its outcome. */
export function SubWorkflowInspector({ node, onChange, readOnly }: InspectorProps) {
  const config = (node.config ?? {}) as { definition?: string; subject?: unknown; wait?: boolean };
  const set = (patch: Partial<typeof config>) => onChange({ ...config, ...patch });
  return (
    <fieldset className="zwf-group" disabled={readOnly}>
      <legend>Run Another Workflow</legend>
      <label className="zwf-field">
        <span>Workflow (its code)</span>
        <input value={config.definition ?? ""} spellCheck={false} onChange={(e) => set({ definition: e.target.value })} />
      </label>
      <p className="zwf-muted">It runs the workflow's current version when the step starts.</p>
      <label className="zwf-check">
        <input type="checkbox" checked={config.wait !== false} onChange={(e) => set({ wait: e.target.checked })} />
        <span>Wait for It to Finish, and Route on Its Outcome</span>
      </label>
    </fieldset>
  );
}

/** A payment request or an invoice: the app's action, the amount, and how long it stands. */
export function MoneyInspector({ node, onChange, readOnly }: InspectorProps) {
  const invoice = node.type === "invoice";
  const config = (node.config ?? {}) as { action?: string; amount?: number | { var: string }; currency?: string; description?: string; expires?: Span; due?: Span; reminders?: { after: Span }[] };
  const set = (patch: Partial<typeof config>) => onChange({ ...config, ...patch });
  const amountIsVar = typeof config.amount === "object" && config.amount !== null;
  return (
    <fieldset className="zwf-group" disabled={readOnly}>
      <legend>{invoice ? "The Invoice" : "The Payment"}</legend>
      <label className="zwf-field">
        <span>App Action</span>
        <input value={config.action ?? ""} placeholder={invoice ? "billing.invoice.issue" : "billing.payment.request"} spellCheck={false} onChange={(e) => set({ action: e.target.value })} />
      </label>
      <label className="zwf-field">
        <span>Amount, in Cents (or a run value, vars.…)</span>
        <input
          value={amountIsVar ? (config.amount as { var: string }).var : (config.amount ?? "").toString()}
          onChange={(e) => set({ amount: /^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value ? { var: e.target.value } : undefined })}
        />
      </label>
      <label className="zwf-field">
        <span>Currency</span>
        <input value={config.currency ?? ""} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />
      </label>
      <label className="zwf-field">
        <span>Description</span>
        <input value={config.description ?? ""} onChange={(e) => set({ description: e.target.value || undefined })} />
      </label>
      {invoice ? (
        <SpanField label="Due In" value={config.due} onChange={(due) => set({ due })} />
      ) : (
        <SpanField label="Expires After" value={config.expires} onChange={(expires) => set({ expires })} />
      )}
      {invoice && (
        <div className="zwf-group">
          <p className="zwf-muted">Reminders While It Is Unpaid</p>
          {(config.reminders ?? []).map((r, i) => (
            <div key={i} className="zwf-row">
              <SpanField label={`Reminder ${i + 1} after`} value={r.after} onChange={(after) => set({ reminders: (config.reminders ?? []).map((x, k) => (k === i ? { ...x, after } : x)) })} />
              <button type="button" className="zwf-button zwf-quiet" onClick={() => set({ reminders: (config.reminders ?? []).filter((_, k) => k !== i) })}>
                Remove reminder {i + 1}
              </button>
            </div>
          ))}
          <button type="button" className="zwf-button" onClick={() => set({ reminders: [...(config.reminders ?? []), { after: { value: 3, unit: "business_days" } }] })}>
            Add a Reminder
          </button>
        </div>
      )}
      <p className="zwf-muted">Its ways out are its outcomes: {invoice ? "paid, voided, overdue (the default)" : "paid, failed, expired (the default)"}.</p>
    </fieldset>
  );
}

type SignerRow = { key: string; name: string; email: string };

/** What a signature request's config is missing, in the editor's words. */
export function signatureProblems(c: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (typeof c.template !== "string" || !c.template.trim()) out.push("Name the request in Signatures to send a copy of.");
  const signers = c.signers && typeof c.signers === "object" ? Object.entries(c.signers as Record<string, { email?: string }>) : [];
  if (signers.length === 0) out.push("Name who signs, by the template's signer keys.");
  if (typeof c.title === "string" && [...c.title].length > 200) out.push("A title is at most 200 characters.");
  for (const [k, s] of signers) {
    if (!/^[a-z][a-z0-9_-]{0,19}$/.test(k)) out.push(`"${k}" is not a signer key (lower-case, as the template names it).`);
    if (!s?.email?.trim()) out.push(`Signer ${k} has no email address.`);
  }
  return out;
}

/**
 * A signature request: a copy of a request in Signatures (the template: its
 * document, fields and signers' places) sent to the people the step names,
 * and a wait for them. Its ways out are signed, declined (a decline or a
 * cancel) and lapsed (the deadline passed), the default.
 */
export function SignatureInspector({ node, onChange, readOnly }: InspectorProps) {
  const config = (node.config ?? {}) as {
    template?: string;
    signers?: Record<string, { name?: string; email?: string }>;
    title?: string;
    message?: string;
    deadline?: Span;
    remind_signers?: boolean;
  };
  const set = (patch: Partial<typeof config>) => onChange({ ...config, ...patch });
  const [rows, setRows] = useState<SignerRow[]>(() =>
    Object.entries(config.signers ?? {}).map(([key, s]) => ({ key, name: s?.name ?? "", email: s?.email ?? "" })),
  );
  const writeRows = (next: SignerRow[]) => {
    setRows(next);
    const signers: Record<string, { name?: string; email: string }> = {};
    for (const r of next) {
      if (!r.key.trim()) continue;
      signers[r.key.trim()] = r.name.trim() ? { name: r.name, email: r.email } : { email: r.email };
    }
    set({ signers });
  };
  const problems = signatureProblems(config as Record<string, unknown>);
  return (
    <fieldset className="zwf-group" disabled={readOnly}>
      <legend>The Signature Request</legend>
      <label className="zwf-field">
        <span>Template (the request's uid in Signatures)</span>
        <input value={config.template ?? ""} spellCheck={false} onChange={(e) => set({ template: e.target.value.trim() })} />
      </label>
      <div className="zwf-group">
        <p className="zwf-muted">Signers, by the template's signer keys. A name or address may be a run value, {"{{vars.email}}"}.</p>
        {rows.map((r, i) => (
          <div key={i} className="zwf-row">
            <label className="zwf-field">
              <span>Signer {i + 1} Key</span>
              <input value={r.key} spellCheck={false} onChange={(e) => writeRows(rows.map((x, k) => (k === i ? { ...x, key: e.target.value } : x)))} />
            </label>
            <label className="zwf-field">
              <span>Signer {i + 1} Name</span>
              <input value={r.name} onChange={(e) => writeRows(rows.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
            </label>
            <label className="zwf-field">
              <span>Signer {i + 1} Email</span>
              <input value={r.email} spellCheck={false} onChange={(e) => writeRows(rows.map((x, k) => (k === i ? { ...x, email: e.target.value } : x)))} />
            </label>
            <button type="button" className="zwf-button zwf-quiet" onClick={() => writeRows(rows.filter((_, k) => k !== i))}>
              Remove Signer {i + 1}
            </button>
          </div>
        ))}
        <button type="button" className="zwf-button" onClick={() => writeRows([...rows, { key: "", name: "", email: "" }])}>
          Add a Signer
        </button>
      </div>
      <label className="zwf-field">
        <span>Title (the template's when empty)</span>
        <input value={config.title ?? ""} onChange={(e) => set({ title: e.target.value || undefined })} />
      </label>
      <label className="zwf-field">
        <span>Message (the template's when empty)</span>
        <textarea rows={3} value={config.message ?? ""} onChange={(e) => set({ message: e.target.value || undefined })} />
      </label>
      <SpanField label="Lapses After" value={config.deadline} units={FIXED_UNITS} onChange={(deadline) => set({ deadline })} />
      <label className="zwf-check">
        <input type="checkbox" checked={config.remind_signers === true} onChange={(e) => set({ remind_signers: e.target.checked || undefined })} />
        <span>Remind Signers on the Platform's Schedule</span>
      </label>
      {problems.length > 0 && (
        <ul className="zwf-problems" aria-label="Not Ready Yet">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <p className="zwf-muted">Its ways out are its outcomes: signed, declined (a decline or a cancel), lapsed (the default).</p>
    </fieldset>
  );
}

/** What an email awaiting a reply is missing, in the editor's words. */
export function emailReplyProblems(c: Record<string, unknown>): string[] {
  const out: string[] = [];
  const to = typeof c.to === "string" ? c.to.trim() : "";
  if (!to) out.push("Say whom the email is to.");
  else if (!to.includes("@") && !to.includes("{{")) out.push("The email is to an address, or a run value that holds one.");
  const subject = typeof c.subject === "string" ? c.subject.trim() : "";
  if (!subject) out.push("Give the email a subject.");
  else if ([...subject].length > 200) out.push("A subject is at most 200 characters.");
  if (typeof c.body !== "string" || !c.body.trim()) out.push("Write the email.");
  return out;
}

/**
 * An email whose Reply-To is the record's own address, and a wait for the
 * answer. Its ways out are replied, and no_reply (the default) when nothing
 * comes back in time.
 */
export function EmailReplyInspector({ node, onChange, readOnly }: InspectorProps) {
  const config = (node.config ?? {}) as { to?: string; to_name?: string; subject?: string; body?: string; wait?: Span };
  const set = (patch: Partial<typeof config>) => onChange({ ...config, ...patch });
  const problems = emailReplyProblems(config as Record<string, unknown>);
  return (
    <fieldset className="zwf-group" disabled={readOnly}>
      <legend>The Email</legend>
      <label className="zwf-field">
        <span>To (an address, or a run value: {"{{vars.email}}"})</span>
        <input value={config.to ?? ""} spellCheck={false} onChange={(e) => set({ to: e.target.value })} />
      </label>
      <label className="zwf-field">
        <span>Their Name</span>
        <input value={config.to_name ?? ""} onChange={(e) => set({ to_name: e.target.value || undefined })} />
      </label>
      <label className="zwf-field">
        <span>Subject</span>
        <input value={config.subject ?? ""} onChange={(e) => set({ subject: e.target.value })} />
      </label>
      <label className="zwf-field">
        <span>Message</span>
        <textarea rows={5} value={config.body ?? ""} onChange={(e) => set({ body: e.target.value })} />
      </label>
      <SpanField label="Waits for a Reply For" value={config.wait} units={FIXED_UNITS} onChange={(wait) => set({ wait })} />
      {problems.length > 0 && (
        <ul className="zwf-problems" aria-label="Not Ready Yet">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <p className="zwf-muted">Replies come back to the record. Its ways out are replied, and no_reply (the default) when nothing comes back in time.</p>
    </fieldset>
  );
}

type PeopleSource = { people?: { email: string; name?: string }[] } & Record<string, unknown>;

/**
 * A to-do: what is to be done, the people it is for, when it is due and when
 * they are reminded. It edits the people named by address; any other source
 * (a role, a permission, an app's resolver) is kept as it is and said, for
 * the host's own inspector to edit.
 */
export function TodoInspector({ node, onChange, readOnly }: InspectorProps) {
  const config = (node.config ?? {}) as { title?: string; assignees?: PeopleSource[]; due?: Span; reminders?: { after: Span }[] };
  const set = (patch: Partial<typeof config>) => onChange({ ...config, ...patch });
  const sources = config.assignees ?? [];
  const others = sources.filter((s) => !(Array.isArray(s.people) && Object.keys(s).length === 1));
  const named = sources.filter((s) => Array.isArray(s.people) && Object.keys(s).length === 1).flatMap((s) => s.people ?? []);
  const [text, setText] = useState(named.map((p) => p.email).join("\n"));
  const writePeople = (value: string) => {
    setText(value);
    const emails = value
      .split(/[\n,]/)
      .map((e) => e.trim())
      .filter(Boolean);
    const people = emails.map((email) => named.find((p) => p.email === email) ?? { email });
    set({ assignees: people.length ? [...others, { people }] : others });
  };
  const reminders = config.reminders ?? [];
  return (
    <fieldset className="zwf-group" disabled={readOnly}>
      <legend>The To-Do</legend>
      <label className="zwf-field">
        <span>Task</span>
        <input value={config.title ?? ""} onChange={(e) => set({ title: e.target.value || undefined })} />
      </label>
      <label className="zwf-field">
        <span>Assignees (one email address per line)</span>
        <textarea rows={3} value={text} spellCheck={false} onChange={(e) => writePeople(e.target.value)} />
      </label>
      {others.length > 0 && (
        <p className="zwf-muted">
          And {others.length} other source{others.length === 1 ? "" : "s"} of people (a role, a permission or an app's list), kept as set.
        </p>
      )}
      <p className="zwf-muted">Complete when any of them marks it done. A to-do has no approval.</p>
      <SpanField label="Due In" value={config.due} onChange={(due) => set({ due })} />
      <div className="zwf-group">
        <p className="zwf-muted">Reminders While It Is Not Done</p>
        {reminders.map((r, i) => (
          <div key={i} className="zwf-row">
            <SpanField label={`Reminder ${i + 1} after`} value={r.after} onChange={(after) => set({ reminders: reminders.map((x, k) => (k === i ? { ...x, after } : x)) })} />
            <button type="button" className="zwf-button zwf-quiet" onClick={() => set({ reminders: reminders.filter((_, k) => k !== i) })}>
              Remove reminder {i + 1}
            </button>
          </div>
        ))}
        <button type="button" className="zwf-button" onClick={() => set({ reminders: [...reminders, { after: { value: 1, unit: "business_days" } }] })}>
          Add a Reminder
        </button>
      </div>
    </fieldset>
  );
}

/** The inspectors the package always has. A host's own win. */
export const BUILT_IN_INSPECTORS = {
  decide: DecideInspector,
  whatsapp: WhatsAppInspector,
  sms: SmsInspector,
  condition: ConditionInspector,
  join: JoinInspector,
  end: EndInspector,
  loop: LoopInspector,
  sub_workflow: SubWorkflowInspector,
  payment_request: MoneyInspector,
  invoice: MoneyInspector,
  signature: SignatureInspector,
  email_reply: EmailReplyInspector,
  todo: TodoInspector,
} as const;
