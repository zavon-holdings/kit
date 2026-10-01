"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { analyse } from "../analysis.js";
import { copyNodes, parseFragment, pasteFragment, type Fragment } from "../clipboard.js";
import { emptyHistory, record, redo as redoHistory, undo as undoHistory, type History } from "../history.js";
import { moveNodes, removeNodes, GRID } from "../arrange.js";
import { addNote } from "../model.js";
import { positions } from "../layout.js";
import { isTyping, shortcutFor } from "../shortcuts.js";
import type { ApiError, Graph, Inspectors, Problem, Sample, Selection, Step, WorkflowApi } from "../types.js";
import type { CatalogueEvent, Interrupt, Trigger } from "../trigger.js";
import { EditorContext, useReducedMotion, type Editor, type TriggerEditor } from "./context.js";
import { ExportMenu } from "./ExportMenu.js";
import { FindNode } from "./FindNode.js";
import { Inspector } from "./Inspector.js";
import { ListView } from "./ListView.js";
import { Palette } from "./Palette.js";
import { ProblemsPanel } from "./ProblemsPanel.js";
import { ScenariosPanel } from "./ScenariosPanel.js";
import { ShortcutsSheet } from "./ShortcutsSheet.js";
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
  /**
   * The definition's trigger, editable from the start node when the host
   * passes onTriggerChange. The trigger is the definition's, not the graph's:
   * the host saves it beside the graph.
   */
  triggerValue?: Trigger;
  onTriggerChange?: (t: Trigger) => void;
  /** Events a trigger or an interrupt can name, from the host's catalogue. */
  events?: CatalogueEvent[];
  /** Definition-level interrupts: an event about the subject sends an open run elsewhere. */
  interrupts?: Interrupt[];
  onInterruptsChange?: (list: Interrupt[]) => void;
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
  /** The workflow's name, for exported files and the printed page. */
  title?: string;
  /** The level the editor's headings start at, under the host's own (default 2). */
  headingLevel?: number;
};

const DEFAULT_SAMPLE: Sample = { subject: { type: "person", pid: "sample-1" }, vars: {} };

type Panel = "problems" | "steps" | "simulate" | "scenarios";

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");

function tabKeys(e: KeyboardEvent<HTMLButtonElement>, ids: string[], current: string, set: (id: string) => void) {
  const at = ids.indexOf(current);
  const to = e.key === "ArrowRight" ? ids[(at + 1) % ids.length] : e.key === "ArrowLeft" ? ids[(at - 1 + ids.length) % ids.length] : null;
  if (!to) return;
  e.preventDefault();
  set(to);
  (e.currentTarget.parentElement?.querySelector(`[data-tab="${to}"]`) as HTMLElement | null)?.focus();
}

/** The ids a selection holds. */
export function selectedIds(s: Selection): string[] {
  if (!s) return [];
  if (s.kind === "node") return [s.id];
  if (s.kind === "nodes") return s.ids;
  return [];
}

/**
 * The whole editor: the canvas or its List twin, the palette, the inspector,
 * and the Problems, Steps, Simulate and Scenarios panels. Controlled: the host
 * holds the graph and saves it; the editor only ever proposes the next graph.
 * Undo, redo, copy and paste live here, as history of the graphs proposed.
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
  const [history, setHistory] = useState<History<Graph>>(emptyHistory);
  const [clip, setClip] = useState<Fragment | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [minimap, setMinimap] = useState(graph.nodes.length >= 30);
  const [sheet, setSheet] = useState(false);
  const [said, setSaid] = useState("");
  const [scenariosTick, setScenariosTick] = useState(0);
  const findRef = useRef<HTMLInputElement>(null);

  // The latest graph, so two edits in one event compose rather than race.
  const latest = useRef(graph);
  latest.current = graph;
  const historyRef = useRef(history);
  historyRef.current = history;

  const update = useCallback(
    (edit: (g: Graph) => Graph, options?: { coalesce?: string }) => {
      if (readOnly || !onChange) return;
      const before = latest.current;
      const next = edit(before);
      if (next === before) return;
      latest.current = next;
      const h = record(historyRef.current, before, options?.coalesce, Date.now());
      historyRef.current = h;
      setHistory(h);
      onChange(next);
    },
    [readOnly, onChange],
  );

  const undo = useCallback(() => {
    if (readOnly || !onChange) return;
    const u = undoHistory(historyRef.current, latest.current);
    if (!u) return;
    historyRef.current = u.history;
    setHistory(u.history);
    latest.current = u.value;
    onChange(u.value);
    setSaid("Undone.");
  }, [readOnly, onChange]);

  const redo = useCallback(() => {
    if (readOnly || !onChange) return;
    const r = redoHistory(historyRef.current, latest.current);
    if (!r) return;
    historyRef.current = r.history;
    setHistory(r.history);
    latest.current = r.value;
    onChange(r.value);
    setSaid("Redone.");
  }, [readOnly, onChange]);

  // Server problems belong to the graph they were found in.
  const serverProblems = useMemo(() => {
    const own = checked && checked.graph === graph ? checked.problems : [];
    return [...(props.serverProblems ?? []), ...own];
  }, [checked, graph, props.serverProblems]);
  const analysis = useMemo(() => analyse(graph, { trigger, serverProblems }), [graph, trigger, serverProblems]);

  // A selection whose nodes or edge have gone is narrowed to what is left.
  useEffect(() => {
    if (selection?.kind === "node" && !graph.nodes.some((n) => n.id === selection.id)) setSelection(null);
    if (selection?.kind === "edge" && !graph.edges[selection.index]) setSelection(null);
    if (selection?.kind === "nodes") {
      const left = selection.ids.filter((id) => graph.nodes.some((n) => n.id === id));
      if (left.length !== selection.ids.length) setSelection(left.length === 0 ? null : left.length === 1 ? { kind: "node", id: left[0] } : { kind: "nodes", ids: left });
    }
  }, [graph, selection]);

  const ids = selectedIds(selection);
  const setFocus = useCallback((id: string, move = false) => setFocusState((f) => ({ id, tick: move ? f.tick + 1 : f.tick })), []);

  const copy = useCallback(
    (which?: string[]) => {
      const chosen = which ?? selectedIds(selection);
      if (chosen.length === 0) return null;
      const f = copyNodes(latest.current, chosen);
      if (f.nodes.length === 0) return null;
      setClip(f);
      setSaid(`Copied ${f.nodes.length} node${f.nodes.length === 1 ? "" : "s"}.`);
      return f;
    },
    [selection],
  );

  const pasteFrom = useCallback(
    (f: Fragment | null) => {
      if (!f || readOnly) return;
      let pasted: string[] = [];
      update((g) => {
        const out = pasteFragment(g, f);
        pasted = out.ids;
        return out.graph;
      });
      if (pasted.length === 1) setSelection({ kind: "node", id: pasted[0] });
      else if (pasted.length > 1) setSelection({ kind: "nodes", ids: pasted });
      if (pasted.length) {
        setFocus(pasted[0]);
        setSaid(`Pasted ${pasted.length} node${pasted.length === 1 ? "" : "s"}; nothing connects to ${pasted.length === 1 ? "it" : "them"} yet.`);
      }
    },
    [readOnly, update, setFocus],
  );

  const removeSelected = useCallback(() => {
    if (readOnly || ids.length === 0) return;
    const removable = ids.filter((id) => graph.nodes.find((n) => n.id === id)?.type !== "start");
    if (removable.length === 0) return;
    update((g) => removeNodes(g, removable));
    setSelection(null);
    setSaid(`Removed ${removable.length} node${removable.length === 1 ? "" : "s"}.`);
  }, [readOnly, ids, graph, update]);

  const reveal = useCallback(
    (id: string) => {
      setSelection({ kind: "node", id });
      setFocus(id, true);
    },
    [setFocus],
  );

  const triggerEditor: TriggerEditor | undefined = props.triggerValue
    ? {
        value: props.triggerValue,
        onChange: readOnly ? undefined : props.onTriggerChange,
        events: props.events,
        interrupts: props.interrupts,
        onInterruptsChange: readOnly ? undefined : props.onInterruptsChange,
      }
    : undefined;

  const editor: Editor = {
    graph,
    analysis,
    readOnly,
    update,
    selection,
    select: setSelection,
    selectedIds: ids,
    reveal,
    copy: (which) => void copy(which),
    paste: () => pasteFrom(clip),
    canPaste: !!clip,
    focusId: focus.id,
    focusTick: focus.tick,
    setFocus,
    path,
    setPath,
    inspectors: props.inspectors ?? {},
    unavailable: props.unavailable ?? {},
    sample,
    setSample,
    reducedMotion,
    triggerSummary: props.triggerSummary,
    api,
    headingLevel: props.headingLevel ?? 2,
    scenariosTick,
    bumpScenarios: () => setScenariosTick((t) => t + 1),
    snapToGrid,
    minimap,
    triggerEditor,
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

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || isTyping(e.target) || sheet) return;
    const action = shortcutFor(e, isMac());
    if (!action) return;
    const nudge = (dx: number, dy: number) => {
      if (readOnly || ids.length === 0) return;
      e.preventDefault();
      update((g) => moveNodes(g, ids, dx, dy), { coalesce: `nudge:${ids.join(",")}` });
    };
    switch (action) {
      case "undo":
        e.preventDefault();
        undo();
        return;
      case "redo":
        e.preventDefault();
        redo();
        return;
      case "duplicate": {
        e.preventDefault();
        if (readOnly) return;
        pasteFrom(copy());
        return;
      }
      case "remove":
        if (ids.length === 0) return;
        e.preventDefault();
        removeSelected();
        return;
      case "select-all":
        e.preventDefault();
        setSelection({ kind: "nodes", ids: graph.nodes.map((n) => n.id) });
        setSaid(`Selected all ${graph.nodes.length} nodes.`);
        return;
      case "clear-selection":
        if (sheet) return;
        setSelection(null);
        return;
      case "find":
        e.preventDefault();
        findRef.current?.focus();
        return;
      case "shortcuts":
        e.preventDefault();
        setSheet(true);
        return;
      case "nudge-left":
        return nudge(-GRID, 0);
      case "nudge-right":
        return nudge(GRID, 0);
      case "nudge-up":
        return nudge(0, -GRID);
      case "nudge-down":
        return nudge(0, GRID);
      // copy, cut and paste arrive as clipboard events, where the system clipboard can be read and written.
    }
  };

  const onCopy = (e: ClipboardEvent<HTMLElement>, cut = false) => {
    if (isTyping(e.target) || ids.length === 0) return;
    const f = copy();
    if (!f) return;
    e.preventDefault();
    e.clipboardData?.setData("text/plain", JSON.stringify(f));
    if (cut) removeSelected();
  };
  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    if (isTyping(e.target) || readOnly) return;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    const f = (text && parseFragment(text)) || clip;
    if (!f) return;
    e.preventDefault();
    pasteFrom(f);
  };

  const views = ["canvas", "list"];
  const scenarios = !!(api?.listScenarios || api?.saveScenario);
  const panels: Panel[] = scenarios ? ["problems", "steps", "simulate", "scenarios"] : ["problems", "steps", "simulate"];
  const panelNames: Record<Panel, string> = {
    problems: analysis.problems.length ? `Problems (${analysis.problems.length})` : "Problems",
    steps: "Steps",
    simulate: "Simulate",
    scenarios: "Scenarios",
  };

  return (
    <EditorContext.Provider value={editor}>
      <section
        className="zwf"
        aria-label={label}
        data-readonly={readOnly ? "true" : undefined}
        onKeyDown={onKeyDown}
        onCopy={(e) => onCopy(e)}
        onCut={(e) => !readOnly && onCopy(e, true)}
        onPaste={onPaste}
      >
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
          <FindNode inputRef={findRef} />
          <div className="zwf-row zwf-bar-actions">
            {readOnly && (
              <span className="zwf-status zwf-status-muted">
                <span className="zwf-dot" aria-hidden="true" />
                Read only
              </span>
            )}
            {!readOnly && (
              <>
                <button type="button" className="zwf-button" onClick={undo} disabled={history.past.length === 0} aria-keyshortcuts="Control+Z Meta+Z">
                  Undo
                </button>
                <button type="button" className="zwf-button" onClick={redo} disabled={history.future.length === 0} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z">
                  Redo
                </button>
                <button type="button" className="zwf-button" onClick={() => update(layoutAll)}>
                  Tidy the layout
                </button>
                <button
                  type="button"
                  className="zwf-button"
                  onClick={() => {
                    const about = ids.length === 1 ? ids[0] : undefined;
                    update((g) => {
                      const at = positions(g);
                      const p = about ? at[about] : undefined;
                      const xs = Object.values(at).map((q) => q.x);
                      const spot = p ? { x: p.x + 220, y: p.y } : { x: (xs.length ? Math.max(...xs) : 0) + 260, y: 0 };
                      return addNote(g, spot, "", about).graph;
                    });
                    setSaid(about ? "Added a note beside the selected node." : "Added a note.");
                  }}
                >
                  Add a note
                </button>
              </>
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
            <ExportMenu title={props.title ?? label} onImport={readOnly ? undefined : (g) => update(() => g)} />
            <details className="zwf-menu">
              <summary className="zwf-button">View</summary>
              <div className="zwf-menu-body">
                <label className="zwf-check">
                  <input type="checkbox" checked={snapToGrid} onChange={(e) => setSnapToGrid(e.target.checked)} />
                  <span>Snap to the grid</span>
                </label>
                <label className="zwf-check">
                  <input type="checkbox" checked={minimap} onChange={(e) => setMinimap(e.target.checked)} />
                  <span>Overview map</span>
                </label>
              </div>
            </details>
            <button type="button" className="zwf-button zwf-quiet" onClick={() => setSheet(true)} aria-keyshortcuts="Shift+?">
              Keyboard shortcuts
            </button>
            {toolbar}
          </div>
        </div>
        <p className="zwf-visually-hidden" role="status" aria-live="polite">
          {said}
        </p>

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
          {/* All stay mounted: a simulation keeps its answers while the Steps are read. */}
          {panels.map((p) => (
            <div key={p} id={`${uid}-panel-${p}`} role="tabpanel" aria-labelledby={`${uid}-ptab-${p}`} className="zwf-panel" hidden={panel !== p}>
              {p === "problems" && <ProblemsPanel />}
              {p === "steps" && <StepsPanel savedSteps={savedSteps} />}
              {p === "simulate" && <SimulatePanel api={api} />}
              {p === "scenarios" && <ScenariosPanel api={api} />}
            </div>
          ))}
        </div>
        {sheet && <ShortcutsSheet mac={isMac()} onClose={() => setSheet(false)} />}
      </section>
    </EditorContext.Provider>
  );
}
