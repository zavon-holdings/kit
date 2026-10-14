import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bandOf } from "./index.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "contract", "bands");
const vectors = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

test("there are contract vectors", () => assert.ok(vectors.length >= 10));

for (const v of vectors) {
  test(`vector ${v.name}`, () => {
    if (v.error) {
      assert.throws(() => bandOf(v.scale, v.value), new RegExp(`^Error: ${v.error}$`));
      return;
    }
    assert.deepEqual(bandOf(v.scale, v.value), v.expect);
  });
}
