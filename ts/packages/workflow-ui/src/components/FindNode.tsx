"use client";

import { useId, useState, type RefObject } from "react";
import { typeLabel } from "../catalogue.js";
import { searchNodes } from "../search.js";
import { useEditor } from "./context.js";

/**
 * Find a node by name, id, type or something in its settings. Enter goes to
 * the first match; each match is a button that selects the node and brings
 * it into view.
 */
export function FindNode({ inputRef }: { inputRef?: RefObject<HTMLInputElement | null> }) {
  const ed = useEditor();
  const id = useId();
  const [q, setQ] = useState("");
  const found = searchNodes(ed.graph, q, 8);
  const go = (to: string) => {
    ed.reveal(to);
    setQ("");
  };
  return (
    <div className="zwf-find" role="search">
      <label className="zwf-visually-hidden" htmlFor={`${id}-q`}>
        Find a node
      </label>
      <input
        ref={inputRef}
        id={`${id}-q`}
        type="search"
        placeholder="Find a node…"
        value={q}
        aria-describedby={q ? `${id}-count` : undefined}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && found[0]) {
            e.preventDefault();
            go(found[0].id);
          }
          if (e.key === "Escape") setQ("");
        }}
      />
      {q && (
        <div className="zwf-find-results">
          <p id={`${id}-count`} className="zwf-muted" role="status">
            {found.length === 0 ? "No node matches." : `${found.length} match${found.length === 1 ? "" : "es"}.`}
          </p>
          {found.length > 0 && (
            <ul className="zwf-plain">
              {found.map((f) => (
                <li key={f.id}>
                  <button type="button" className="zwf-link" onClick={() => go(f.id)}>
                    {f.name}
                  </button>{" "}
                  <span className="zwf-muted">
                    {typeLabel(f.type)}
                    {f.where === "settings" ? " · in its settings" : f.where === "id" ? ` · ${f.id}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
