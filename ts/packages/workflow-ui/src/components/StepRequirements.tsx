"use client";

import { useId, useState } from "react";
import { requirementSentence } from "@zavon/step-gates";
import { ITEM_FIELD_TYPES, KEPT_ON_ITEM, keyFor, type RequirementField } from "../requirements.js";
import { Heading } from "./Heading.js";

export type StepRequirementsProps = {
  /** What the step is called, for the preview sentence. */
  stageName: string;
  /** The keys required now, in order. */
  required: string[];
  /** Fields this step keeps on the item (created with "New field"). */
  itemFields: RequirementField[];
  /** Every field a step may require, including itemFields. */
  catalogue: RequirementField[];
  onChange?: (next: { required: string[]; itemFields: RequirementField[] }) => void;
  readOnly?: boolean;
  /** Heading level; the section's heading is one level below the host's. */
  headingLevel?: number;
  /** A link to the docs, shown as a small info icon beside the heading. */
  docsUrl?: string;
};

const NEW = "__new__";

/**
 * "Required to move on": chips picked from the catalogue, a field created in
 * place, and the rule in one plain sentence. The server enforces it; this
 * only sets it.
 */
export function StepRequirements(props: StepRequirementsProps) {
  const { stageName, required, itemFields, catalogue, readOnly, onChange } = props;
  const uid = useId();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState("text");
  const [options, setOptions] = useState("");
  const [error, setError] = useState("");
  const byKey = new Map(catalogue.map((f) => [f.key, f]));
  const labels = required.map((k) => byKey.get(k)?.label ?? k);
  const unknown = required.filter((k) => !byKey.has(k));
  const free = catalogue.filter((f) => !required.includes(f.key));
  const sources = [...new Set(free.map((f) => f.source || "Fields"))];
  const level = props.headingLevel ?? 3;

  const set = (nextRequired: string[], nextFields = itemFields) => onChange?.({ required: nextRequired, itemFields: nextFields });
  const remove = (key: string) => {
    // A field this step created and nothing else requires goes with its chip.
    const own = itemFields.some((f) => f.key === key);
    set(
      required.filter((k) => k !== key),
      own ? itemFields.filter((f) => f.key !== key) : itemFields,
    );
  };
  const create = () => {
    const name = label.trim();
    if (!name) return setError("Give the field a name.");
    const opts = options.split(",").map((o) => o.trim()).filter(Boolean);
    if (type === "choice" && opts.length === 0) return setError("Give at least one choice.");
    const key = keyFor(name, catalogue.map((f) => f.key));
    const field: RequirementField = { key, label: name, type, source: KEPT_ON_ITEM, ...(type === "choice" ? { options: opts } : {}) };
    set([...required, key], [...itemFields, field]);
    setAdding(false);
    setLabel("");
    setOptions("");
    setType("text");
    setError("");
  };

  return (
    <section className="zwf-requirements" aria-labelledby={`${uid}-h`} data-testid="step-requirements">
      <div className="zwf-requirements-head">
        <Heading level={level} id={`${uid}-h`} className="zwf-subheading zwf-card-title">
          Required to move on
        </Heading>
        {props.docsUrl && (
          <a className="zwf-info" href={props.docsUrl} target="_blank" rel="noreferrer" aria-label="About step requirements (opens in a new tab)" title="About step requirements">
            i
          </a>
        )}
      </div>
      {required.length > 0 && (
        <ul className="zwf-chips" aria-label="Required fields">
          {required.map((k) => {
            const f = byKey.get(k);
            return (
              <li key={k} className={f ? "zwf-chip" : "zwf-chip zwf-chip-danger"}>
                <span>{f ? f.label : `Unknown field: ${k}`}</span>
                {!readOnly && (
                  <button type="button" className="zwf-chip-remove" aria-label={`Remove ${f ? f.label : k}`} onClick={() => remove(k)}>
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {unknown.length > 0 && (
        <p className="zwf-field-error" role="alert">
          Remove the unknown fields. The server refuses a step that requires a field it cannot check.
        </p>
      )}
      <p className="zwf-help zwf-requirements-preview" aria-live="polite">
        {requirementSentence(stageName, labels) || "Items can leave this step at any time."}
      </p>
      {!readOnly && !adding && (
        <label className="zwf-field">
          <span>Add a required field</span>
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === NEW) setAdding(true);
              else if (v) set([...required, v]);
            }}
          >
            <option value="">Choose a field…</option>
            {sources.map((s) => (
              <optgroup key={s} label={s}>
                {free
                  .filter((f) => (f.source || "Fields") === s)
                  .map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
              </optgroup>
            ))}
            <option value={NEW}>New field…</option>
          </select>
        </label>
      )}
      {!readOnly && adding && (
        <div className="zwf-requirements-new" role="group" aria-label="New field">
          <label className="zwf-field">
            <span>Field name</span>
            <input value={label} autoFocus onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
          </label>
          <label className="zwf-field">
            <span>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {ITEM_FIELD_TYPES.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {type === "choice" && (
            <label className="zwf-field">
              <span>Choices, separated by commas</span>
              <input value={options} onChange={(e) => setOptions(e.target.value)} />
            </label>
          )}
          {error && (
            <span className="zwf-field-error" role="alert">
              {error}
            </span>
          )}
          <div className="zwf-row zwf-actions">
            <button type="button" className="zwf-button" onClick={create}>
              Add field
            </button>
            <button
              type="button"
              className="zwf-button zwf-quiet"
              onClick={() => {
                setAdding(false);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
