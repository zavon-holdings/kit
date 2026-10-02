"use client";

import { useState } from "react";
import type { ApiError, AssigneePreview as Preview, GraphNode } from "../types.js";
import { useEditor } from "./context.js";

/** Node types a person is asked at, and so have somebody to ask. */
export const ASKS_PEOPLE = new Set(["review", "form", "approval", "task", "todo"]);

/**
 * "Who would this go to?" for the simulation's sample subject, answered by
 * the server's own resolver — the directory, the roles, the app's resolver —
 * and writing nothing. Nobody found is said in red, because a task nobody
 * can decide waits for ever.
 */
export function AssigneePreview({ node }: { node: GraphNode }) {
  const ed = useEditor();
  const [state, setState] = useState<{ for: unknown; preview?: Preview; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!ed.api?.previewAssignees || !ASKS_PEOPLE.has(node.type)) return null;
  const fresh = state && state.for === node.config;
  const ask = async () => {
    setBusy(true);
    const asked = node.config;
    try {
      const preview = await ed.api!.previewAssignees!({ node, sample: ed.sample });
      setState({ for: asked, preview });
    } catch (e) {
      setState({ for: asked, error: (e as ApiError)?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  };
  const p = state?.preview;
  return (
    <section className="zwf-section" aria-label="Who this goes to">
      <div className="zwf-row">
        <button type="button" className="zwf-button" disabled={busy} onClick={() => void ask()}>
          {busy ? "Asking…" : `Who would this go to for ${ed.sample.subject.label || `${ed.sample.subject.type} ${ed.sample.subject.pid}`}?`}
        </button>
        {state && !fresh && <span className="zwf-muted">The settings changed since; ask again.</span>}
      </div>
      {state?.error && (
        <p className="zwf-status zwf-status-danger" role="alert">
          <span className="zwf-dot" aria-hidden="true" />
          {state.error}
        </p>
      )}
      {p && (
        <div role="status">
          {p.unassignable ? (
            <p className="zwf-status zwf-status-danger">
              <span className="zwf-dot" aria-hidden="true" />
              Nobody: a task here would be unassignable. {p.says}
            </p>
          ) : (
            <>
              <p className="zwf-muted">{p.says}</p>
              <ul className="zwf-plain">
                {p.assignees.map((a) => (
                  <li key={a.email}>
                    {a.name ? `${a.name} <${a.email}>` : a.email}
                    {a.source && <span className="zwf-muted"> · {a.source}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {p.stale && (
            <p className="zwf-status zwf-status-warn">
              <span className="zwf-dot" aria-hidden="true" />
              Read from a directory that may be out of date.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
