"use client";

import { NODE_KINDS, PALETTE_GROUPS } from "../catalogue.js";
import { addNode, nodeById, outEdges, roleOf } from "../model.js";
import { positions } from "../layout.js";
import { useEditor } from "./context.js";

/**
 * The node vocabulary, grouped. Adding a node places it below the selected
 * one and, when that node has no way out yet, connects the two. A type the
 * host cannot offer here is greyed, with the reason in words beside it —
 * never just hidden, never just a colour.
 */
export function Palette() {
  const ed = useEditor();
  if (ed.readOnly) return null;
  const selected = ed.selection?.kind === "node" ? nodeById(ed.graph, ed.selection.id) : undefined;

  const add = (type: string) => {
    let id = "";
    ed.update((g) => {
      const from = selected && selected.type !== "end" && (outEdges(g, selected.id).length === 0 || roleOf(g, selected.id) !== "sequence") ? selected.id : undefined;
      const p = selected ? positions(g)[selected.id] : undefined;
      const at = p ? { x: p.x, y: p.y + 120 } : undefined;
      const out = addNode(g, type, { from, at });
      id = out.id;
      return out.graph;
    });
    if (id) {
      ed.select({ kind: "node", id });
      ed.setFocus(id);
    }
  };

  return (
    <nav className="zwf-palette" aria-label="Add a node">
      {PALETTE_GROUPS.map((group) => (
        <section key={group} className="zwf-palette-group" aria-label={group}>
          <p className="zwf-subheading" aria-hidden="true">
            {group}
          </p>
          <ul className="zwf-plain">
            {NODE_KINDS.filter((k) => k.group === group).map((k) => {
              const why = ed.unavailable[k.type];
              return (
                <li key={k.type}>
                  <button
                    type="button"
                    className="zwf-palette-item"
                    aria-disabled={why ? true : undefined}
                    aria-describedby={why ? `zwf-why-${k.type}` : undefined}
                    title={why ? undefined : k.blurb}
                    onClick={() => !why && add(k.type)}
                  >
                    Add {k.label.toLowerCase()}
                  </button>
                  {why && (
                    <span id={`zwf-why-${k.type}`} className="zwf-muted zwf-why">
                      {why}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
