"use client";

import { useId } from "react";
import {
  CRON_PRESETS,
  describeCron,
  describeTrigger,
  interruptProblems,
  TRIGGER_KINDS,
  triggerProblems,
  withKind,
  type CatalogueEvent,
  type Interrupt,
  type Trigger,
  type TriggerKind,
} from "../trigger.js";
import { ConditionBuilder } from "./ConditionBuilder.js";

export type TriggerPanelProps = {
  value: Trigger;
  /** Absent: shown, not edited. */
  onChange?: (t: Trigger) => void;
  /** Events the catalogue offers, with the vars each carries. */
  events?: CatalogueEvent[];
};

/**
 * What starts a run: by hand, on an event (with a filter written in the
 * condition language, where a bare name is one of the event's vars), on a
 * schedule, on a date the subject carries, or when an app asks. The
 * problems shown are the ones the server will give, said before saving.
 */
export function TriggerPanel({ value, onChange, events = [] }: TriggerPanelProps) {
  const id = useId();
  const ro = !onChange;
  const set = (patch: Partial<Trigger>) => onChange?.({ ...value, ...patch });
  const problems = triggerProblems(value);
  const event = events.find((e) => e.type === value.event_type);
  const fields = (event?.vars ?? []).map((v) => v);
  const cronWords = value.kind === "schedule" ? describeCron(value.cron_expression ?? "") : null;

  return (
    <fieldset className="zwf-group zwf-trigger" disabled={ro}>
      <legend>Trigger</legend>
      <p className="zwf-muted">{describeTrigger(value)}</p>
      <div role="radiogroup" aria-label="Starts" className="zwf-choices-col">
        {TRIGGER_KINDS.map((k) => (
          <label key={k.kind} className="zwf-check">
            <input
              type="radio"
              name={`${id}-kind`}
              checked={value.kind === k.kind}
              onChange={() => onChange?.(withKind(value, k.kind as TriggerKind))}
            />
            <span>
              {k.label} <span className="zwf-muted">— {k.blurb}</span>
            </span>
          </label>
        ))}
      </div>

      {value.kind === "event" && (
        <>
          <label className="zwf-field">
            <span>The event</span>
            <input list={`${id}-events`} value={value.event_type ?? ""} spellCheck={false} placeholder="app.thing.happened" onChange={(e) => set({ event_type: e.target.value })} />
            <datalist id={`${id}-events`}>
              {events.map((e) => (
                <option key={e.type} value={e.type}>
                  {e.label ?? e.type}
                </option>
              ))}
            </datalist>
          </label>
          {event?.label && <p className="zwf-muted">{event.label}</p>}
          <ConditionBuilder
            legend="Only when (a bare name is one of the event's values)"
            value={value.filter ?? {}}
            readOnly={ro}
            mode="trigger"
            fields={fields}
            onChange={(filter) => set({ filter })}
          />
          <label className="zwf-check">
            <input type="checkbox" checked={!!value.once_per_subject} onChange={(e) => set({ once_per_subject: e.target.checked || undefined })} />
            <span>One run per subject</span>
          </label>
        </>
      )}

      {value.kind === "schedule" && (
        <>
          <label className="zwf-field">
            <span>A usual time</span>
            <select
              value={CRON_PRESETS.some((p) => p.cron === value.cron_expression) ? value.cron_expression : ""}
              onChange={(e) => e.target.value && set({ cron_expression: e.target.value })}
            >
              <option value="">Written by hand below</option>
              {CRON_PRESETS.map((p) => (
                <option key={p.cron} value={p.cron}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="zwf-field">
            <span>Schedule (minute hour day-of-month month day-of-week)</span>
            <input value={value.cron_expression ?? ""} spellCheck={false} onChange={(e) => set({ cron_expression: e.target.value })} />
          </label>
          {cronWords && <p className="zwf-muted">{cronWords}</p>}
        </>
      )}

      {value.kind === "date" && (
        <>
          <label className="zwf-field">
            <span>Date field (a value on each subject)</span>
            <input value={value.date_var ?? ""} spellCheck={false} placeholder="renewal_date" onChange={(e) => set({ date_var: e.target.value })} />
          </label>
          <label className="zwf-field">
            <span>Days before (negative) or after (positive); 0 is on the day</span>
            <input
              type="number"
              min={-366}
              max={366}
              value={value.date_offset_days ?? 0}
              onChange={(e) => set({ date_offset_days: Number(e.target.value) || undefined })}
            />
          </label>
          <label className="zwf-check">
            <input type="checkbox" checked={!!value.date_recurs} onChange={(e) => set({ date_recurs: e.target.checked || undefined })} />
            <span>Every year, on the anniversary</span>
          </label>
        </>
      )}

      {value.kind !== "manual" && value.kind !== "schedule" && (
        <fieldset className="zwf-group">
          <legend>Subject</legend>
          <label className="zwf-field">
            <span>Subject</span>
            <select value={value.subject_kind ?? ""} onChange={(e) => set({ subject_kind: e.target.value || undefined })}>
              <option value="">the usual for this trigger</option>
              <option value="person">a person</option>
              <option value="org">the organisation</option>
              <option value="external">something an app owns</option>
            </select>
          </label>
          {value.subject_kind === "external" && (
            <label className="zwf-field">
              <span>Subject type (app:type)</span>
              <input value={value.subject_type ?? ""} spellCheck={false} placeholder="orders:order" onChange={(e) => set({ subject_type: e.target.value })} />
            </label>
          )}
        </fieldset>
      )}

      {problems.length > 0 && (
        <ul className="zwf-plain" aria-label="Trigger problems">
          {problems.map((p) => (
            <li key={p} className="zwf-status zwf-status-danger">
              <span className="zwf-dot" aria-hidden="true" />
              {p}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

export type InterruptsPanelProps = {
  value: Interrupt[];
  onChange?: (list: Interrupt[]) => void;
  /** The top-level steps a run can be sent to. */
  targets: { code: string; name: string }[];
  events?: CatalogueEvent[];
};

/**
 * Interrupts: while a run is open, an event about its subject sends it
 * straight to a step, whatever it was waiting for — "if the order is
 * cancelled at any point, stop chasing the invoice".
 */
export function InterruptsPanel({ value, onChange, targets, events = [] }: InterruptsPanelProps) {
  const id = useId();
  const ro = !onChange;
  const problems = interruptProblems(
    value,
    targets.map((t) => t.code),
  );
  const set = (i: number, patch: Partial<Interrupt>) => onChange?.(value.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  return (
    <fieldset className="zwf-group zwf-interrupts" disabled={ro}>
      <legend>Interrupts</legend>
      <p className="zwf-muted">While a run is open, any of these events about its subject sends it straight to the step named, cancelling what it was waiting for.</p>
      {value.length === 0 && <p className="zwf-muted">None.</p>}
      <ol className="zwf-plain">
        {value.map((it, i) => (
          <li key={i} className="zwf-interrupt">
            <label className="zwf-field">
              <span>Interrupt {i + 1}: when</span>
              <input list={`${id}-events`} value={it.event} spellCheck={false} placeholder="app.thing.cancelled" onChange={(e) => set(i, { event: e.target.value })} />
            </label>
            <label className="zwf-field">
              <span>Interrupt {i + 1}: go to</span>
              <select value={it.goto} onChange={(e) => set(i, { goto: e.target.value })}>
                <option value="">Choose a step</option>
                {targets.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <details className="zwf-advanced" open={it.when !== undefined}>
              <summary>Only when (optional)</summary>
              <ConditionBuilder
                legend={`Interrupt ${i + 1} only when`}
                value={it.when ?? {}}
                readOnly={ro}
                onChange={(when) => set(i, { when: when && typeof when === "object" && Object.keys(when as object).length ? when : undefined })}
              />
            </details>
            {!ro && (
              <button type="button" className="zwf-button zwf-quiet" onClick={() => onChange?.(value.filter((_, k) => k !== i))}>
                Remove interrupt {i + 1}
              </button>
            )}
          </li>
        ))}
      </ol>
      <datalist id={`${id}-events`}>
        {events.map((e) => (
          <option key={e.type} value={e.type}>
            {e.label ?? e.type}
          </option>
        ))}
      </datalist>
      {!ro && (
        <button type="button" className="zwf-button" onClick={() => onChange?.([...value, { event: "", goto: "" }])}>
          Add an interrupt
        </button>
      )}
      {problems.length > 0 && (
        <ul className="zwf-plain" aria-label="Interrupt problems">
          {problems.map((p) => (
            <li key={p} className="zwf-status zwf-status-danger">
              <span className="zwf-dot" aria-hidden="true" />
              {p}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
