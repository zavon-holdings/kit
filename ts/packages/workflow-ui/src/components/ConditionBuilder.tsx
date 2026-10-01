"use client";

import { useId, useMemo, useState } from "react";
import { describe, evaluate, OPERATORS, parse } from "@zavon/conditions";
import { fromRows, LIST_VALUE, NO_VALUE, toRows, type Row, type Rows } from "../conditionRows.js";
import type { Sample } from "../types.js";

export type ConditionBuilderProps = {
  /** The condition, in the condition language's JSON. */
  value: unknown;
  onChange: (value: unknown) => void;
  /** What the fieldset is called: "Ask", "Take this way when". */
  legend: string;
  readOnly?: boolean;
  /** Fields offered as you type: vars.amount, steps.review.output.outcome… */
  fields?: string[];
  /** When given, the builder says whether the sample would match. */
  sample?: Sample;
};

const WORDS: Record<string, string> = {
  is: "is",
  is_not: "is not",
  in: "is one of",
  not_in: "is none of",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  contains: "contains",
  starts_with: "starts with",
  ends_with: "ends with",
  matches: "matches the pattern",
  exists: "is present",
  missing: "is missing",
  before: "is before",
  after: "is after",
  holds: "holds the permit",
};

/** What the condition says, or why it cannot be read. */
export function readCondition(value: unknown): { text: string; error?: string } {
  try {
    const node = parse(value ?? {}, { mode: "branch", allowHolds: true });
    return { text: describe(node) || "nothing yet: it would always hold" };
  } catch (e) {
    return { text: "", error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * A condition editor over @zavon/conditions: rules of field, operator and
 * value, matched all or any. A condition that needs more (not, nesting) is
 * edited as JSON, so opening it never rewrites it.
 */
export function ConditionBuilder({ value, onChange, legend, readOnly = false, fields = [], sample }: ConditionBuilderProps) {
  const id = useId();
  const rows = useMemo(() => toRows(value), [value]);
  const [json, setJson] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [jsonError, setJsonError] = useState("");
  const read = readCondition(value);

  const verdict = useMemo(() => {
    if (!sample || read.error) return null;
    try {
      const node = parse(value ?? {}, { mode: "branch", allowHolds: false });
      if ((node as { empty?: boolean }).empty) return null;
      return evaluate(node, { vars: sample.vars, subject: sample.subject as unknown as Record<string, unknown>, event: sample.event as Record<string, unknown> | undefined, now: sample.now || new Date() });
    } catch {
      return null;
    }
  }, [sample, value, read.error]);

  const write = (next: Rows) => onChange(fromRows(next));
  const setRow = (i: number, patch: Partial<Row>) => rows && write({ ...rows, rows: rows.rows.map((r, k) => (k === i ? { ...r, ...patch } : r)) });

  return (
    <fieldset className="zwf-condition" disabled={readOnly}>
      <legend>{legend}</legend>
      {rows ? (
        <>
          {rows.rows.length > 1 && (
            <label className="zwf-field">
              <span>Match</span>
              <select value={rows.join} onChange={(e) => write({ ...rows, join: e.target.value as "all" | "any" })}>
                <option value="all">all of these</option>
                <option value="any">any of these</option>
              </select>
            </label>
          )}
          <datalist id={`${id}-fields`}>
            {fields.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <ol className="zwf-rules">
            {rows.rows.map((row, i) => (
              <li key={i} className="zwf-rule">
                <label className="zwf-field">
                  <span>Field</span>
                  <input list={`${id}-fields`} value={row.field} placeholder="vars.amount" onChange={(e) => setRow(i, { field: e.target.value })} />
                </label>
                <label className="zwf-field">
                  <span>Test</span>
                  <select value={row.op} onChange={(e) => setRow(i, { op: e.target.value })}>
                    {OPERATORS.map((op) => (
                      <option key={op} value={op}>
                        {WORDS[op] ?? op}
                      </option>
                    ))}
                  </select>
                </label>
                {!NO_VALUE.has(row.op) && (
                  <label className="zwf-field">
                    <span>{LIST_VALUE.has(row.op) ? "Values, comma separated" : "Value"}</span>
                    <input value={row.value} onChange={(e) => setRow(i, { value: e.target.value })} />
                  </label>
                )}
                {!readOnly && (
                  <button type="button" className="zwf-button zwf-quiet" onClick={() => write({ ...rows, rows: rows.rows.filter((_, k) => k !== i) })}>
                    Remove rule {i + 1}
                  </button>
                )}
              </li>
            ))}
          </ol>
          {!readOnly && (
            <button type="button" className="zwf-button" onClick={() => write({ ...rows, rows: [...rows.rows, { field: "", op: "is", value: "" }] })}>
              Add a rule
            </button>
          )}
        </>
      ) : (
        <label className="zwf-field">
          <span>Condition (JSON: this one uses more than rules can show)</span>
          <textarea
            rows={6}
            value={json}
            onChange={(e) => {
              setJson(e.target.value);
              try {
                onChange(JSON.parse(e.target.value));
                setJsonError("");
              } catch (err) {
                setJsonError(err instanceof Error ? err.message : String(err));
              }
            }}
          />
          {jsonError && <span className="zwf-ink-danger">Not JSON yet: {jsonError}</span>}
        </label>
      )}
      <p className="zwf-says" aria-live="polite">
        {read.error ? (
          <span className="zwf-status zwf-status-danger">
            <span className="zwf-dot" aria-hidden="true" />
            Cannot be read: {read.error}
          </span>
        ) : (
          <>Reads: {read.text}</>
        )}
      </p>
      {verdict !== null && (
        <p className={`zwf-status ${verdict ? "zwf-status-ok" : "zwf-status-muted"}`}>
          <span className="zwf-dot" aria-hidden="true" />
          {verdict ? "The sample matches" : "The sample does not match"}
        </p>
      )}
    </fieldset>
  );
}
