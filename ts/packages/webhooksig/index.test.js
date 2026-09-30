import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sign, header, verify } from "./index.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "contract", "signature");
const vectors = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

test("there are contract vectors", () => assert.ok(vectors.length > 0));

for (const v of vectors) {
  test(`vector ${v.name}: same bytes as Go`, () => {
    assert.equal(sign(v.secrets[0], v.timestamp, v.body), v.sign);
    assert.equal(header(v.secrets, v.timestamp, v.body), v.header);
    for (const s of v.secrets) verify([s], v.header, String(v.timestamp), v.body, v.timestamp);
  });
}

test("core's bare hex verifies", () => {
  const v = vectors.find((x) => x.name === "bare");
  verify(["s3cret"], v.sign, String(v.timestamp), v.body, v.timestamp);
});

test("skew both ways, tampering, missing headers and no secret are refused", () => {
  const v = vectors.find((x) => x.name === "bare");
  assert.throws(() => verify(["s3cret"], v.header, String(v.timestamp), v.body, v.timestamp + 301), /window/);
  assert.throws(() => verify(["s3cret"], v.header, String(v.timestamp), v.body, v.timestamp - 301), /window/);
  assert.throws(() => verify(["s3cret"], v.header, String(v.timestamp), v.body + " ", v.timestamp), /match/);
  assert.throws(() => verify(["s3cret"], "", String(v.timestamp), v.body, v.timestamp), /both/);
  assert.throws(() => verify([], v.header, String(v.timestamp), v.body, v.timestamp), /no signing secret/);
  assert.throws(() => verify([""], v.header, String(v.timestamp), v.body, v.timestamp), /no signing secret/);
});
