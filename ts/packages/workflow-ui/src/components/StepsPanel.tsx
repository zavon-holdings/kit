"use client";

import { nodeOf, sameSteps } from "@zavon/workflow-graph";
import type { Step } from "../types.js";
import { nameOf, useEditor } from "./context.js";

const generated = (code: string) => code.includes("--");

type Change = "new" | "changed" | "same";

function changes(now: Step[], saved: Step[]): { byCode: Map<string, Change>; removed: Step[] } {
  const before = new Map(saved.map((s) => [s.code, s]));
  const byCode = new Map<string, Change>();
  for (const s of now) {
    const b = before.get(s.code);
    if (!b) byCode.set(s.code, "new");
    else byCode.set(s.code, sameSteps([s], [b])[0] && (s.parent ?? "") === (b.parent ?? "") && (s.branch ?? "") === (b.branch ?? "") ? "same" : "changed");
  }
  const present = new Set(now.map((s) => s.code));
  return { byCode, removed: saved.filter((s) => !present.has(s.code)) };
}

/**
 * What the graph compiles to: the engine's steps, in order, each with the
 * node it came from. Steps the compiler made (a jump, a route after a
 * review) are marked as generated; they belong to an edge, so they are
 * never drawn as nodes. Against the saved steps, each row says whether it
 * is new or changed, and what was removed.
 */
export function StepsPanel({ savedSteps }: { savedSteps?: Step[] }) {
  const ed = useEditor();
  const steps = ed.analysis.steps;
  if (!steps) {
    return <p className="zwf-muted">The graph does not compile yet. Fix the problems listed, and its steps appear here.</p>;
  }
  const diff = savedSteps ? changes(steps, savedSteps) : null;
  const verdict = savedSteps ? sameSteps(steps, savedSteps) : null;
  return (
    <div className="zwf-steps">
      {verdict && (
        <p className={`zwf-status ${verdict[0] ? "zwf-status-ok" : "zwf-status-warn"}`}>
          <span className="zwf-dot" aria-hidden="true" />
          {verdict[0] ? "Compiles to the saved steps: saving changes only the drawing." : `Differs from the saved steps: ${verdict[1]}.`}
        </p>
      )}
      <table className="zwf-table">
        <caption className="zwf-visually-hidden">Compiled steps</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Step</th>
            <th scope="col">Kind</th>
            <th scope="col">From node</th>
            {diff && <th scope="col">Against saved</th>}
          </tr>
        </thead>
        <tbody>
          {steps.map((s, i) => {
            const node = nodeOf(s.code);
            return (
              <tr key={`${s.parent ?? ""}/${s.code}`} data-generated={generated(s.code) ? "true" : undefined}>
                <td>{i + 1}</td>
                <td>
                  {s.parent && <span className="zwf-muted">{s.parent} › {s.branch} › </span>}
                  <code>{s.code}</code>
                  {generated(s.code) && <span className="zwf-muted"> (generated)</span>}
                  <br />
                  <span className="zwf-muted">{s.name}</span>
                </td>
                <td>{s.kind}</td>
                <td>
                  <button type="button" className="zwf-link" onClick={() => ed.select({ kind: "node", id: node })}>
                    {nameOf(ed.graph, node)}
                  </button>
                </td>
                {diff && <td>{diff.byCode.get(s.code)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {diff && diff.removed.length > 0 && (
        <p className="zwf-status zwf-status-warn">
          <span className="zwf-dot" aria-hidden="true" />
          Removed: {diff.removed.map((s) => s.code).join(", ")}
        </p>
      )}
    </div>
  );
}
