"use client";

import { useState } from "react";
import { expectFrom, scenarioNameProblem } from "../scenarios.js";
import type { ApiError, Graph, Problem, Sample, SimulateResult, WorkflowApi } from "../types.js";
import { nameOf, useAdvanced, useEditor } from "./context.js";
import { Heading } from "./Heading.js";

function parseObject(text: string): Record<string, unknown> {
  const t = text.trim();
  if (!t) return {};
  const v = JSON.parse(t);
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("this is a JSON object: {\"name\": value}");
  return v as Record<string, unknown>;
}

/** The run values a graph reads (`vars.amount` in a condition), in the order first met. */
export function varsRead(graph: Graph): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      const m = /^vars\.([A-Za-z_][\w]*)/.exec(v);
      if (m && !out.includes(m[1])) out.push(m[1]);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(graph.nodes.map((n) => n.config));
  walk(graph.edges.map((e) => e.when));
  return out;
}

/** What a person typed in a value's box, as the value: a number, true or false, a list or object written as JSON, or the words. */
export function typedValue(text: string): unknown {
  const t = text.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^[[{]/.test(t)) {
    try {
      return JSON.parse(t);
    } catch {
      return text;
    }
  }
  return text;
}

const shownValue = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

type Draft = {
  key: number;
  subjectType: string;
  subjectId: string;
  varsText: string;
  eventType: string;
  eventVars: string;
  decisions: Record<string, string>;
  choices: Record<string, string[]>;
  result: SimulateResult | null;
  error: { message: string; problems?: Problem[] } | null;
  busy: boolean;
};

const draftOf = (s: Sample, key: number): Draft => ({
  key,
  subjectType: s.subject.type,
  subjectId: s.subject.pid,
  varsText: JSON.stringify(s.vars, null, 2),
  eventType: s.event?.type ?? "",
  eventVars: JSON.stringify(s.event?.vars ?? {}, null, 2),
  decisions: {},
  choices: {},
  result: null,
  error: null,
  busy: false,
});

/** A draft as the sample it describes; throws when its JSON cannot be read. */
function sampleOf(d: Draft, base: Sample): Sample {
  const vars = parseObject(d.varsText);
  const evars = parseObject(d.eventVars);
  return {
    subject: { ...base.subject, type: d.subjectType.trim(), pid: d.subjectId.trim() },
    vars,
    event: d.eventType.trim() ? { type: d.eventType.trim(), vars: evars } : undefined,
    now: base.now,
  };
}

/**
 * A dry walk of the graph with a sample: which way each question goes,
 * when each wait would end, who would be told, and where it stops for an
 * answer. The path is marked on the canvas and in the list. At a stop, pick
 * the answer and the walk goes on; every answer given stays in the strip
 * above the result, where it can be flipped and the walk run again.
 *
 * Several samples run side by side — the gold member and the new one, the
 * large order and the small — each with its own answers; one at a time is
 * shown on the canvas. A walk worth keeping is saved as a scenario.
 */
export function SimulatePanel({ api }: { api?: WorkflowApi }) {
  const ed = useEditor();
  const [drafts, setDrafts] = useState<Draft[]>(() => [draftOf(ed.sample, 1)]);
  const [shown, setShown] = useState(1);
  const [nextKey, setNextKey] = useState(2);

  if (!api?.simulate) return <p className="zwf-muted">Simulation is not available here.</p>;
  const blocked = ed.analysis.steps === null;
  const many = drafts.length > 1;

  const patch = (key: number, p: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)));

  const run = async (d: Draft, answers: Record<string, string>) => {
    let sample: Sample;
    try {
      sample = sampleOf(d, ed.sample);
    } catch (e) {
      patch(d.key, { error: { message: `The sample is not JSON yet: ${e instanceof Error ? e.message : String(e)}` } });
      return;
    }
    if (d.key === drafts[0].key) ed.setSample(sample);
    patch(d.key, { busy: true, error: null, decisions: answers });
    try {
      const out = await api.simulate!({ ...sample, graph: ed.graph, decisions: answers });
      setDrafts((ds) =>
        ds.map((x) =>
          x.key === d.key
            ? { ...x, busy: false, result: out, choices: out.stopped?.choices?.length ? { ...x.choices, [out.stopped.code]: out.stopped.choices } : x.choices }
            : x,
        ),
      );
      setShown(d.key);
      ed.setPath(out.path ?? []);
    } catch (e) {
      const err = e as ApiError;
      patch(d.key, { busy: false, result: null, error: { message: err?.message ?? String(e), problems: err?.problems } });
      if (shown === d.key) ed.setPath([]);
    }
  };

  const runAll = async () => {
    for (const d of drafts) await run(d, d.decisions);
  };

  return (
    <div className="zwf-simulate">
      {(many || !blocked) && (
        <div className="zwf-row">
          {many && (
            <button type="button" className="zwf-button zwf-primary" disabled={blocked || drafts.some((d) => d.busy)} onClick={() => void runAll()}>
              Simulate All {drafts.length} Samples
            </button>
          )}
          <button
            type="button"
            className="zwf-button"
            onClick={() => {
              setDrafts((ds) => [...ds, { ...draftOf(ed.sample, nextKey), varsText: ds[ds.length - 1].varsText, subjectType: ds[ds.length - 1].subjectType }]);
              setNextKey((k) => k + 1);
            }}
          >
            Add Another Sample
          </button>
          {blocked && <span className="zwf-muted">Fix the graph's problems first.</span>}
        </div>
      )}
      <div className={many ? "zwf-sim-columns" : undefined}>
        {drafts.map((d, i) => (
          <SampleColumn
            key={d.key}
            draft={d}
            index={i}
            many={many}
            shown={shown === d.key}
            blocked={blocked}
            api={api}
            onPatch={(p) => patch(d.key, p)}
            onRun={(answers) => void run(d, answers)}
            onShow={() => {
              setShown(d.key);
              ed.setPath(d.result?.path ?? []);
            }}
            onRemove={
              many
                ? () => {
                    setDrafts((ds) => ds.filter((x) => x.key !== d.key));
                    if (shown === d.key) ed.setPath([]);
                  }
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

function SampleColumn({
  draft: d,
  index,
  many,
  shown,
  blocked,
  api,
  onPatch,
  onRun,
  onShow,
  onRemove,
}: {
  draft: Draft;
  index: number;
  many: boolean;
  shown: boolean;
  blocked: boolean;
  api: WorkflowApi;
  onPatch: (p: Partial<Draft>) => void;
  onRun: (answers: Record<string, string>) => void;
  onShow: () => void;
  onRemove?: () => void;
}) {
  const ed = useEditor();
  const advanced = useAdvanced();
  const result = d.result;
  const answer = (code: string, choice: string) => onRun({ ...d.decisions, [code]: choice });
  const title = `Sample ${index + 1}`;

  return (
    <section className="zwf-sim-column" aria-label={many ? title : undefined} data-shown={many && shown ? "true" : undefined}>
      {many && (
        <div className="zwf-row">
          <Heading level={ed.headingLevel + 1} className="zwf-subheading">
            {title}
          </Heading>
          {shown ? (
            <span className="zwf-status zwf-status-path">
              <span className="zwf-dot" aria-hidden="true" />
              on the canvas
            </span>
          ) : (
            result && (
              <button type="button" className="zwf-button zwf-quiet" onClick={onShow}>
                Show Its Path
              </button>
            )
          )}
          {onRemove && (
            <button type="button" className="zwf-button zwf-quiet" onClick={onRemove}>
              Remove {title}
            </button>
          )}
        </div>
      )}
      <form
        className="zwf-sample"
        onSubmit={(e) => {
          e.preventDefault();
          onRun(d.decisions);
        }}
      >
        {!advanced ? (
          <ValuesForm draft={d} onPatch={onPatch} />
        ) : (
        <fieldset className="zwf-group">
          <legend>Sample</legend>
          <div className="zwf-row">
            <label className="zwf-field">
              <span>Subject Type</span>
              <input value={d.subjectType} onChange={(e) => onPatch({ subjectType: e.target.value })} />
            </label>
            <label className="zwf-field">
              <span>Subject Id</span>
              <input value={d.subjectId} onChange={(e) => onPatch({ subjectId: e.target.value })} />
            </label>
          </div>
          <label className="zwf-field">
            <span>Vars (JSON)</span>
            <textarea rows={4} spellCheck={false} value={d.varsText} onChange={(e) => onPatch({ varsText: e.target.value })} />
          </label>
          <details>
            <summary>The Event That Started It (optional)</summary>
            <label className="zwf-field">
              <span>Event Type</span>
              <input value={d.eventType} onChange={(e) => onPatch({ eventType: e.target.value })} />
            </label>
            <label className="zwf-field">
              <span>Event Vars (JSON)</span>
              <textarea rows={3} spellCheck={false} value={d.eventVars} onChange={(e) => onPatch({ eventVars: e.target.value })} />
            </label>
          </details>
        </fieldset>
        )}
        <div className="zwf-row">
          <button type="submit" className="zwf-button zwf-primary" disabled={d.busy || blocked} aria-label={many ? `Simulate ${title}` : undefined}>
            {d.busy ? "Simulating…" : "Simulate"}
          </button>
          {Object.keys(d.decisions).length > 0 && (
            <button type="button" className="zwf-button zwf-quiet" onClick={() => onRun({})}>
              Clear the Answers
            </button>
          )}
          {!many && blocked && <span className="zwf-muted">Fix the graph's problems first.</span>}
        </div>
      </form>

      {Object.keys(d.decisions).length > 0 && (
        <fieldset className="zwf-group zwf-decisions">
          <legend>Answers Given</legend>
          {Object.entries(d.decisions).map(([code, choice]) => (
            <label key={code} className="zwf-field">
              <span>{nameOf(ed.graph, code)}</span>
              <select value={choice} onChange={(e) => answer(code, e.target.value)}>
                {(d.choices[code] ?? [choice]).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
      )}

      {d.error && (
        <div className="zwf-status zwf-status-danger" role="alert">
          <span className="zwf-dot" aria-hidden="true" />
          <span>
            {d.error.message}
            {d.error.problems && d.error.problems.length > 0 && (
              <ul className="zwf-plain">
                {d.error.problems.map((p, i) => (
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
                <button type="button" className="zwf-link" onClick={() => ed.reveal(s.node)}>
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
          {api.saveScenario && <SaveScenario draft={d} result={result} />}
        </div>
      )}
    </section>
  );
}

/**
 * The sample's run values as a form, one box per value the graph reads or
 * the sample holds: what Advanced's JSON holds, without the JSON.
 */
function ValuesForm({ draft: d, onPatch }: { draft: Draft; onPatch: (p: Partial<Draft>) => void }) {
  const ed = useEditor();
  let vars: Record<string, unknown> | null = null;
  try {
    vars = parseObject(d.varsText);
  } catch {
    vars = null;
  }
  if (!vars)
    return (
      <p className="zwf-status zwf-status-danger" role="alert">
        <span className="zwf-dot" aria-hidden="true" />
        The sample's values are not JSON yet. Turn on Advanced in the View menu to correct them.
      </p>
    );
  const held = vars;
  const names = [...varsRead(ed.graph), ...Object.keys(held)].filter((n, i, all) => all.indexOf(n) === i);
  const set = (name: string, text: string) => {
    const next = { ...held };
    if (text.trim() === "") delete next[name];
    else next[name] = typedValue(text);
    onPatch({ varsText: JSON.stringify(next, null, 2) });
  };
  return (
    <fieldset className="zwf-group">
      <legend>Values</legend>
      {names.length === 0 ? (
        <p className="zwf-muted">Nothing in this workflow reads a value, so there is nothing to set.</p>
      ) : (
        <div className="zwf-row">
          {names.map((n) => (
            <label key={n} className="zwf-field">
              <span>{n}</span>
              <input value={shownValue(held[n])} spellCheck={false} onChange={(e) => set(n, e.target.value)} />
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/** Keeps a walk as a named scenario: the sample, the answers, and what it came to. */
function SaveScenario({ draft, result }: { draft: Draft; result: SimulateResult }) {
  const ed = useEditor();
  const [name, setName] = useState("");
  const [state, setState] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const problem = scenarioNameProblem(name, []);
    if (problem) return setState({ tone: "danger", text: problem });
    setBusy(true);
    try {
      const sample = sampleOf(draft, ed.sample);
      await ed.api!.saveScenario!({ name: name.trim(), sample, decisions: draft.decisions, expect: expectFrom(result) });
      setState({ tone: "ok", text: `Saved as "${name.trim()}". Every save of this workflow now checks it.` });
      setName("");
      ed.bumpScenarios();
    } catch (e) {
      setState({ tone: "danger", text: (e as Error)?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="zwf-row zwf-save-scenario">
      <label className="zwf-field">
        <span>Scenario Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gold member, approved" />
      </label>
      <button type="button" className="zwf-button" disabled={busy} onClick={() => void save()}>
        Save the Scenario
      </button>
      {state && (
        <span className={`zwf-status zwf-status-${state.tone}`} role={state.tone === "danger" ? "alert" : "status"}>
          <span className="zwf-dot" aria-hidden="true" />
          {state.text}
        </span>
      )}
    </div>
  );
}
