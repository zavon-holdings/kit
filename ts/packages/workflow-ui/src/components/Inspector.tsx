"use client";

import { useEffect, useId, useRef, useState } from "react";
import { TIMEOUT_LABEL } from "@zavon/workflow-graph";
import { chooses, isTask, typeLabel } from "../catalogue.js";
import { fieldSuggestions } from "../fields.js";
import {
  connect,
  disconnect,
  EditError,
  isLastDefault,
  moveEdge,
  nodeById,
  outEdges,
  removeNode,
  renameNode,
  roleOf,
  setDefault,
  setEdge,
  setMaxPasses,
  setNodeConfig,
  setNodeName,
} from "../model.js";
import type { GraphEdge, GraphNode } from "../types.js";
import { edgeKey, problemCount } from "../analysis.js";
import { ConditionBuilder } from "./ConditionBuilder.js";
import { nameOf, useEditor } from "./context.js";
import { BUILT_IN_INSPECTORS, JsonInspector } from "./inspectors.js";
import { AssigneePreview } from "./AssigneePreview.js";
import { InterruptsPanel, TriggerPanel } from "./TriggerPanel.js";
import { alignNodes, distributeNodes, removeNodes, type Alignment } from "../arrange.js";
import { subtree } from "../clipboard.js";

/**
 * The selected node's settings and its ways out. Everything the canvas can
 * do to a node can be done here with ordinary controls, which is what makes
 * the List tab a full editor.
 */
export function Inspector() {
  const ed = useEditor();
  const sel = ed.selection;
  const nodeId = sel?.kind === "node" ? sel.id : sel?.kind === "edge" ? ed.graph.edges[sel.index]?.from : undefined;
  const node = nodeId ? nodeById(ed.graph, nodeId) : undefined;
  const headingRef = useRef<HTMLHeadingElement>(null);

  if (sel?.kind === "nodes") {
    return (
      <aside className="zwf-inspector" aria-label="Inspector">
        <SeveralNodes ids={sel.ids} />
      </aside>
    );
  }
  if (!node) {
    return (
      <aside className="zwf-inspector" aria-label="Inspector">
        <p className="zwf-muted">Select a node to see its settings and its ways out.</p>
      </aside>
    );
  }
  return (
    <aside className="zwf-inspector" aria-label="Inspector">
      <NodeSettings key={node.id} node={node} headingRef={headingRef} focusEdge={sel?.kind === "edge" ? sel.index : undefined} />
    </aside>
  );
}

function NodeSettings({ node, headingRef, focusEdge }: { node: GraphNode; headingRef: React.RefObject<HTMLHeadingElement | null>; focusEdge?: number }) {
  const ed = useEditor();
  const ro = ed.readOnly;
  const [idDraft, setIdDraft] = useState(node.id);
  const [idError, setIdError] = useState("");
  const problems = ed.analysis.byNode.get(node.id) ?? [];
  const HostInspector = ed.inspectors[node.type] ?? (BUILT_IN_INSPECTORS as Record<string, typeof JsonInspector>)[node.type];
  const structural = node.type === "start" || node.type === "fork" || node.type === "decision";

  const commitId = () => {
    if (idDraft === node.id) return;
    try {
      const next = idDraft.trim();
      const renamed = renameNode(ed.graph, node.id, next);
      ed.update(() => renamed);
      ed.select({ kind: "node", id: next });
      setIdError("");
    } catch (e) {
      setIdError(e instanceof EditError ? e.message : String(e));
    }
  };

  return (
    <div className="zwf-settings">
      <p className="zwf-kicker">{typeLabel(node.type)}</p>
      <h3 ref={headingRef} className="zwf-heading" tabIndex={-1}>
        {nameOf(ed.graph, node.id)}
      </h3>
      {problems.length > 0 && (
        <div className="zwf-status zwf-status-danger" role="status">
          <span className="zwf-dot" aria-hidden="true" />
          <span>
            {problemCount(problems.length)}
            <ul className="zwf-plain">
              {problems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          </span>
        </div>
      )}

      {node.type === "start" ? (
        ed.triggerEditor ? (
          <>
            <TriggerPanel value={ed.triggerEditor.value} onChange={ed.triggerEditor.onChange} events={ed.triggerEditor.events} />
            {ed.triggerEditor.interrupts && (
              <InterruptsPanel
                value={ed.triggerEditor.interrupts}
                onChange={ed.triggerEditor.onInterruptsChange}
                events={ed.triggerEditor.events}
                targets={(ed.analysis.steps ?? [])
                  .filter((st) => !st.parent && !st.code.includes("--"))
                  .map((st) => ({ code: st.code, name: nameOf(ed.graph, st.code) }))}
              />
            )}
          </>
        ) : (
          <p className="zwf-muted">{ed.triggerSummary || "Every run begins here. What starts a run is the definition's trigger, not a setting of this node."}</p>
        )
      ) : (
        <>
          <label className="zwf-field">
            <span>Name</span>
            <input value={node.name ?? ""} placeholder={node.id} readOnly={ro} onChange={(e) => ed.update((g) => setNodeName(g, node.id, e.target.value), { coalesce: `name:${node.id}` })} />
          </label>
          <label className="zwf-field">
            <span>Id (the step's code)</span>
            <input
              value={idDraft}
              readOnly={ro}
              spellCheck={false}
              onChange={(e) => setIdDraft(e.target.value)}
              onBlur={commitId}
              onKeyDown={(e) => e.key === "Enter" && commitId()}
              aria-invalid={idError ? true : undefined}
            />
            {idError && <span className="zwf-ink-danger">{idError}</span>}
          </label>
        </>
      )}

      {!structural && (
        <section className="zwf-section" aria-label="Settings">
          {HostInspector ? (
            <HostInspector node={node} readOnly={ro} onChange={(config) => ed.update((g) => setNodeConfig(g, node.id, config), { coalesce: `config:${node.id}` })} />
          ) : (
            <JsonInspector node={node} readOnly={ro} onChange={(config) => ed.update((g) => setNodeConfig(g, node.id, config), { coalesce: `config:${node.id}` })} />
          )}
          {HostInspector && (
            <details className="zwf-advanced">
              <summary>Advanced: the settings as JSON</summary>
              <JsonInspector node={node} readOnly={ro} onChange={(config) => ed.update((g) => setNodeConfig(g, node.id, config), { coalesce: `config:${node.id}` })} />
            </details>
          )}
          <AssigneePreview node={node} />
        </section>
      )}

      <WaysOut node={node} focusEdge={focusEdge} />

      {node.type !== "start" && node.type !== "end" && (
        <label className="zwf-field">
          <span>Times a loop may come back here (1–100; empty is 25)</span>
          <input
            type="number"
            min={1}
            max={100}
            readOnly={ro}
            value={node.max_passes ?? ""}
            onChange={(e) => ed.update((g) => setMaxPasses(g, node.id, e.target.value ? Number(e.target.value) : undefined), { coalesce: `passes:${node.id}` })}
          />
        </label>
      )}

      {node.type !== "start" && (
        <div className="zwf-row">
          <button type="button" className="zwf-button zwf-quiet" onClick={() => ed.copy([node.id])}>
            Copy
          </button>
          {node.type !== "end" && (
            <button type="button" className="zwf-button zwf-quiet" onClick={() => ed.copy(subtree(ed.graph, node.id))}>
              Copy it and everything after it
            </button>
          )}
          {!ro && ed.canPaste && (
            <button type="button" className="zwf-button zwf-quiet" onClick={() => ed.paste()}>
              Paste
            </button>
          )}
        </div>
      )}

      {!ro && node.type !== "start" && (
        <button
          type="button"
          className="zwf-button zwf-danger"
          onClick={() => {
            ed.update((g) => removeNode(g, node.id));
            ed.select(null);
          }}
        >
          Remove {nameOf(ed.graph, node.id)}
        </button>
      )}
    </div>
  );
}

function WaysOut({ node, focusEdge }: { node: GraphNode; focusEdge?: number }) {
  const ed = useEditor();
  const ro = ed.readOnly;
  const id = useId();
  const role = roleOf(ed.graph, node.id);
  const outs = outEdges(ed.graph, node.id);
  const [target, setTarget] = useState("");
  const focused = useRef<HTMLLIElement>(null);
  useEffect(() => {
    focused.current?.scrollIntoView?.({ block: "nearest" });
  }, [focusEdge]);

  if (node.type === "end") return <p className="zwf-muted">The run ends here, so nothing follows.</p>;

  const candidates = ed.graph.nodes.filter((n) => n.id !== node.id && n.type !== "start");
  const outcomeNames = isTask(node.type)
    ? (((node.config as { outcomes?: { name?: string }[] } | undefined)?.outcomes ?? []).map((o) => o?.name ?? "").filter(Boolean) as string[])
    : [];

  return (
    <section className="zwf-section" aria-labelledby={`${id}-ways`}>
      <h4 id={`${id}-ways`} className="zwf-subheading">
        Ways out
      </h4>
      {outs.length === 0 && <p className="zwf-muted">None yet: connect it to what happens next.</p>}
      <ol className="zwf-ways">
        {outs.map(({ edge, index }, k) => (
          <li key={index} ref={index === focusEdge ? focused : undefined} className="zwf-way" aria-current={index === focusEdge ? "true" : undefined}>
            <WayOut node={node} edge={edge} index={index} position={k} count={outs.length} role={role} outcomeNames={outcomeNames} />
          </li>
        ))}
      </ol>
      {!ro && (
        <div className="zwf-connect">
          <label className="zwf-field">
            <span>Connect to…</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose a node</option>
              {candidates.map((n) => (
                <option key={n.id} value={n.id}>
                  {nameOf(ed.graph, n.id)} ({typeLabel(n.type)})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="zwf-button"
            disabled={!target}
            onClick={() => {
              ed.update((g) => connect(g, node.id, target).graph);
              setTarget("");
            }}
          >
            Connect
          </button>
        </div>
      )}
    </section>
  );
}

function WayOut({
  node,
  edge,
  index,
  position,
  count,
  role,
  outcomeNames,
}: {
  node: GraphNode;
  edge: GraphEdge;
  index: number;
  position: number;
  count: number;
  role: ReturnType<typeof roleOf>;
  outcomeNames: string[];
}) {
  const ed = useEditor();
  const ro = ed.readOnly;
  const id = useId();
  const problems = ed.analysis.byEdge.get(edgeKey(edge)) ?? [];
  const targetName = nameOf(ed.graph, edge.to);
  const isTimeout = role === "wait" && edge.label === TIMEOUT_LABEL;
  const labelled = chooses(role) || role === "fork";
  const lastDefault = isLastDefault(ed.graph, index);
  const sample = ed.sample;

  return (
    <div className="zwf-way-body">
      <p className="zwf-way-title">
        {edge.label ? <strong>{edge.label}</strong> : <strong>Next</strong>} → {targetName}
        {edge.default && <span className="zwf-tag"> default</span>}
      </p>
      {problems.length > 0 && (
        <p className="zwf-status zwf-status-danger">
          <span className="zwf-dot" aria-hidden="true" />
          {problems.map((p) => p.message).join(" ")}
        </p>
      )}
      <fieldset className="zwf-group" disabled={ro}>
        <legend className="zwf-visually-hidden">
          Way out {position + 1} of {count} from {nameOf(ed.graph, node.id)}
        </legend>
        {isTimeout && <p className="zwf-muted">Taken when the wait times out.</p>}
        {labelled && !isTimeout && (
          <label className="zwf-field">
            <span>{role === "fork" ? "Arm name (optional; a step-code word)" : role === "routes" ? "Outcome" : "Branch name"}</span>
            <input
              value={edge.label ?? ""}
              list={outcomeNames.length ? `${id}-outcomes` : undefined}
              onChange={(e) => ed.update((g) => setEdge(g, index, { label: e.target.value }), { coalesce: `edge:${index}` })}
            />
            {outcomeNames.length > 0 && (
              <datalist id={`${id}-outcomes`}>
                {outcomeNames.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            )}
          </label>
        )}
        <label className="zwf-field">
          <span>Goes to</span>
          <select value={edge.to} onChange={(e) => ed.update((g) => setEdge(g, index, { to: e.target.value }))}>
            {ed.graph.nodes
              .filter((n) => n.type !== "start" && n.id !== node.id)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {nameOf(ed.graph, n.id)}
                </option>
              ))}
          </select>
        </label>
        {chooses(role) && (
          <label className="zwf-check">
            <input type="radio" name={`default-${node.id}`} checked={!!edge.default} onChange={() => ed.update((g) => setDefault(g, index))} />
            <span>The default: taken when nothing else matches</span>
          </label>
        )}
        {role === "decision" && !edge.default && (
          <ConditionBuilder
            legend={`Take "${edge.label ?? ""}" when`}
            value={edge.when}
            readOnly={ro}
            fields={fieldSuggestions(ed.graph, sample)}
            sample={sample}
            onChange={(when) => ed.update((g) => setEdge(g, index, { when }))}
          />
        )}
        {role === "routes" && !edge.default && (
          <details className="zwf-advanced" open={edge.when !== undefined}>
            <summary>Only when (optional)</summary>
            <ConditionBuilder
              legend={`Take "${edge.label ?? ""}" only when`}
              value={edge.when}
              readOnly={ro}
              fields={fieldSuggestions(ed.graph, sample)}
              sample={sample}
              onChange={(when) => ed.update((g) => setEdge(g, index, { when }))}
            />
          </details>
        )}
        {!ro && (
          <div className="zwf-row">
            {count > 1 && (
              <>
                <button type="button" className="zwf-button zwf-quiet" disabled={position === 0} onClick={() => ed.update((g) => moveEdge(g, index, -1))}>
                  Earlier
                </button>
                <button type="button" className="zwf-button zwf-quiet" disabled={position === count - 1} onClick={() => ed.update((g) => moveEdge(g, index, 1))}>
                  Later
                </button>
              </>
            )}
            {lastDefault ? (
              <span className="zwf-muted">The default way out stays until another is made the default.</span>
            ) : (
              <button type="button" className="zwf-button zwf-quiet" onClick={() => ed.update((g) => disconnect(g, index))}>
                Remove this way out
              </button>
            )}
          </div>
        )}
      </fieldset>
    </div>
  );
}


const ALIGNMENTS: { how: Alignment; label: string }[] = [
  { how: "left", label: "Align left" },
  { how: "center", label: "Align centres" },
  { how: "right", label: "Align right" },
  { how: "top", label: "Align tops" },
  { how: "middle", label: "Align middles" },
  { how: "bottom", label: "Align bottoms" },
];

/** Several nodes selected: arrange them, copy them, or remove them together. */
function SeveralNodes({ ids }: { ids: string[] }) {
  const ed = useEditor();
  const ro = ed.readOnly;
  const removable = ids.filter((id) => nodeById(ed.graph, id)?.type !== "start");
  return (
    <div className="zwf-settings">
      <p className="zwf-kicker">Selection</p>
      <h3 className="zwf-heading">{ids.length} nodes</h3>
      <ul className="zwf-plain zwf-selected-list">
        {ids.map((id) => (
          <li key={id}>
            <button type="button" className="zwf-link" onClick={() => ed.reveal(id)}>
              {nameOf(ed.graph, id)}
            </button>
          </li>
        ))}
      </ul>
      {!ro && (
        <fieldset className="zwf-group">
          <legend>Arrange</legend>
          <div className="zwf-row zwf-wrap">
            {ALIGNMENTS.map((a) => (
              <button key={a.how} type="button" className="zwf-button zwf-quiet" onClick={() => ed.update((g) => alignNodes(g, ids, a.how))}>
                {a.label}
              </button>
            ))}
            <button type="button" className="zwf-button zwf-quiet" disabled={ids.length < 3} onClick={() => ed.update((g) => distributeNodes(g, ids, "horizontal"))}>
              Space evenly across
            </button>
            <button type="button" className="zwf-button zwf-quiet" disabled={ids.length < 3} onClick={() => ed.update((g) => distributeNodes(g, ids, "vertical"))}>
              Space evenly down
            </button>
          </div>
        </fieldset>
      )}
      <div className="zwf-row">
        <button type="button" className="zwf-button zwf-quiet" onClick={() => ed.copy(ids)}>
          Copy {ids.length} nodes
        </button>
        {!ro && ed.canPaste && (
          <button type="button" className="zwf-button zwf-quiet" onClick={() => ed.paste()}>
            Paste
          </button>
        )}
      </div>
      {!ro && removable.length > 0 && (
        <button
          type="button"
          className="zwf-button zwf-danger"
          onClick={() => {
            ed.update((g) => removeNodes(g, removable));
            ed.select(null);
          }}
        >
          Remove {removable.length} node{removable.length === 1 ? "" : "s"}
        </button>
      )}
      {removable.length < ids.length && <p className="zwf-muted">The start stays: every workflow begins somewhere.</p>}
    </div>
  );
}
