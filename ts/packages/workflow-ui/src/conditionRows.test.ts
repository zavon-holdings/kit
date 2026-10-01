import { describe, expect, test } from "vitest";
import { fromRows, parseValue, toRows, valueText } from "./conditionRows.js";

describe("conditions as rows", () => {
  test("nothing is no rows, and no rows is the empty condition", () => {
    expect(toRows(undefined)).toEqual({ join: "all", rows: [] });
    expect(toRows({})).toEqual({ join: "all", rows: [] });
    expect(fromRows({ join: "all", rows: [] })).toEqual({});
  });
  test("one rule round-trips as a bare leaf", () => {
    const when = { field: "vars.amount", op: "gte", value: 1000 };
    const rows = toRows(when)!;
    expect(rows).toEqual({ join: "all", rows: [{ field: "vars.amount", op: "gte", value: "1000" }] });
    expect(fromRows(rows)).toEqual(when);
  });
  test("all and any round-trip; a bare list reads as all", () => {
    const any = { any: [{ field: "vars.a", op: "is", value: "x" }, { field: "vars.b", op: "exists" }] };
    expect(fromRows(toRows(any)!)).toEqual(any);
    expect(toRows([{ field: "vars.a", value: 1 }])).toEqual({ join: "all", rows: [{ field: "vars.a", op: "is", value: "1" }] });
  });
  test("not, nesting and unknown keys are not rows", () => {
    expect(toRows({ not: { field: "vars.a" } })).toBeNull();
    expect(toRows({ all: [{ any: [] }] })).toBeNull();
    expect(toRows({ field: "vars.a", op: "is", value: 1, extra: true })).toBeNull();
  });
  test("values keep their type: numbers, booleans, quoted text, lists", () => {
    expect(parseValue("12", "is")).toBe(12);
    expect(parseValue("true", "is")).toBe(true);
    expect(parseValue('"12"', "is")).toBe("12");
    expect(parseValue("gold", "is")).toBe("gold");
    expect(parseValue("a, 2, b", "in")).toEqual(["a", 2, "b"]);
    expect(valueText("12")).toBe('"12"');
    expect(valueText("gold")).toBe("gold");
    expect(valueText(["a", 2], "in")).toBe("a, 2");
    for (const v of ["12", 12, true, "gold", null]) expect(parseValue(valueText(v), "is")).toEqual(v);
  });
});
