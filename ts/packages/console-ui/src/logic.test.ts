import { describe, expect, it } from "vitest";
import { dropVerdict, type MoveRules } from "./moves.js";
import { cardMarks, columnChips, ruleLine } from "./rules.js";
import { activeFilterCount, boardQueryOf, filtersDiffer, parseBoardUrl } from "./url.js";
import { DEFAULT_WORDS as w } from "./words.js";

const rules: MoveRules = { back_needs_reason: true, back_admin_only: true, skip_needs_confirm: true, frequent_moves: 3, frequent_window_hours: 24 };
const cols = ["a", "b", "c"];

describe("a drag, decided before the drop", () => {
  it("lands one step forward, confirms a skip, and never goes back — even for an admin", () => {
    expect(dropVerdict(cols, rules, "a", "b", false).state).toBe("ok");
    expect(dropVerdict(cols, rules, "a", "c", false)).toEqual({ state: "confirm", refusal: "skip_confirm_required" });
    expect(dropVerdict(cols, rules, "c", "a", true)).toEqual({ state: "no", refusal: "back_by_drag" });
    expect(dropVerdict(cols, { ...rules, back_admin_only: false, back_needs_reason: false }, "c", "b", false).state).toBe("no");
    expect(dropVerdict(cols, rules, "b", "b", false)).toEqual({ state: "no", refusal: "same_stage" });
  });
});

describe("rule chips", () => {
  it("marks a card most urgent first, and never Overdue with Due Soon", () => {
    const marks = cardMarks({ id: "1", title: "x", stage: "a", overdue: true, dueSoon: true, missing: ["Survey Date"], scheduled: { at: "2026-11-20" } }, w);
    expect(marks.map((m) => m.key)).toEqual(["overdue", "missing", "scheduled"]);
    expect(marks[1].label).toBe("Needs 1 Detail");
  });
  it("counts a column over the whole lane and leaves zeros out", () => {
    expect(columnChips({ overdue: 2, missing: 0, dueSoon: 5 }, w).map((m) => m.label)).toEqual(["2 Overdue", "5 Due Soon"]);
    expect(columnChips(undefined, w)).toEqual([]);
  });
  it("gives the record one line, as a sentence", () => {
    expect(ruleLine({ id: "1", title: "x", stage: "a", missing: ["Survey Date", "System Size"] }, "Design", w)?.text).toBe(
      "Design needs Survey Date and System Size before this record moves on.",
    );
    expect(ruleLine({ id: "1", title: "x", stage: "a" }, "Design", w)).toBeNull();
  });
});

describe("the URL state", () => {
  it("asks the server only for the filters, and knows when they changed", () => {
    const a = parseBoardUrl("?wf=x&v=list&only=overdue&q=van");
    expect(boardQueryOf(a)).toEqual({ only: "overdue", q: "van" });
    expect(filtersDiffer(a, { ...a, view: "board", wf: "y" })).toBe(false);
    expect(filtersDiffer(a, { ...a, only: [] })).toBe(true);
    expect(activeFilterCount(parseBoardUrl("?only=overdue,flagged&assignee=me&tests=1"))).toBe(4);
  });
});
