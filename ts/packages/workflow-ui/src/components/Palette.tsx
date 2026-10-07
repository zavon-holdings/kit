"use client";

import { useId, useState } from "react";
import { NODE_KINDS, PALETTE_GROUPS } from "../catalogue.js";
import { categoryOf } from "../design.js";
import { addNode, nodeById, outEdges, roleOf } from "../model.js";
import { positions } from "../layout.js";
import type { Point } from "../types.js";
import { useEditor, type Editor } from "./context.js";
import { CategoryIcon, Icon } from "./icons.js";

/** The drag payload a palette card carries onto the canvas: the node type. */
export const DRAG_TYPE = "application/x-zwf-node-type";

/**
 * Adds a node the way the palette does: below the selected node and, when
 * that node has no way out yet (or chooses between several), connected to
 * it. `at` places it where it was dropped; `from` names the node to follow.
 */
export function addFromPalette(ed: Editor, type: string, options: { at?: Point; from?: string } = {}) {
  const selected = ed.selection?.kind === "node" ? nodeById(ed.graph, ed.selection.id) : undefined;
  let id = "";
  ed.update((g) => {
    const after = options.from ? nodeById(g, options.from) : selected;
    const from = after && after.type !== "end" && (outEdges(g, after.id).length === 0 || roleOf(g, after.id) !== "sequence") ? after.id : undefined;
    const p = after ? positions(g)[after.id] : undefined;
    const at = options.at ?? (p ? { x: p.x, y: p.y + 120 } : undefined);
    const out = addNode(g, type, { from, at });
    id = out.id;
    return out.graph;
  });
  if (id) {
    ed.select({ kind: "node", id });
    ed.setFocus(id);
  }
}

/**
 * The node vocabulary, grouped, each with its icon and a line on what it
 * does; a search narrows it. A card is clicked to add the node below the
 * selected one, or dragged onto the canvas to place it. A type the host
 * cannot offer is greyed, with the reason in words beside it — never just
 * hidden, never just a colour.
 */
export function Palette() {
  const ed = useEditor();
  const id = useId();
  const [q, setQ] = useState("");
  if (ed.readOnly) return null;
  const query = q.trim().toLowerCase();
  const matches = (k: (typeof NODE_KINDS)[number]) => !query || `${k.label} ${k.blurb} ${k.group} ${k.type}`.toLowerCase().includes(query);
  const shown = PALETTE_GROUPS.map((group) => ({ group, kinds: NODE_KINDS.filter((k) => k.group === group && matches(k)) })).filter((g) => g.kinds.length > 0);

  return (
    <nav className="zwf-palette" aria-label="Add a node">
      <div className="zwf-palette-head">
        <p className="zwf-palette-title">Steps</p>
        <p className="zwf-muted zwf-palette-hint">Click to add below the selected step, or drag onto the canvas.</p>
        <div className="zwf-palette-search">
          <Icon name="search" size={14} />
          <label className="zwf-visually-hidden" htmlFor={`${id}-q`}>
            Search steps
          </label>
          <input id={`${id}-q`} type="search" placeholder="Search steps" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQ("")} />
        </div>
      </div>
      {shown.length === 0 && (
        <p className="zwf-muted zwf-palette-none" role="status">
          No step matches “{q.trim()}”.
        </p>
      )}
      {shown.map(({ group, kinds }) => {
        const category = categoryOf(kinds[0].type);
        return (
          <section key={group} className="zwf-palette-group" aria-label={group} data-category={category}>
            <p className="zwf-palette-group-title" aria-hidden="true">
              <span className="zwf-palette-group-icon">
                <CategoryIcon category={category} size={13} />
              </span>
              {group}
            </p>
            <ul className="zwf-plain zwf-palette-list">
              {kinds.map((k) => {
                const why = ed.unavailable[k.type];
                return (
                  <li key={k.type}>
                    <button
                      type="button"
                      className="zwf-palette-item"
                      data-category={category}
                      aria-label={`Add ${k.label.toLowerCase()}`}
                      aria-disabled={why ? true : undefined}
                      aria-describedby={why ? `zwf-why-${k.type}` : `${id}-d-${k.type}`}
                      draggable={!why}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_TYPE, k.type);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => !why && addFromPalette(ed, k.type)}
                    >
                      <span className="zwf-palette-icon" aria-hidden="true">
                        <Icon name={k.type} size={15} />
                      </span>
                      <span className="zwf-palette-words">
                        <span className="zwf-palette-label">{k.label}</span>
                        <span id={`${id}-d-${k.type}`} className="zwf-palette-blurb">
                          {k.blurb}
                        </span>
                      </span>
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
        );
      })}
    </nav>
  );
}
