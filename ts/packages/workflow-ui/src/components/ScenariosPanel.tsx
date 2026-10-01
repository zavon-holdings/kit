"use client";

import { useCallback, useEffect, useState } from "react";
import { checkScenario, describeExpect, type Scenario, type ScenarioResult } from "../scenarios.js";
import type { ApiError, WorkflowApi } from "../types.js";
import { useEditor } from "./context.js";

/**
 * The definition's saved scenarios, run against the graph as it is drawn
 * now: each passes or says the first thing that came out differently. The
 * host's save is expected to run the same check and refuse a failing one
 * unless the person says to save anyway.
 */
export function ScenariosPanel({ api }: { api?: WorkflowApi }) {
  const ed = useEditor();
  const [list, setList] = useState<Scenario[] | null>(null);
  const [results, setResults] = useState<Record<string, ScenarioResult>>({});
  const [ranFor, setRanFor] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!api?.listScenarios) return;
    setError("");
    try {
      setList(await api.listScenarios());
    } catch (e) {
      setError((e as ApiError)?.message ?? String(e));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load, ed.scenariosTick]);

  if (!api?.listScenarios) return <p className="zwf-muted">Saved scenarios are not available here.</p>;
  const blocked = ed.analysis.steps === null;
  const stale = ranFor !== ed.graph;

  const runAll = async () => {
    if (!list) return;
    setBusy(true);
    setError("");
    const graph = ed.graph;
    try {
      let out: ScenarioResult[];
      if (api.runScenarios) out = await api.runScenarios(graph);
      else if (api.simulate) {
        out = [];
        for (const s of list) {
          try {
            const r = await api.simulate({ ...s.sample, graph, decisions: s.decisions, outputs: s.outputs });
            out.push({ name: s.name, ...checkScenario(s.expect, r), result: r });
          } catch (e) {
            out.push({ name: s.name, pass: false, why: `the walk was refused: ${(e as Error)?.message ?? String(e)}` });
          }
        }
      } else {
        setError("Scenarios cannot be run here: there is no simulation.");
        return;
      }
      setResults(Object.fromEntries(out.map((r) => [r.name, r])));
      setRanFor(graph);
    } catch (e) {
      setError((e as ApiError)?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const failing = list ? list.filter((s) => results[s.name] && !results[s.name].pass).length : 0;
  const ran = list ? list.filter((s) => results[s.name]).length : 0;

  return (
    <div className="zwf-scenarios">
      <p className="zwf-muted">
        A scenario is a sample walk with what it must come to. Save one from the Simulate panel; each is checked when the workflow is saved.
      </p>
      {error && (
        <p className="zwf-status zwf-status-danger" role="alert">
          <span className="zwf-dot" aria-hidden="true" />
          {error}
        </p>
      )}
      {list === null && !error && <p className="zwf-muted">Loading the scenarios…</p>}
      {list && list.length === 0 && <p className="zwf-muted">No scenarios saved yet.</p>}
      {list && list.length > 0 && (
        <>
          <div className="zwf-row">
            <button type="button" className="zwf-button zwf-primary" disabled={busy || blocked} onClick={() => void runAll()}>
              {busy ? "Running…" : `Run all ${list.length} against this drawing`}
            </button>
            {blocked && <span className="zwf-muted">Fix the graph's problems first.</span>}
            {ran > 0 && !stale && (
              <span className={`zwf-status ${failing ? "zwf-status-danger" : "zwf-status-ok"}`} role="status">
                <span className="zwf-dot" aria-hidden="true" />
                {failing ? `${failing} of ${ran} failing` : `All ${ran} pass`}
              </span>
            )}
            {ran > 0 && stale && (
              <span className="zwf-status zwf-status-muted">
                <span className="zwf-dot" aria-hidden="true" />
                The drawing changed since the last run
              </span>
            )}
          </div>
          <table className="zwf-table">
            <caption className="zwf-visually-hidden">Saved scenarios</caption>
            <thead>
              <tr>
                <th scope="col">Scenario</th>
                <th scope="col">Expects</th>
                <th scope="col">Result</th>
                {api.deleteScenario && !ed.readOnly && <th scope="col">Remove</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const r = results[s.name];
                return (
                  <tr key={s.name} data-pass={r ? String(r.pass) : undefined}>
                    <th scope="row">
                      {s.name}
                      <br />
                      <span className="zwf-muted">
                        {s.sample.subject.type} {s.sample.subject.pid}
                        {Object.keys(s.decisions).length > 0 && ` · answers: ${Object.entries(s.decisions).map(([k, v]) => `${k}=${v}`).join(", ")}`}
                      </span>
                    </th>
                    <td>{describeExpect(s.expect)}</td>
                    <td>
                      {!r ? (
                        <span className="zwf-muted">not run</span>
                      ) : (
                        <span className={`zwf-status ${r.pass ? "zwf-status-ok" : "zwf-status-danger"}`}>
                          <span className="zwf-dot" aria-hidden="true" />
                          {r.pass ? "passes" : `fails: ${r.why}`}
                        </span>
                      )}
                      {r?.result && (
                        <button type="button" className="zwf-link" onClick={() => ed.setPath(r.result!.path ?? [])}>
                          {" "}
                          Show its path
                        </button>
                      )}
                    </td>
                    {api.deleteScenario && !ed.readOnly && (
                      <td>
                        <button
                          type="button"
                          className="zwf-button zwf-quiet"
                          onClick={async () => {
                            try {
                              await api.deleteScenario!(s.name);
                              setResults((x) => {
                                const y = { ...x };
                                delete y[s.name];
                                return y;
                              });
                              await load();
                            } catch (e) {
                              setError((e as ApiError)?.message ?? String(e));
                            }
                          }}
                        >
                          Remove {s.name}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
