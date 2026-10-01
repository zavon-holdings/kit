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

/** The structural inspectors the package always has. A host's own win. */
export const BUILT_IN_INSPECTORS = {
  condition: ConditionInspector,
  join: JoinInspector,
  end: EndInspector,
} as const;
