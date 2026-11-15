// A step's rules where staff already work: a marker on the card, a chip on
// the column, one line on the record. Each reads facts the server already
// keeps (required details, the deadline, a booked move); an ordinary move
// resolves them. Ordered by what needs a person first.

import type { BoardCardData, ColumnFlags } from "./types.js";
import type { BoardWords } from "./words.js";

export type RuleTone = "danger" | "warn" | "info";

export type RuleMark = { key: "overdue" | "missing" | "due_soon" | "scheduled"; tone: RuleTone; label: string };

/** A card's marks, most urgent first. Overdue and Due Soon never both. */
export function cardMarks(card: BoardCardData, w: BoardWords): RuleMark[] {
  const out: RuleMark[] = [];
  if (card.overdue) out.push({ key: "overdue", tone: "danger", label: w.overdue });
  if (card.missing?.length) out.push({ key: "missing", tone: "warn", label: w.needsDetails(card.missing.length) });
  if (!card.overdue && card.dueSoon) out.push({ key: "due_soon", tone: "warn", label: w.dueSoon });
  if (card.scheduled) out.push({ key: "scheduled", tone: "info", label: w.moveBooked });
  return out;
}

/** A column's chips: how many of the whole lane each rule marks. Zero is no chip. */
export function columnChips(flags: ColumnFlags | undefined, w: BoardWords): RuleMark[] {
  if (!flags) return [];
  const out: RuleMark[] = [];
  if (flags.overdue) out.push({ key: "overdue", tone: "danger", label: w.columnOverdue(flags.overdue) });
  if (flags.missing) out.push({ key: "missing", tone: "warn", label: w.columnNeedsDetails(flags.missing) });
  if (flags.dueSoon) out.push({ key: "due_soon", tone: "warn", label: w.columnDueSoon(flags.dueSoon) });
  if (flags.scheduled) out.push({ key: "scheduled", tone: "info", label: w.columnMoveBooked(flags.scheduled) });
  return out;
}

/** The one line on the record: the most urgent rule, as a sentence. Empty when nothing applies. */
export function ruleLine(card: BoardCardData, stageName: string, w: BoardWords, formatDate: (iso: string) => string = (s) => s): { tone: RuleTone; text: string } | null {
  if (card.missing?.length) return { tone: "warn", text: w.ruleLine.missing(stageName, card.missing) };
  if (card.overdue) return { tone: "danger", text: w.ruleLine.overdue(stageName) };
  if (card.scheduled) return { tone: "info", text: w.ruleLine.scheduled(formatDate(card.scheduled.at), card.scheduled.toName) };
  if (card.dueSoon) return { tone: "warn", text: w.ruleLine.dueSoon(stageName) };
  return null;
}
