"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Analysis } from "../analysis.js";
import type { Graph, Inspectors, Sample, Selection, WorkflowApi } from "../types.js";
import type { CatalogueEvent, Interrupt, Trigger } from "../trigger.js";

/** What every part of the editor shares. One graph, one analysis, one selection. */
export type Editor = {
  graph: Graph;
  analysis: Analysis;
  readOnly: boolean;
  /**
   * Applies an edit. A read-only editor ignores it. Edits sharing a
   * `coalesce` key in quick succession are one step of undo (typing).
   */
  update: (edit: (g: Graph) => Graph, options?: { coalesce?: string }) => void;
  selection: Selection;
  select: (s: Selection) => void;
  /** The node ids selected: one, several, or none. */
  selectedIds: string[];
  /** Selects a node, moves keyboard focus to it and brings it into view. */
  reveal: (id: string) => void;
  /** Copies nodes (the selection when none are named) to the editor's clipboard. */
  copy: (ids?: string[]) => void;
  /** Pastes what was copied, beside where it came from. */
  paste: () => void;
  /** Whether something has been copied. */
  canPaste: boolean;
  /** The node that holds the tab stop in the canvas and the list (roving tabindex). */
  focusId: string | null;
  /** Moves the tab stop, and with `move` moves keyboard focus there too. */
  setFocus: (id: string, move?: boolean) => void;
  focusTick: number;
  /** The simulated path, node ids in order. */
  path: string[];
  setPath: (path: string[]) => void;
  inspectors: Inspectors;
  unavailable: Record<string, string>;
  sample: Sample;
  setSample: (s: Sample) => void;
  reducedMotion: boolean;
  /** Read-only words about the definition's trigger, for the start node. */
  triggerSummary?: string;
  /** The host's api, for panels that ask the server (assignee preview). */
  api?: WorkflowApi;
  /** Words to show on nodes (a version comparison's "added"). */
  marks?: Record<string, string>;
  /** Bumped when a scenario is saved, so the Scenarios panel reloads. */
  scenariosTick: number;
  bumpScenarios: () => void;
  /** The level of the editor's own headings (sub-headings are one deeper). */
  headingLevel: number;
  /** Canvas preferences. */
  snapToGrid: boolean;
  minimap: boolean;
  /** The definition's trigger, when the host lets the editor change it. */
  triggerEditor?: TriggerEditor;
};

/** What the start node's inspector edits when the host hands the trigger in. */
export type TriggerEditor = {
  value: Trigger;
  onChange?: (t: Trigger) => void;
  events?: CatalogueEvent[];
  interrupts?: Interrupt[];
  onInterruptsChange?: (list: Interrupt[]) => void;
};

export const EditorContext = createContext<Editor | null>(null);

export function useEditor(): Editor {
  const e = useContext(EditorContext);
  if (!e) throw new Error("a workflow-ui part was rendered outside <WorkflowBuilder>");
  return e;
}

/** Whether the person asked for less motion. Pans and zooms then jump. */
export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/** The node's display name: its name, or its id. */
export const nameOf = (graph: Graph, id: string) => {
  const n = graph.nodes.find((x) => x.id === id);
  if (n?.name && n.name.trim()) return n.name.trim();
  return n?.type === "start" ? "Start" : id;
};
