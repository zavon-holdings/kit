// @zavon/workflow-ui: a workflow decision-tree editor for React.
//
// The editor is controlled: the host holds the graph, saves it, and passes
// an `api` for the server's check and simulation. The package holds no fetch
// code and names no service.
export { WorkflowBuilder, selectedIds, type WorkflowBuilderProps } from "./components/WorkflowBuilder.js";
export { WorkflowCanvas, layoutAll } from "./components/WorkflowCanvas.js";
export { ListView } from "./components/ListView.js";
export { Inspector } from "./components/Inspector.js";
export { Palette } from "./components/Palette.js";
export { StepsPanel } from "./components/StepsPanel.js";
export { SimulatePanel } from "./components/SimulatePanel.js";
export { ProblemsPanel } from "./components/ProblemsPanel.js";
export { ConditionBuilder, readCondition, type ConditionBuilderProps } from "./components/ConditionBuilder.js";
export {
  JsonInspector,
  ConditionInspector,
  JoinInspector,
  EndInspector,
  LoopInspector,
  SubWorkflowInspector,
  MoneyInspector,
  TodoInspector,
  BUILT_IN_INSPECTORS,
} from "./components/inspectors.js";
export { Heading } from "./components/Heading.js";
export { EditorContext, useEditor, useReducedMotion, type Editor, type TriggerEditor } from "./components/context.js";
export { TriggerPanel, InterruptsPanel, type TriggerPanelProps, type InterruptsPanelProps } from "./components/TriggerPanel.js";
export { AssigneePreview, ASKS_PEOPLE } from "./components/AssigneePreview.js";
export { VersionDiff, GraphView, type GraphViewProps, type VersionSide } from "./components/VersionDiff.js";
export { ScenariosPanel } from "./components/ScenariosPanel.js";
export { ShortcutsSheet } from "./components/ShortcutsSheet.js";
export { ExportMenu } from "./components/ExportMenu.js";
export { FindNode } from "./components/FindNode.js";
export * from "./history.js";
export * from "./clipboard.js";
export * from "./arrange.js";
export * from "./search.js";
export * from "./exporting.js";
export * from "./diff.js";
export * from "./shortcuts.js";
export * from "./trigger.js";
export * from "./scenarios.js";
export { STARTERS, type Starter } from "./starters.js";
export * from "./model.js";
export { autoLayout, positions, backEdges, LAYOUT } from "./layout.js";
export { analyse, edgeKey, problemCount, type Analysis } from "./analysis.js";
export {
  NODE_KINDS,
  PALETTE_GROUPS,
  FIXED_OUTCOMES,
  FALLBACK_OUTCOME,
  kindOf,
  typeLabel,
  edgeRole,
  chooses,
  isTask,
  isMoney,
  type NodeKind,
  type NodeGroup,
  type EdgeRole,
} from "./catalogue.js";
export { toRows, fromRows, parseValue, valueText, type Row, type Rows } from "./conditionRows.js";
export { fieldSuggestions } from "./fields.js";
export { nextFocus } from "./nav.js";
export type * from "./types.js";
