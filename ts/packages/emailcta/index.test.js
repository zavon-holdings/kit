import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { apply, templates, text, escape } from "./index.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "contract", "emailcta");
const vectors = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

test("there are contract vectors", () => assert.ok(vectors.length >= 10));

for (const v of vectors) {
  test(`vector ${v.name}: the same body as Go`, () => {
    assert.equal(apply(v.body, templates(v.button, v.link)), v.expect);
  });
}

test("text and escape match Go's", () => {
  assert.equal(text("  Book&nbsp;<b>&amp;</b>\n pay &#8212; &#x41; &bogus; "), "Book & pay — A &bogus;");
  assert.equal(escape(`<"Tom" & 'Jerry'>`), "&lt;&#34;Tom&#34; &amp; &#39;Jerry&#39;&gt;");
});
