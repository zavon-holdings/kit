"use client";

import { useEffect, useRef, useState } from "react";
import type { InspectorProps } from "../types.js";
import { ConditionBuilder } from "./ConditionBuilder.js";
import { useEditor } from "./context.js";
import { fieldSuggestions } from "../fields.js";

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
      <legend>The arms meet when</legend>
      <label className="zwf-field">
        <span>Wait for</span>
        <select value={join} onChange={(e) => onChange(e.target.value === "quorum" ? { join: "quorum", quorum: config.quorum || 2 } : { join: e.target.value })}>
          <option value="all">every arm</option>
          <option value="any">any one arm</option>
          <option value="quorum">a number of arms</option>
        </select>
      </label>
      {join === "quorum" && (
        <label className="zwf-field">
          <span>How many arms</span>
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

function SpanField({ label, value, onChange }: { label: string; value: Span | undefined; onChange: (v: Span) => void }) {
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
          {UNITS.map((u) => (
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
            <span>The list (a run value)</span>
            <input value={over.var ?? ""} spellCheck={false} onChange={(e) => set({ over: { var: e.target.value } })} />
          </label>
          <label className="zwf-field">
            <span>Each item is called</span>
            <input value={config.item_var ?? ""} placeholder="item" spellCheck={false} onChange={(e) => set({ item_var: e.target.value || undefined })} />
          </label>
        </>
      )}
      {mode === "while" && (
        <ConditionBuilder legend="Keep going while" value={over.while} readOnly={readOnly} fields={fieldSuggestions(ed.graph, ed.sample)} onChange={(w) => set({ over: { while: w } })} />
      )}
      <label className="zwf-field">
        <span>At most this many times (a while loop must say)</span>
        <input type="number" min={1} max={1000} value={config.max_iterations ?? ""} onChange={(e) => set({ max_iterations: Number(e.target.value) || undefined })} />
      </label>
      <label className="zwf-field">
        <span>On reaching it</span>
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
      <legend>Run another workflow</legend>
      <label className="zwf-field">
        <span>Workflow (its code)</span>
        <input value={config.definition ?? ""} spellCheck={false} onChange={(e) => set({ definition: e.target.value })} />
      </label>
      <p className="zwf-muted">It runs the workflow's current version when the step starts.</p>
      <label className="zwf-check">
        <input type="checkbox" checked={config.wait !== false} onChange={(e) => set({ wait: e.target.checked })} />
        <span>Wait for it to finish, and route on its outcome</span>
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
      <legend>{invoice ? "The invoice" : "The payment"}</legend>
      <label className="zwf-field">
        <span>App action</span>
        <input value={config.action ?? ""} placeholder={invoice ? "billing.invoice.issue" : "billing.payment.request"} spellCheck={false} onChange={(e) => set({ action: e.target.value })} />
      </label>
      <label className="zwf-field">
        <span>Amount, in cents (or a run value, vars.…)</span>
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
        <span>What it is for</span>
        <input value={config.description ?? ""} onChange={(e) => set({ description: e.target.value || undefined })} />
      </label>
      {invoice ? (
        <SpanField label="Due in" value={config.due} onChange={(due) => set({ due })} />
      ) : (
        <SpanField label="Expires after" value={config.expires} onChange={(expires) => set({ expires })} />
      )}
      {invoice && (
        <div className="zwf-group">
          <p className="zwf-muted">Reminders while it is unpaid</p>
          {(config.reminders ?? []).map((r, i) => (
            <div key={i} className="zwf-row">
              <SpanField label={`Reminder ${i + 1} after`} value={r.after} onChange={(after) => set({ reminders: (config.reminders ?? []).map((x, k) => (k === i ? { ...x, after } : x)) })} />
              <button type="button" className="zwf-button zwf-quiet" onClick={() => set({ reminders: (config.reminders ?? []).filter((_, k) => k !== i) })}>
                Remove reminder {i + 1}
              </button>
            </div>
          ))}
          <button type="button" className="zwf-button" onClick={() => set({ reminders: [...(config.reminders ?? []), { after: { value: 3, unit: "business_days" } }] })}>
            Add a reminder
          </button>
        </div>
      )}
      <p className="zwf-muted">Its ways out are its outcomes: {invoice ? "paid, voided, overdue (the default)" : "paid, failed, expired (the default)"}.</p>
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
      <legend>The to-do</legend>
      <label className="zwf-field">
        <span>What is to be done</span>
        <input value={config.title ?? ""} onChange={(e) => set({ title: e.target.value || undefined })} />
      </label>
      <label className="zwf-field">
        <span>People it is for (one email address a line)</span>
        <textarea rows={3} value={text} spellCheck={false} onChange={(e) => writePeople(e.target.value)} />
      </label>
      {others.length > 0 && (
        <p className="zwf-muted">
          And {others.length} other source{others.length === 1 ? "" : "s"} of people (a role, a permission or an app's list), kept as set.
        </p>
      )}
      <p className="zwf-muted">Done when one of them completes it. Nobody approves or rejects a to-do.</p>
      <SpanField label="Due in" value={config.due} onChange={(due) => set({ due })} />
      <div className="zwf-group">
        <p className="zwf-muted">Reminders while it is not done</p>
        {reminders.map((r, i) => (
          <div key={i} className="zwf-row">
            <SpanField label={`Reminder ${i + 1} after`} value={r.after} onChange={(after) => set({ reminders: reminders.map((x, k) => (k === i ? { ...x, after } : x)) })} />
            <button type="button" className="zwf-button zwf-quiet" onClick={() => set({ reminders: reminders.filter((_, k) => k !== i) })}>
              Remove reminder {i + 1}
            </button>
          </div>
        ))}
        <button type="button" className="zwf-button" onClick={() => set({ reminders: [...reminders, { after: { value: 1, unit: "business_days" } }] })}>
          Add a reminder
        </button>
      </div>
    </fieldset>
  );
}

/** The inspectors the package always has. A host's own win. */
export const BUILT_IN_INSPECTORS = {
  condition: ConditionInspector,
  join: JoinInspector,
  end: EndInspector,
  loop: LoopInspector,
  sub_workflow: SubWorkflowInspector,
  payment_request: MoneyInspector,
  invoice: MoneyInspector,
  todo: TodoInspector,
} as const;
