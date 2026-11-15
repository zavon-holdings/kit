// What a board draws. The host maps its own server's answer to these; the
// package names no service.

export type BoardCardData = {
  /** The record's id (a run's uid). */
  id: string;
  title: string;
  /** A reference or contact, in one muted line. */
  subtitle?: string;
  /** The step (column) it is in. */
  stage: string;
  state?: string;
  overdue?: boolean;
  dueSoon?: boolean;
  dueAt?: string;
  /** Labels of the details its step needs before it moves on. */
  missing?: string[];
  /** A move already booked for it. */
  scheduled?: { at: string; toName?: string };
  /** Moves of this record within the move rules' window. */
  recentMoves?: number;
  snoozedUntil?: string;
  /** A short muted line: who has it, when it arrived. */
  meta?: string;
};

export type ColumnFlags = { overdue?: number; dueSoon?: number; missing?: number; scheduled?: number };

export type BoardColumnData = {
  code: string;
  name: string;
  /** The server's true total under the filters, whatever is loaded. */
  total: number;
  owner?: string;
  /** What the step needs before a record moves on, in one sentence. */
  requirement?: string;
  /** How many of the lane's records each rule marks (over the whole lane). */
  flags?: ColumnFlags;
  cards: BoardCardData[];
  /** The cursor of the lane's next page; empty when it has no more. */
  next?: string | null;
};

export type ColumnPage = { cards: BoardCardData[]; next?: string | null; total: number };

/** One record's answer to a move. */
export type MoveOutcome = { id: string; title?: string; ok: boolean; code?: string; message?: string; warnings?: string[] };

export type MoveRequest = { ids: string[]; from: string; to: string; reason: string; confirmSkip: boolean };
