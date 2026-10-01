"use client";

import { nameOf, useEditor } from "./context.js";

/** Every problem, each with a way to the node or edge it is about. */
export function ProblemsPanel() {
  const ed = useEditor();
  const ps = ed.analysis.problems;
  if (ps.length === 0) {
    return (
      <p className="zwf-status zwf-status-ok">
        <span className="zwf-dot" aria-hidden="true" />
        No problems: the graph compiles.
      </p>
    );
  }
  return (
    <ul className="zwf-plain zwf-problems">
      {ps.map((p, i) => {
        const edgeIndex = p.edge ? ed.graph.edges.findIndex((e) => e.from === p.edge!.from && e.to === p.edge!.to && (e.label ?? "") === (p.edge!.label ?? "")) : -1;
        const where = edgeIndex >= 0 ? `${nameOf(ed.graph, p.edge!.from)} → ${nameOf(ed.graph, p.edge!.to)}` : p.node ? nameOf(ed.graph, p.node) : "";
        return (
          <li key={i} className="zwf-status zwf-status-danger">
            <span className="zwf-dot" aria-hidden="true" />
            <span>
              {p.message}{" "}
              {where && (
                <button
                  type="button"
                  className="zwf-link"
                  onClick={() => (edgeIndex >= 0 ? ed.select({ kind: "edge", index: edgeIndex }) : ed.select({ kind: "node", id: p.node! }))}
                >
                  Show {where}
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
