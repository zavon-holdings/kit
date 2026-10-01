"use client";

import { useRef, useState } from "react";
import { download, graphSvg, graphToJson, printGraph, readGraphJson, svgToPng } from "../exporting.js";
import { slug } from "../model.js";
import { typeLabel } from "../catalogue.js";
import type { Graph } from "../types.js";
import { nameOf, useEditor } from "./context.js";

/**
 * Taking the graph out (a JSON file, an SVG or PNG picture, a printed page)
 * and bringing one in. An imported graph replaces the drawing as one edit,
 * so Undo puts the old one back; its problems show like any other's.
 */
export function ExportMenu({ title, onImport }: { title: string; onImport?: (g: Graph) => void }) {
  const ed = useEditor();
  const file = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  /** Closes the menu once something in it was chosen. */
  const done = () => {
    if (menu.current) menu.current.open = false;
  };
  const [error, setError] = useState("");
  const name = slug(title) || "workflow";
  const picture = () => graphSvg(ed.graph, { title, path: ed.path });

  const outline = () =>
    ed.analysis.order.map((id) => {
      const n = ed.graph.nodes.find((x) => x.id === id);
      return n ? `${typeLabel(n.type)}: ${nameOf(ed.graph, id)}${nameOf(ed.graph, id) !== id ? ` (${id})` : ""}` : id;
    });

  return (
    <details className="zwf-menu" ref={menu}>
      <summary className="zwf-button">Export</summary>
      <div className="zwf-menu-body" role="group" aria-label="Export and import">
        <button type="button" className="zwf-button zwf-quiet" onClick={() => {
            download(`${name}.workflow.json`, graphToJson(ed.graph));
            done();
          }}>
          Download the graph (JSON)
        </button>
        <button type="button" className="zwf-button zwf-quiet" onClick={() => {
            download(`${name}.svg`, picture(), "image/svg+xml");
            done();
          }}>
          Download a picture (SVG)
        </button>
        <button
          type="button"
          className="zwf-button zwf-quiet"
          onClick={async () => {
            setError("");
            try {
              const png = await svgToPng(picture());
              if (png) {
                download(`${name}.png`, png);
                done();
              }
              else setError("This browser cannot draw a PNG; download the SVG instead.");
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Download a picture (PNG)
        </button>
        <button type="button" className="zwf-button zwf-quiet" onClick={() => {
            printGraph(picture(), title, outline());
            done();
          }}>
          Print
        </button>
        {onImport && (
          <>
            <button type="button" className="zwf-button zwf-quiet" onClick={() => file.current?.click()}>
              Import a graph (JSON)…
            </button>
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              className="zwf-visually-hidden"
              tabIndex={-1}
              aria-label="Graph file to import"
              onChange={async (e) => {
                setError("");
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const out = readGraphJson(await f.text());
                if (out.graph) {
                  onImport(out.graph);
                  done();
                }
                else setError(out.error);
              }}
            />
          </>
        )}
        {error && (
          <p className="zwf-status zwf-status-danger" role="alert">
            <span className="zwf-dot" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
