import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIELDS_REQUIRED,
  SNOOZE_PRESETS,
  blockedMessage,
  filterSnoozed,
  isFilled,
  isSnoozed,
  loadShowSnoozed,
  missingFields,
  parseFieldsRequired,
  requirementSentence,
  resolveSnooze,
  saveShowSnoozed,
  snoozeLabel,
  snoozedToggleLabel,
} from "./index.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "contract", "stepgates");
const vector = (name) => JSON.parse(readFileSync(join(dir, name), "utf8"));

test("rule vectors", () => {
  const v = vector("rule.json");
  const byCode = Object.fromEntries(v.stages.map((s) => [s.code, s]));
  for (const c of v.cases) {
    assert.deepEqual(missingFields(byCode[c.from], byCode[c.to], c.filled, v.catalogue), c.missing, c.name);
    // The three ways of naming what is filled agree.
    assert.deepEqual(missingFields(byCode[c.from], byCode[c.to], new Set(c.filled), v.catalogue), c.missing, c.name);
    assert.deepEqual(missingFields(byCode[c.from], byCode[c.to], (k) => c.filled.includes(k), v.catalogue), c.missing, c.name);
  }
});

test("no stage on either side is not a move", () => {
  assert.deepEqual(missingFields(undefined, { order: 2 }, []), []);
  assert.deepEqual(missingFields({ order: 1, required: ["a"] }, null, []), []);
});

test("filled vectors", () => {
  for (const c of vector("filled.json").cases) assert.equal(isFilled(c.value), c.filled, c.name);
});

test("sentence vectors", () => {
  for (const c of vector("sentences.json").cases) {
    assert.equal(requirementSentence(c.stage, c.labels), c.requirement);
    assert.equal(blockedMessage(c.stage, c.labels), c.blocked);
  }
});

test("the 422 body is read, and anything else is not", () => {
  const v = vector("error.json");
  const got = parseFieldsRequired(v.status, v.body);
  assert.equal(v.body.code, FIELDS_REQUIRED);
  assert.deepEqual(got, { stage: v.body.stage, fields: v.body.fields, labels: v.body.labels, message: v.body.message });
  assert.equal(blockedMessage("Review", v.body.fields.map((f) => v.body.labels[f])), v.body.message);
  assert.equal(parseFieldsRequired(400, v.body), null);
  assert.equal(parseFieldsRequired(422, { code: "other", fields: [] }), null);
  assert.equal(parseFieldsRequired(422, null), null);
  // An app that wraps errors as {error: {...}} is read too.
  assert.deepEqual(parseFieldsRequired(422, { error: v.body })?.fields, v.body.fields);
});

test("snooze vectors", () => {
  const v = vector("snooze.json");
  const now = new Date(v.now);
  assert.deepEqual(SNOOZE_PRESETS, v.presets);
  for (const c of v.cases) {
    if (c.error) {
      assert.throws(() => resolveSnooze(c.request, now), (e) => e.code === c.error, c.name);
    } else {
      assert.equal(resolveSnooze(c.request, now).toISOString().replace(".000Z", "Z"), c.until, c.name);
    }
  }
});

test("filter vectors", () => {
  const v = vector("filter.json");
  const now = new Date(v.now);
  for (const c of v.cases) {
    if (c.error) {
      assert.throws(() => filterSnoozed(v.items, c.filter, { now }));
      continue;
    }
    const got = filterSnoozed(v.items, c.filter, { now });
    assert.deepEqual(got.items.map((i) => i.id), c.ids, c.filter);
    assert.equal(got.total, c.total);
    assert.deepEqual(got.counts, c.counts);
    assert.equal(got.snoozedCount, c.snoozed_count);
    assert.equal(Object.values(got.counts).reduce((a, b) => a + b, 0), got.total, "counts add up");
  }
});

test("a lapsed snooze is awake, and says nothing", () => {
  const now = new Date("2026-09-08T10:00:00Z");
  assert.equal(isSnoozed("2026-09-01T00:00:00Z", now), false);
  assert.equal(isSnoozed("not a date", now), false);
  assert.equal(snoozeLabel("2026-09-01T00:00:00Z", now), "");
  assert.match(snoozeLabel("2026-09-20T00:00:00Z", now, "en-GB"), /^Snoozed until 20 Sept?$/);
  assert.match(snoozeLabel("2027-01-20T00:00:00Z", now, "en-GB"), /2027/);
});

test("the toggle is remembered, and storage that throws is survived", () => {
  const box = new Map();
  const storage = { getItem: (k) => box.get(k) ?? null, setItem: (k, v) => box.set(k, v) };
  assert.equal(loadShowSnoozed("k", storage), false);
  saveShowSnoozed("k", true, storage);
  assert.equal(loadShowSnoozed("k", storage), true);
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(loadShowSnoozed("k", broken), false);
  assert.doesNotThrow(() => saveShowSnoozed("k", true, broken));
  assert.equal(snoozedToggleLabel(false, 3), "Show snoozed (3)");
  assert.equal(snoozedToggleLabel(true, 3), "Hide snoozed (3)");
});
