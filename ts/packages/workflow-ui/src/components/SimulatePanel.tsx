"use client";

import { useState } from "react";
import type { ApiError, Problem, SimulateResult, WorkflowApi } from "../types.js";
import { nameOf, useEditor } from "./context.js";

function parseObject(text: string): Record<string, unknown> {
  const t = text.trim();
  if (!t) return {};
  const v = JSON.parse(t);
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("this is a JSON object: {\"name\": value}");
  return v as Record<string, unknown>;
}

/**
 * A dry walk of the graph with a sample: which way each question goes,
 * when each wait would end, who would be told, and where it stops for an
 * answer. The path is marked on the canvas and in the list. At a stop, pick
 * the answer and the walk goes on; every answer given stays in the strip
 * above the result, where it can be flipped and the walk run again.
 */
export function SimulatePanel({ api }: { api?: WorkflowApi }) {
  const ed = useEditor();
  const [subjectType, setSubjectType] = useState(ed.sample.subject.type);
  const [subjectId, setSubjectId] = useState(ed.sample.subject.pid);
  const [varsText, setVarsText] = useState(JSON.stringify(ed.sample.vars, null, 2));
  const [eventType, setEventType] = useState(ed.sample.event?.type ?? "");
  const [eventVars, setEventVars] = useState(JSON.stringify(ed.sample.event?.vars ?? {}, null, 2));
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [error, setError] = useState<{ message: string; problems?: Problem[] } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!api?.simulate) return <p className="zwf-muted">Simulation is not available here.</p>;
  const blocked = ed.analysis.steps === null;

  const run = async (answers: Record<string, string>) => {
    setError(null);
    let vars: Record<string, unknown>;
    let evars: Record<string, unknown>;
    try {
      vars = parseObject(varsText);
      evars = parseObject(eventVars);
    } catch (e) {
      setError({ message: `The sample is not JSON yet: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    const sample = {
      subject: { ...ed.sample.subject, type: subjectType.trim(), pid: subjectId.trim() },
      vars,
      event: eventType.trim() ? { type: eventType.trim(), vars: evars } : undefined,
      now: ed.sample.now,
    };
    ed.setSample(sample);
    setBusy(true);
    try {
      const out = await api.simulate!({ ...sample, graph: ed.graph, decisions: answers });
      setResult(out);
      ed.setPath(out.path ?? []);
      if (out.stopped?.choices?.length) setChoices((c) => ({ ...c, [out.stopped!.code]: out.stopped!.choices! }));
    } catch (e) {
      const err = e as ApiError;
      setResult(null);
      ed.setPath([]);
      setError({ message: err?.message ?? String(e), problems: err?.problems });
    } finally {
      setBusy(false);
    }
  };

  const answer = (code: string, choice: string) => {
    const next = { ...decisions, [code]: choice };
    setDecisions(next);
    void run(next);
  };

  return (
    <div className="zwf-simulate">
      <form
        className="zwf-sample"
        onSubmit={(e) => {
          e.preventDefault();
          void run(decisions);
        }}
      >
        <fieldset className="zwf-group">
          <legend>Sample</legend>
          <div className="zwf-row">
            <label className="zwf-field">
              <span>Subject type</span>
              <input value={subjectType} onChange={(e) => setSubjectType(e.target.value)} />
            </label>
            <label className="zwf-field">
              <span>Subject id</span>
              <input value={subjectId} onChange={(e) => setSubjectId(e.target.value)} />
            </label>
          </div>
          <label className="zwf-field">
            <span>Vars (JSON)</span>
            <textarea rows={4} spellCheck={false} value={varsText} onChange={(e) => setVarsText(e.target.value)} />
          </label>
          <details>
            <summary>The event that started it (optional)</summary>
            <label className="zwf-field">
              <span>Event type</span>
              <input value={eventType} onChange={(e) => setEventType(e.target.value)} />
            </label>
            <label className="zwf-field">
              <span>Event vars (JSON)</span>
              <textarea rows={3} spellCheck={false} value={eventVars} onChange={(e) => setEventVars(e.target.value)} />
            </label>
          </details>
        </fieldset>
        <div className="zwf-row">
          <button type="submit" className="zwf-button zwf-primary" disabled={busy || blocked}>
            {busy ? "Simulating…" : "Simulate"}
          </button>
          {Object.keys(decisions).length > 0 && (
            <button
              type="button"
              className="zwf-button zwf-quiet"
              onClick={() => {
                setDecisions({});
                void run({});
              }}
            >
              Clear the answers
            </button>
          )}
          {blocked && <span className="zwf-muted">Fix the graph's problems first.</span>}
        </div>
      </form>

      {Object.keys(decisions).length > 0 && (
        <fieldset className="zwf-group zwf-decisions">
          <legend>Answers given</legend>
          {Object.entries(decisions).map(([code, choice]) => (
            <label key={code} className="zwf-field">
              <span>{nameOf(ed.graph, code)}</span>
              <select value={choice} onChange={(e) => answer(code, e.target.value)}>
                {(choices[code] ?? [choice]).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
      )}

      {error && (
        <div className="zwf-status zwf-status-danger" role="alert">
          <span className="zwf-dot" aria-hidden="true" />
          <span>
            {error.message}
            {error.problems && error.problems.length > 0 && (
              <ul className="zwf-plain">
                {error.problems.map((p, i) => (
                  <li key={i}>{p.message}</li>
                ))}
              </ul>
            )}
          </span>
        </div>
      )}

      {result && (
        <div className="zwf-sim-result" aria-live="polite">
          <ol className="zwf-sim-steps">
            {result.steps.map((s, i) => (
              <li key={i} data-skipped={s.skipped ? "true" : undefined}>
                <button type="button" className="zwf-link" onClick={() => ed.select({ kind: "node", id: s.node })}>
                  {s.name || s.code}
                </button>{" "}
                <span className="zwf-muted">({s.kind})</span> — {s.says}
                {s.until && !s.says.includes("until") && <span className="zwf-muted"> · until {new Date(s.until).toLocaleString()}</span>}
                {s.would && s.would.length > 0 && (
                  <ul className="zwf-plain">
                    {s.would.map((w, k) => (
                      <li key={k}>{w}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
          {result.recipients.length > 0 && <p>Would tell: {result.recipients.join(", ")}</p>}
          {result.stopped && (
            <div className="zwf-status zwf-status-warn" role="status">
              <span className="zwf-dot" aria-hidden="true" />
              <span>
                Stopped at {nameOf(ed.graph, result.stopped.node)}: {result.stopped.message}
                {result.stopped.choices && result.stopped.choices.length > 0 && (
                  <span className="zwf-row zwf-choices">
                    {result.stopped.choices.map((c) => (
                      <button key={c} type="button" className="zwf-button" onClick={() => answer(result.stopped!.code, c)}>
                        Answer: {c}
                      </button>
                    ))}
                  </span>
                )}
              </span>
            </div>
          )}
          {result.ended && (
            <p className="zwf-status zwf-status-ok">
              <span className="zwf-dot" aria-hidden="true" />
              Ended: {result.ended.outcome}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
