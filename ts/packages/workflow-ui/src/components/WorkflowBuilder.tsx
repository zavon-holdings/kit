"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { analyse } from "../analysis.js";
import type { ApiError, Graph, Inspectors, Problem, Sample, Selection, Step, WorkflowApi } from "../types.js";
import { EditorContext, useReducedMotion, type Editor } from "./context.js";
import { Inspector } from "./Inspector.js";
import { ListView } from "./ListView.js";
import { Palette } from "./Palette.js";
import { ProblemsPanel } from "./ProblemsPanel.js";
import { SimulatePanel } from "./SimulatePanel.js";
import { StepsPanel } from "./StepsPanel.js";
import { layoutAll, WorkflowCanvas } from "./WorkflowCanvas.js";

export type WorkflowBuilderProps = {
  graph: Graph;
  /** Every edit, as the whole new graph. Absent or readOnly: nothing can change. */
  onChange?: (graph: Graph) => void;
  readOnly?: boolean;
  /** The definition's trigger kind ("event" puts event.* in scope from the start). */
  trigger?: string;
  /** What starts a run, in words, shown on the start node. */
  triggerSummary?: string;
  /** The host's inspector per node type. */
  inspectors?: Inspectors;
  api?: WorkflowApi;
  /** The steps saved now, for the Steps panel's comparison. */
  savedSteps?: Step[];
  /** Problems the server answered (a refused save), shown beside the twin's. */
  serverProblems?: Problem[];
  /** Node types greyed in the palette, with the reason in words. */
  unavailable?: Record<string, string>;
  /** The simulation's starting sample. */
  sample?: Sample;
  /** The host's own controls (Save, Versions…), shown in the top bar. */
  toolbar?: ReactNode;
  defaultView?: "canvas" | "list";
  /** What the editor is called, for assistive technology. */
  label?: string;
};

const DEFAULT_SAMPLE: Sample = { subject: { type: "person", pid: "sample-1" }, vars: {} };

type Panel = "problems" | "steps" | "simulate";

function tabKeys(e: KeyboardEvent<HTMLButtonElement>, ids: string[], current: string, set: (id: string) => void) {
  const at = ids.indexOf(current);
  const to = e.key === "ArrowRight" ? ids[(at + 1) % ids.length] : e.key === "ArrowLeft" ? ids[(at - 1 + ids.length) % ids.length] : null;
  if (!to) return;
  e.preventDefault();
  set(to);
  (e.currentTarget.parentElement?.querySelector(`[data-tab="${to}"]`) as HTMLElement | null)?.focus();
}

/**
 * The whole editor: the canvas or its List twin, the palette, the inspector,
 * and the Problems, Steps and Simulate panels. Controlled: the host holds
 * the graph and saves it; the editor only ever proposes the next graph.
 */
export function WorkflowBuilder(props: WorkflowBuilderProps) {
  const { graph, onChange, trigger = "", api, savedSteps, toolbar, label = "Workflow editor" } = props;
  const readOnly = props.readOnly || !onChange;
  const uid = useId();
  const reducedMotion = useReducedMotion();
  const [view, setView] = useState<"canvas" | "list">(props.defaultView ?? "canvas");
  const [panel, setPanel] = useState<Panel>("problems");
  const [selection, setSelection] = useState<Selection>(null);
  const [focus, setFocusState] = useState<{ id: string | null; tick: number }>({ id: null, tick: 0 });
  const [path, setPath] = useState<string[]>([]);
  const [sample, setSample] = useState<Sample>(props.sample ?? DEFAULT_SAMPLE);
  const [checked, setChecked] = useState<{ problems: Problem[]; graph: Graph } | null>(null);
  const [checking, setChecking] = useState<"idle" | "busy" | "clean" | "error">("idle");
  const [checkError, setCheckError] = useState("");

  // The latest graph, so two edits in one event compose rather than race.
  const latest = useRef(graph);
  latest.current = graph;
  const update = useCallback(
    (edit: (g: Graph) => Graph) => {
      if (readOnly || !onChange) return;
      const next = edit(latest.current);
      if (next === latest.current) return;
      latest.current = next;
      onChange(next);
    },
    [readOnly, onChange],
  );

  // Server problems belong to the graph they were found in.
  const serverProblems = useMemo(() => {
    const own = checked && checked.graph === graph ? checked.problems : [];
    return [...(props.serverProblems ?? []), ...own];
  }, [checked, graph, props.serverProblems]);
  const analysis = useMemo(() => analyse(graph, { trigger, serverProblems }), [graph, trigger, serverProblems]);

  // A selection whose node or edge has gone is no selection.
  useEffect(() => {
    if (selection?.kind === "node" && !graph.nodes.some((n) => n.id === selection.id)) setSelection(null);
    if (selection?.kind === "edge" && !graph.edges[selection.index]) setSelection(null);
  }, [graph, selection]);

  const editor: Editor = {
    graph,
    analysis,
    readOnly,
    update,
    selection,
    select: setSelection,
    focusId: focus.id,
    focusTick: focus.tick,
    setFocus: (id, move = false) => setFocusState((f) => ({ id, tick: move ? f.tick + 1 : f.tick })),
    path,
    setPath,
    inspectors: props.inspectors ?? {},
    unavailable: props.unavailable ?? {},
    sample,
    setSample,
    reducedMotion,
    triggerSummary: props.triggerSummary,
  };

  const check = async () => {
    if (!api?.validate) return;
    setChecking("busy");
    setCheckError("");
    const sent = graph;
    try {
      const problems = await api.validate(sent);
      setChecked({ problems, graph: sent });
      setChecking(problems.length ? "idle" : "clean");
      setPanel("problems");
    } catch (e) {
      setChecking("error");
      setCheckError((e as ApiError)?.message ?? String(e));
    }
  };

  const views = ["canvas", "list"];
  const panels: Panel[] = ["problems", "steps", "simulate"];
  const panelNames: Record<Panel, string> = {
    problems: analysis.problems.length ? `Problems (${analysis.problems.length})` : "Problems",
    steps: "Steps",
    simulate: "Simulate",
  };

  return (
    <EditorContext.Provider value={editor}>
      <section className="zwf" aria-label={label} data-readonly={readOnly ? "true" : undefined}>
        <div className="zwf-bar">
          <div role="tablist" aria-label="View" className="zwf-tabs">
            {views.map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                data-tab={v}
                id={`${uid}-tab-${v}`}
                aria-selected={view === v}
                aria-controls={`${uid}-view`}
                tabIndex={view === v ? 0 : -1}
                className="zwf-tab"
                onClick={() => setView(v as "canvas" | "list")}
                onKeyDown={(e) => tabKeys(e, views, view, (x) => setView(x as "canvas" | "list"))}
              >
                {v === "canvas" ? "Canvas" : "List"}
              </button>
            ))}
          </div>
          <div className="zwf-row zwf-bar-actions">
            {readOnly && <span className="zwf-status zwf-status-muted"><span className="zwf-dot" aria-hidden="true" />Read only</span>}
            {!readOnly && (
              <button type="button" className="zwf-button" onClick={() => update(layoutAll)}>
                Tidy the layout
              </button>
            )}
            {api?.validate && (
              <button type="button" className="zwf-button" onClick={check} disabled={checking === "busy"}>
                {checking === "busy" ? "Checking…" : "Check with the server"}
              </button>
            )}
            {checking === "clean" && checked?.graph === graph && (
              <span className="zwf-status zwf-status-ok">
                <span className="zwf-dot" aria-hidden="true" />
                The server finds no problems
              </span>
            )}
            {checking === "error" && (
              <span className="zwf-status zwf-status-danger">
                <span className="zwf-dot" aria-hidden="true" />
                {checkError}
              </span>
            )}
            {toolbar}
          </div>
        </div>

        <div className="zwf-body">
          <Palette />
          <div id={`${uid}-view`} role="tabpanel" aria-labelledby={`${uid}-tab-${view}`} className="zwf-view">
            {view === "canvas" ? <WorkflowCanvas /> : <ListView />}
          </div>
          <Inspector />
        </div>

        <div className="zwf-panels">
          <div role="tablist" aria-label="Panels" className="zwf-tabs">
            {panels.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                data-tab={p}
                id={`${uid}-ptab-${p}`}
                aria-selected={panel === p}
                aria-controls={`${uid}-panel-${p}`}
                tabIndex={panel === p ? 0 : -1}
                className="zwf-tab"
                onClick={() => setPanel(p)}
                onKeyDown={(e) => tabKeys(e, panels, panel, (x) => setPanel(x as Panel))}
              >
                {panelNames[p]}
              </button>
            ))}
          </div>
          {/* All three stay mounted: a simulation keeps its answers while the Steps are read. */}
          {panels.map((p) => (
            <div key={p} id={`${uid}-panel-${p}`} role="tabpanel" aria-labelledby={`${uid}-ptab-${p}`} className="zwf-panel" hidden={panel !== p}>
              {p === "problems" && <ProblemsPanel />}
              {p === "steps" && <StepsPanel savedSteps={savedSteps} />}
              {p === "simulate" && <SimulatePanel api={api} />}
            </div>
          ))}
        </div>
      </section>
    </EditorContext.Provider>
  );
}
