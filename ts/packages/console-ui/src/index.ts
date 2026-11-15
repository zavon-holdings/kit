// @zavon/console-ui: the console's shared screens for running workflows.
//
// A board (`Board`) draws one workflow: steps as fitted lanes, records as
// cards, ten a lane and the next ten on scroll, each lane with its own
// keyset cursor and the server's true total. `BoardList` is the same board
// as a list, `ViewToggle` switches the two, and the board's state lives in
// the URL (`parseBoardUrl`, `writeBoardUrl`). `MoveDialog` and
// `BulkMoveDialog` move records under `moveVerdict`, the one rule the
// server also answers. It names no service: the host passes its own fetches
// and words. Import the stylesheet once:
//
//   import "@zavon/console-ui/styles.css";
export { Board, type BoardProps } from "./Board.js";
export { BoardList, ViewToggle, type BoardListProps } from "./BoardList.js";
export { MoveDialog, type MoveDialogProps } from "./MoveDialog.js";
export { BulkMoveDialog, type BulkMoveDialogProps, type BulkSelection } from "./BulkMoveDialog.js";
export { LaneMore } from "./LaneMore.js";
export { Modal } from "./Modal.js";
export { RuleChip, RuleChips, RuleLine } from "./RuleChips.js";
export { useFillHeight } from "./useFillHeight.js";
export { useLaneOverflow } from "./useLaneOverflow.js";
export * from "./moves.js";
export * from "./pages.js";
export * from "./query.js";
export * from "./rules.js";
export * from "./types.js";
export * from "./url.js";
export * from "./words.js";
