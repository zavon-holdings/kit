"use client";

import { useEffect, useRef } from "react";
import { typeLabel } from "../catalogue.js";
import { pathNodes, problemCount } from "../analysis.js";
import { addNode, canMoveStep, inEdges, insertOnEdge, moveStep, nodeById, notesOf, outEdges, removeNote, setNote } from "../model.js";
import type { Graph } from "../types.js";
import { nameOf, useEditor, type Editor } from "./context.js";
import { Heading } from "./Heading.js";
import { categoryOf, summarize } from "../design.js";
import { Icon } from "./icons.js";
import { AddStepMenu } from "./AddStepMenu.js";

/**
 * Where "Add a step" at the end of the path puts the new step: on the way
 * into the end the last step leads to, so it runs last; failing that after
 * the last step with no way out; failing that on its own.
 */
function addAtEnd(g: Graph, order: string[], type: string): { graph: Graph; id: string } {
  const steps = order.filter((id) => nodeById(g, id)?.type !== "end");
  for (let i = steps.length - 1; i >= 0; i--) {
    const into = outEdges(g, steps[i]).find(({ edge }) => nodeById(g, edge.to)?.type === "end" && !edge.label && edge.when === undefined);
    if (into) return insertOnEdge(g, into.index, type);
  }
  const loose = [...steps].reverse().find((id) => outEdges(g, id).length === 0);
  return addNode(g, type, loose ? { from: loose } : {});
}

/** Adds a step, then opens it. */
function added(ed: Editor, make: (g: Graph) => { graph: Graph; id: string }) {
  let id = "";
  ed.update((g) => {
    const out = make(g);
    id = out.id;
    return out.graph;
  });
  if (id) {
    ed.select({ kind: "node", id });
    ed.setFocus(id);
  }
}

/**
 * The List tab: the same graph as a numbered path, in compiled order, arms
 * indented under their fork. Each step is its number, its kind's icon, its
 * name and one line of what it does, with a dot when it needs attention.
 * Moving a step earlier or later shows on hover and focus, and works on a
 * straight run; a "+" between two joined steps and "Add a step" at the end
 * open one menu of the kinds. The accessible twin of the canvas — one tab
 * stop, arrows to move, Enter to open a node in the inspector, where every
 * edit the canvas offers is an ordinary control.
 */
export function ListView() {
  const ed = useEditor();
  const { graph, analysis } = ed;
  const pathSet = pathNodes(graph, ed.path);
  const refs = useRef(new Map<string, HTMLLIElement>());
  const tabStop = ed.focusId && analysis.order.includes(ed.focusId) ? ed.focusId : analysis.order[0];

  useEffect(() => {
    if (!ed.focusId || ed.focusTick === 0) return;
    const el = refs.current.get(ed.focusId);
    if (el && document.activeElement !== el) el.focus();
  }, [ed.focusId, ed.focusTick]);

  const move = (from: string, key: string) => {
    const at = analysis.order.indexOf(from);
    const to =
      key === "ArrowDown"
        ? analysis.order[Math.min(analysis.order.length - 1, at + 1)]
        : key === "ArrowUp"
          ? analysis.order[Math.max(0, at - 1)]
          : key === "Home"
            ? analysis.order[0]
            : key === "End"
              ? analysis.order[analysis.order.length - 1]
              : undefined;
    return to;
  };

  const notes = notesOf(graph);
  return (
    <>
      <ol className="zwf-list zwf-path" aria-label="Workflow, as a list">
        {analysis.order.map((id, i) => {
          const n = graph.nodes.find((x) => x.id === id);
          if (!n) return null;
          const arm = analysis.arms.get(id);
          const problems = analysis.byNode.get(id) ?? [];
          const selected = ed.selectedIds.includes(id);
          const outs = outEdges(graph, id);
          const name = nameOf(graph, id);
          const line = n.type === "start" ? ed.triggerSummary || "" : summarize(n, graph);
          const prev = i > 0 ? analysis.order[i - 1] : undefined;
          const joined = prev ? inEdges(graph, id).find(({ edge }) => edge.from === prev) : undefined;
          // A plain "next" to the step drawn below says nothing the path does not.
          const ways = outs.filter(({ edge }) => edge.label || edge.when !== undefined || edge.to !== analysis.order[i + 1]);
          const earlier = !ed.readOnly && canMoveStep(graph, id, -1);
          const later = !ed.readOnly && canMoveStep(graph, id, 1);
          return (
            <li
              key={id}
              ref={(el) => {
                if (el) refs.current.set(id, el);
                else refs.current.delete(id);
              }}
              className="zwf-list-row"
              data-category={categoryOf(n.type)}
              data-depth={arm ? 1 : 0}
              data-selected={selected ? "true" : undefined}
              data-on-path={pathSet.has(id) ? "true" : undefined}
              tabIndex={id === tabStop ? 0 : -1}
              aria-current={selected ? "true" : undefined}
              onFocus={(e) => e.target === e.currentTarget && ed.focusId !== id && ed.setFocus(id)}
              onClick={(e) => {
                if (e.shiftKey || e.metaKey || e.ctrlKey) {
                  const now = new Set(ed.selectedIds);
                  if (now.has(id)) now.delete(id);
                  else now.add(id);
                  const ids = analysis.order.filter((x) => now.has(x));
                  ed.select(ids.length === 0 ? null : ids.length === 1 ? { kind: "node", id: ids[0] } : { kind: "nodes", ids });
                } else ed.select({ kind: "node", id });
                ed.setFocus(id);
              }}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  ed.select({ kind: "node", id });
                  return;
                }
                const to = move(id, e.key);
                if (to) {
                  e.preventDefault();
                  ed.setFocus(to, true);
                }
              }}
            >
              {joined && !ed.readOnly && (
                <div className="zwf-path-between">
                  <AddStepMenu label={`Add a step between ${nameOf(graph, prev!)} and ${name}`} onAdd={(type) => added(ed, (g) => insertOnEdge(g, joined.index, type))} />
                </div>
              )}
              <span className="zwf-path-num" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="zwf-path-body">
                <span className="zwf-list-head">
                  <span className="zwf-list-chip" aria-hidden="true">
                    <Icon name={n.type} size={14} />
                  </span>
                  <span className="zwf-visually-hidden">Step {i + 1}: </span>
                  <strong>{name}</strong>
                  {problems.length > 0 && (
                    <span className="zwf-path-dot" title={problems.map((p) => p.message).join(" ")}>
                      <span className="zwf-visually-hidden">{problemCount(problems.length)}</span>
                    </span>
                  )}
                </span>
                <span className="zwf-path-line">
                  <span className="zwf-node-type">{typeLabel(n.type)}</span>
                  {line ? ` · ${line}` : ""}
                  {arm && ` · arm ${arm.arm} of ${nameOf(graph, arm.fork)}`}
                </span>
                {ed.marks?.[id] && (
                  <span
                    className={`zwf-status zwf-status-${ed.marks[id] === "removed" ? "danger" : ed.marks[id] === "added" ? "ok" : "warn"}`}
                    data-mark={ed.marks[id]}
                  >
                    <span className="zwf-dot" aria-hidden="true" />
                    {ed.marks[id]}
                  </span>
                )}
                {pathSet.has(id) && (
                  <span className="zwf-status zwf-status-path">
                    <span className="zwf-dot" aria-hidden="true" />
                    on the path
                  </span>
                )}
                {ways.length > 0 && (
                  <ul className="zwf-plain zwf-list-ways" aria-label={`Connections from ${name}`}>
                    {ways.map(({ edge, index }) => (
                      <li key={index}>
                        {edge.label ? `${edge.label}${edge.default ? " (default)" : ""}` : "next"} → {nameOf(graph, edge.to)}
                      </li>
                    ))}
                  </ul>
                )}
              </span>
              {(earlier || later) && (
                <span className="zwf-path-move" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="zwf-icon-button"
                    aria-label={`Move ${name} earlier`}
                    title={`Move ${name} earlier`}
                    disabled={!earlier}
                    onClick={() => ed.update((g) => moveStep(g, id, -1))}
                  >
                    <Icon name="up" size={14} />
                  </button>
                  <button
                    type="button"
                    className="zwf-icon-button"
                    aria-label={`Move ${name} later`}
                    title={`Move ${name} later`}
                    disabled={!later}
                    onClick={() => ed.update((g) => moveStep(g, id, 1))}
                  >
                    <Icon name="down" size={14} />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {!ed.readOnly && (
        <div className="zwf-path-end">
          <AddStepMenu label="Add a step" wide onAdd={(type) => added(ed, (g) => addAtEnd(g, analysis.order, type))} />
        </div>
      )}
      {notes.length > 0 && (
        <section className="zwf-section" aria-label="Notes on the canvas">
          <Heading level={ed.headingLevel + 1} className="zwf-subheading">
            Notes
          </Heading>
          <ul className="zwf-plain zwf-list-notes">
            {notes.map((n) => (
              <li key={n.id}>
                <label className="zwf-field">
                  <span>
                    {n.id}
                    {n.node ? ` about ${nameOf(graph, n.node)}` : ""}
                  </span>
                  <textarea
                    rows={2}
                    value={n.text}
                    readOnly={ed.readOnly}
                    onChange={(e) => {
                      const text = e.target.value;
                      ed.update((g) => setNote(g, n.id, { text }), { coalesce: `note:${n.id}` });
                    }}
                  />
                </label>
                {!ed.readOnly && (
                  <button type="button" className="zwf-button zwf-quiet" onClick={() => ed.update((g) => removeNote(g, n.id))}>
                    Remove {n.id}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
