"use client";

import { useMemo, useState } from "react";
import { analyse } from "../analysis.js";
import { diffGraphs, diffSteps, nodeMarks, type Change } from "../diff.js";
import type { Graph, Sample, Selection, Step } from "../types.js";
import { EditorContext, nameOf, useReducedMotion, type Editor } from "./context.js";
import { ListView } from "./ListView.js";
import { WorkflowCanvas } from "./WorkflowCanvas.js";

const NO_SAMPLE: Sample = { subject: { type: "person", pid: "" }, vars: {} };

export type GraphViewProps = {
  graph: Graph;
  /** Words per node: "added", "removed", "changed". */
  marks?: Record<string, string>;
  /** A simulated path to mark. */
  path?: string[];
  trigger?: string;
  label?: string;
  view?: "canvas" | "list";
};

/**
 * A graph drawn and nothing else: no palette, no inspector, no edits. For a
 * version comparison, a run's "what is this running", or a page that only
 * shows a workflow to somebody who may read it.
 */
export function GraphView({ graph, marks, path = [], trigger = "", label = "Workflow", view = "canvas" }: GraphViewProps) {
  const analysis = useMemo(() => analyse(graph, { trigger }), [graph, trigger]);
  const reducedMotion = useReducedMotion();
  const [selection, setSelection] = useState<Selection>(null);
  const [focus, setFocus] = useState<{ id: string | null; tick: number }>({ id: null, tick: 0 });
  const ids = selection?.kind === "node" ? [selection.id] : selection?.kind === "nodes" ? selection.ids : [];
  const editor: Editor = {
    graph,
    analysis,
    readOnly: true,
    update: () => {},
    selection,
    select: setSelection,
    selectedIds: ids,
    reveal: (id) => {
      setSelection({ kind: "node", id });
      setFocus((f) => ({ id, tick: f.tick + 1 }));
    },
    copy: () => {},
    paste: () => {},
    canPaste: false,
    focusId: focus.id,
    focusTick: focus.tick,
    setFocus: (id, move = false) => setFocus((f) => ({ id, tick: move ? f.tick + 1 : f.tick })),
    path,
    setPath: () => {},
    inspectors: {},
    unavailable: {},
    sample: NO_SAMPLE,
    setSample: () => {},
    reducedMotion,
    marks,
    scenariosTick: 0,
    bumpScenarios: () => {},
    snapToGrid: false,
    minimap: false,
  };
  return (
    <EditorContext.Provider value={editor}>
      <section className="zwf zwf-graph-view" aria-label={label} data-readonly="true">
        <div className="zwf-view">{view === "canvas" ? <WorkflowCanvas /> : <ListView />}</div>
      </section>
    </EditorContext.Provider>
  );
}

export type VersionSide = { label: string; graph: Graph; steps?: Step[] };

const WORD: Record<Change | "moved", string> = { added: "added", removed: "removed", changed: "changed", same: "same", moved: "moved" };
const TONE: Record<Change | "moved", string> = { added: "ok", removed: "danger", changed: "warn", same: "muted", moved: "warn" };

/**
 * Two versions side by side: each drawing with what changed marked on it,
 * a list of the changes to the drawing, and the compiled steps aligned by
 * code — added, removed, changed (with why) or moved. A List view of both is
 * one switch away, for anybody who reads a list better than a picture.
 */
export function VersionDiff({ before, after, trigger = "" }: { before: VersionSide; after: VersionSide; trigger?: string }) {
  const [view, setView] = useState<"canvas" | "list">("canvas");
  const [onlyChanges, setOnlyChanges] = useState(true);
  const diff = useMemo(() => diffGraphs(before.graph, after.graph), [before.graph, after.graph]);
  const beforeSteps = useMemo(() => before.steps ?? analyse(before.graph, { trigger }).steps ?? [], [before, trigger]);
  const afterSteps = useMemo(() => after.steps ?? analyse(after.graph, { trigger }).steps ?? [], [after, trigger]);
  const rows = useMemo(() => diffSteps(beforeSteps, afterSteps), [beforeSteps, afterSteps]);
  const shownRows = onlyChanges ? rows.filter((r) => r.change !== "same") : rows;
  const changedNodes = diff.nodes.filter((n) => n.change !== "same");
  const changedEdges = diff.edges.filter((e) => e.change !== "same");
  const nothing = changedNodes.length === 0 && changedEdges.length === 0 && rows.every((r) => r.change === "same");

  return (
    <section className="zwf-diff" aria-label={`${before.label} compared with ${after.label}`}>
      <div className="zwf-row">
        <p className="zwf-status zwf-status-muted" role="status">
          <span className="zwf-dot" aria-hidden="true" />
          {nothing
            ? "No difference: the two versions draw and run the same."
            : `${diff.counts.added} added, ${diff.counts.removed} removed, ${diff.counts.changed} changed in the drawing; ${rows.filter((r) => r.change !== "same").length} step${rows.filter((r) => r.change !== "same").length === 1 ? "" : "s"} differ.`}
        </p>
        <label className="zwf-check">
          <input type="checkbox" checked={view === "list"} onChange={(e) => setView(e.target.checked ? "list" : "canvas")} />
          <span>Show as lists</span>
        </label>
      </div>
      <div className="zwf-diff-sides">
        <div className="zwf-diff-side">
          <h3 className="zwf-subheading">{before.label}</h3>
          <GraphView graph={before.graph} marks={nodeMarks(diff, "before")} trigger={trigger} label={`${before.label}, drawn`} view={view} />
        </div>
        <div className="zwf-diff-side">
          <h3 className="zwf-subheading">{after.label}</h3>
          <GraphView graph={after.graph} marks={nodeMarks(diff, "after")} trigger={trigger} label={`${after.label}, drawn`} view={view} />
        </div>
      </div>

      {(changedNodes.length > 0 || changedEdges.length > 0) && (
        <section aria-label="Changes to the drawing">
          <h3 className="zwf-subheading">Changes to the drawing</h3>
          <ul className="zwf-plain zwf-diff-list">
            {changedNodes.map((n) => (
              <li key={`n-${n.id}`} className={`zwf-status zwf-status-${TONE[n.change]}`}>
                <span className="zwf-dot" aria-hidden="true" />
                {WORD[n.change]}: {nameOf(n.change === "removed" ? before.graph : after.graph, n.id)}
                {n.fields.length > 0 && <span className="zwf-muted"> ({n.fields.join(", ")})</span>}
              </li>
            ))}
            {changedEdges.map((e) => (
              <li key={`e-${e.key}-${e.change}`} className={`zwf-status zwf-status-${TONE[e.change]}`}>
                <span className="zwf-dot" aria-hidden="true" />
                {WORD[e.change]}: the way {e.key}
                {e.fields.length > 0 && <span className="zwf-muted"> ({e.fields.join(", ")})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Steps compared">
        <div className="zwf-row">
          <h3 className="zwf-subheading">Steps</h3>
          <label className="zwf-check">
            <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
            <span>Only the steps that differ</span>
          </label>
        </div>
        <table className="zwf-table">
          <caption className="zwf-visually-hidden">
            Steps of {before.label} and {after.label}
          </caption>
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">{before.label}</th>
              <th scope="col">{after.label}</th>
              <th scope="col">Difference</th>
            </tr>
          </thead>
          <tbody>
            {shownRows.map((r) => (
              <tr key={r.code} data-change={r.change}>
                <th scope="row">
                  <code>{r.code}</code>
                </th>
                <td>{r.before ? `${r.before.kind}${r.before.parent ? ` in ${r.before.parent}` : ""}` : "—"}</td>
                <td>{r.after ? `${r.after.kind}${r.after.parent ? ` in ${r.after.parent}` : ""}` : "—"}</td>
                <td>
                  <span className={`zwf-status zwf-status-${TONE[r.change]}`}>
                    <span className="zwf-dot" aria-hidden="true" />
                    {WORD[r.change]}
                    {r.why ? `: ${r.why}` : ""}
                  </span>
                </td>
              </tr>
            ))}
            {shownRows.length === 0 && (
              <tr>
                <td colSpan={4} className="zwf-muted">
                  Every step is the same.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </section>
  );
}
