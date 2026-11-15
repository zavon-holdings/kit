// Moving a record between steps (contract/boardquery/moves/*.json). Moving
// is discouraged, so the rule is one pure function the board, the Move
// dialog and the server all answer the same way:
//
//   - backwards: never by drag; only through the Move dialog, with a reason,
//     and only by an admin — unless the stored rules say otherwise;
//   - forward past a step: asks for confirmation, naming the steps skipped;
//   - frequent moves: a warning, never a refusal.
//
// The thresholds are data (the server's stored move rules), never constants.

export type MoveRules = {
  back_needs_reason: boolean;
  back_admin_only: boolean;
  skip_needs_confirm: boolean;
  /** Moves already made within the window at which a further move warns; 0 is never. */
  frequent_moves: number;
  frequent_window_hours: number;
};

export type MoveInput = {
  from: string;
  to: string;
  admin: boolean;
  reason: string;
  confirm_skip: boolean;
  /** Moves of this record within the rules' window, before this one. */
  recent_moves: number;
};

export type MoveRefusal = "" | "unknown_stage" | "same_stage" | "move_back_forbidden" | "move_reason_required" | "skip_confirm_required";

export type MoveVerdict = {
  ok: boolean;
  direction: "" | "forward" | "back" | "same";
  /** The steps a forward move passes over, in order. */
  skipped: string[];
  refusal: MoveRefusal;
  warnings: "frequent_moves"[];
};

/** The verdict on one move across `columns` (the steps' codes, in order). */
export function moveVerdict(columns: readonly string[], rules: MoveRules, m: MoveInput): MoveVerdict {
  const warnings: "frequent_moves"[] = rules.frequent_moves > 0 && m.recent_moves >= rules.frequent_moves ? ["frequent_moves"] : [];
  const to = columns.indexOf(m.to);
  if (to < 0) return { ok: false, direction: "", skipped: [], refusal: "unknown_stage", warnings };
  const from = m.from ? columns.indexOf(m.from) : -1;
  if (from === to) return { ok: false, direction: "same", skipped: [], refusal: "same_stage", warnings };
  if (from > to) {
    if (rules.back_admin_only && !m.admin) return { ok: false, direction: "back", skipped: [], refusal: "move_back_forbidden", warnings };
    if (rules.back_needs_reason && !m.reason.trim()) return { ok: false, direction: "back", skipped: [], refusal: "move_reason_required", warnings };
    return { ok: true, direction: "back", skipped: [], refusal: "", warnings };
  }
  const skipped = from < 0 ? [] : columns.slice(from + 1, to);
  if (skipped.length && rules.skip_needs_confirm && !m.confirm_skip)
    return { ok: false, direction: "forward", skipped, refusal: "skip_confirm_required", warnings };
  return { ok: true, direction: "forward", skipped, refusal: "", warnings };
}

/** How a lane receives a dragged card: lit, lit after a confirmation, or refused with a reason code. */
export type DropVerdict = { state: "ok" | "confirm" | "no"; refusal: MoveRefusal | "back_by_drag" };

/**
 * A drag's verdict, decided before the drop: forward one step lands; a skip
 * lands through the confirmation; backwards is never by drag, whoever drags.
 */
export function dropVerdict(columns: readonly string[], rules: MoveRules, from: string, to: string, admin: boolean): DropVerdict {
  const v = moveVerdict(columns, rules, { from, to, admin, reason: "", confirm_skip: false, recent_moves: 0 });
  if (v.direction === "back") return { state: "no", refusal: "back_by_drag" };
  if (v.ok) return { state: "ok", refusal: "" };
  if (v.refusal === "skip_confirm_required") return { state: "confirm", refusal: v.refusal };
  return { state: "no", refusal: v.refusal };
}
