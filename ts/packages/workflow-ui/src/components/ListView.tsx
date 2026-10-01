"use client";

import { useEffect, useRef } from "react";
import { typeLabel } from "../catalogue.js";
import { pathNodes, problemCount } from "../analysis.js";
import { notesOf, outEdges, removeNote, setNote } from "../model.js";
import { nameOf, useEditor } from "./context.js";

/**
 * The List tab: the same graph as an outline, in compiled order, arms
 * indented under their fork. The accessible twin of the canvas — one tab
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
      <ol className="zwf-list" aria-label="Workflow, as a list">
        {analysis.order.map((id) => {
          const n = graph.nodes.find((x) => x.id === id);
          if (!n) return null;
          const arm = analysis.arms.get(id);
          const problems = analysis.byNode.get(id)?.length ?? 0;
          const selected = ed.selectedIds.includes(id);
          const outs = outEdges(graph, id);
          return (
            <li
              key={id}
              ref={(el) => {
                if (el) refs.current.set(id, el);
                else refs.current.delete(id);
              }}
              className="zwf-list-row"
              data-depth={arm ? 1 : 0}
              data-selected={selected ? "true" : undefined}
              data-on-path={pathSet.has(id) ? "true" : undefined}
              tabIndex={id === tabStop ? 0 : -1}
              aria-current={selected ? "true" : undefined}
              onFocus={() => ed.focusId !== id && ed.setFocus(id)}
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
              <span className="zwf-list-head">
                <span className="zwf-node-type">{typeLabel(n.type)}</span> <strong>{nameOf(graph, id)}</strong>
                {nameOf(graph, id) !== id && <code className="zwf-node-id"> {id}</code>}
                {arm && (
                  <span className="zwf-muted">
                    {" "}
                    · arm {arm.arm} of {nameOf(graph, arm.fork)}
                  </span>
                )}
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
              {problems > 0 && (
                <span className="zwf-status zwf-status-danger">
                  <span className="zwf-dot" aria-hidden="true" />
                  {problemCount(problems)}
                </span>
              )}
              {pathSet.has(id) && (
                <span className="zwf-status zwf-status-path">
                  <span className="zwf-dot" aria-hidden="true" />
                  on the path
                </span>
              )}
              {outs.length > 0 && (
                <ul className="zwf-plain zwf-list-ways" aria-label={`Ways out of ${nameOf(graph, id)}`}>
                  {outs.map(({ edge, index }) => (
                    <li key={index}>
                      {edge.label ? `${edge.label}${edge.default ? " (default)" : ""}` : "next"} → {nameOf(graph, edge.to)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {notes.length > 0 && (
        <section className="zwf-section" aria-label="Notes on the canvas">
          <h4 className="zwf-subheading">Notes</h4>
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
