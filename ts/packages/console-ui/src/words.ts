// The board's words. Titles, buttons and labels are formal Title Case;
// helper lines are sentences. A host passes its own nomenclature ("Application"
// for "Record") and any wording it prefers.

export type BoardWords = {
  record: string;
  records: string;
  board: string;
  list: string;
  move: string;
  moveTitle: string;
  moveTo: string;
  nextStage: string;
  earlierStage: string;
  laterStage: string;
  currentStage: string;
  reason: string;
  reasonHint: string;
  confirmSkip: (steps: string[]) => string;
  frequentWarning: (n: number, hours: number) => string;
  adminOnlyBack: string;
  backByDrag: string;
  cancel: string;
  close: string;
  select: string;
  selectAll: (n: number) => string;
  selected: (n: number) => string;
  moveSelected: (n: number) => string;
  bulkTitle: (column: string) => string;
  bulkConfirm: (n: number, to: string) => string;
  bulkProgress: (done: number, n: number) => string;
  bulkResult: (moved: number, refused: number) => string;
  more: (n: number) => string;
  moreFallback: string;
  empty: string;
  loading: string;
  loadFailed: string;
  tryAgain: string;
  overdue: string;
  dueSoon: string;
  needsDetails: (n: number) => string;
  moveBooked: string;
  columnOverdue: (n: number) => string;
  columnDueSoon: (n: number) => string;
  columnNeedsDetails: (n: number) => string;
  columnMoveBooked: (n: number) => string;
  ruleLine: {
    missing: (stage: string, fields: string[]) => string;
    overdue: (stage: string) => string;
    dueSoon: (stage: string) => string;
    scheduled: (at: string, to?: string) => string;
  };
  refusals: Record<string, string>;
  listColumns: { record: string; stage: string; marks: string };
  pager: (from: number, to: number, total: number) => string;
  previous: string;
  next: string;
};

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export const DEFAULT_WORDS: BoardWords = {
  record: "Record",
  records: "Records",
  board: "Board",
  list: "List",
  move: "Move",
  moveTitle: "Move Record",
  moveTo: "Move To",
  nextStage: "Next Stage",
  earlierStage: "Earlier Stage",
  laterStage: "Later Stage",
  currentStage: "Current Stage",
  reason: "Reason",
  reasonHint: "Moving back is recorded on the record with this reason.",
  confirmSkip: (steps) => `Skip ${list(steps)}`,
  frequentWarning: (n, hours) => `This record has moved ${n} ${n === 1 ? "time" : "times"} in the past ${hours} hours.`,
  adminOnlyBack: "Only an admin can move a record back.",
  backByDrag: "A record moves back only through Move, with a reason.",
  cancel: "Cancel",
  close: "Close",
  select: "Select",
  selectAll: (n) => `Select All ${n.toLocaleString("en-ZA")}`,
  selected: (n) => `${n.toLocaleString("en-ZA")} Selected`,
  moveSelected: (n) => `Move ${n.toLocaleString("en-ZA")}`,
  bulkTitle: (column) => `Move From ${column}`,
  bulkConfirm: (n, to) => `Move ${n.toLocaleString("en-ZA")} to ${to}`,
  bulkProgress: (done, n) => `Moved ${done.toLocaleString("en-ZA")} of ${n.toLocaleString("en-ZA")}`,
  bulkResult: (moved, refused) =>
    refused ? `${moved.toLocaleString("en-ZA")} Moved, ${refused.toLocaleString("en-ZA")} Not Moved` : `${moved.toLocaleString("en-ZA")} Moved`,
  more: (n) => `${n.toLocaleString("en-ZA")} more`,
  moreFallback: "More",
  empty: "No Records",
  loading: "Loading",
  loadFailed: "The next records did not load.",
  tryAgain: "Try Again",
  overdue: "Overdue",
  dueSoon: "Due Soon",
  needsDetails: (n) => (n === 1 ? "Needs 1 Detail" : `Needs ${n} Details`),
  moveBooked: "Move Booked",
  columnOverdue: (n) => `${n} Overdue`,
  columnDueSoon: (n) => `${n} Due Soon`,
  columnNeedsDetails: (n) => `${n} Need Details`,
  columnMoveBooked: (n) => `${n} Booked`,
  ruleLine: {
    missing: (stage, fields) => `${stage} needs ${list(fields)} before this record moves on.`,
    overdue: (stage) => `${stage} is past its deadline.`,
    dueSoon: (stage) => `${stage} is due soon.`,
    scheduled: (at, to) => (to ? `A move to ${to} is booked for ${at}.` : `A move is booked for ${at}.`),
  },
  refusals: {
    unknown_stage: "That step is not on this workflow.",
    same_stage: "The record is already in that step.",
    move_back_forbidden: "Only an admin can move a record back.",
    move_reason_required: "Give a reason for moving the record back.",
    skip_confirm_required: "Confirm the steps this move skips.",
    back_by_drag: "A record moves back only through Move, with a reason.",
  },
  listColumns: { record: "Record", stage: "Stage", marks: "Marks" },
  pager: (from, to, total) => `${from.toLocaleString("en-ZA")}–${to.toLocaleString("en-ZA")} of ${total.toLocaleString("en-ZA")}`,
  previous: "Previous",
  next: "Next",
};

export function wordsWith(over?: Partial<BoardWords>): BoardWords {
  return { ...DEFAULT_WORDS, ...over, ruleLine: { ...DEFAULT_WORDS.ruleLine, ...over?.ruleLine }, refusals: { ...DEFAULT_WORDS.refusals, ...over?.refusals } };
}
