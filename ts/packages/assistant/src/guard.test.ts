// The package is shared and public: its prices come from the status and its
// words from the host. This guard reads the package's own source (not its
// tests) and the description it ships with.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" ? [] : sources(path);
    if (/\.test\.tsx?$/.test(name)) return [];
    return /\.(ts|tsx|css)$/.test(name) ? [path] : [];
  });
}

const files = [...sources(here), join(pkg, "package.json")];

function findings(pattern: RegExp): string[] {
  const out: string[] = [];
  for (const file of files) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (pattern.test(line)) out.push(`${relative(pkg, file)}:${i + 1}: ${line.trim()}`);
      });
  }
  return out;
}

describe("the package's source", () => {
  test("is read: the guard sees the components", () => {
    const names = files.map((f) => relative(pkg, f));
    for (const want of ["src/AiAction.tsx", "src/AssistantSheet.tsx", "src/status.ts", "src/styles.css", "package.json"]) {
      expect(names).toContain(want);
    }
  });

  test("holds no credit price: a number next to the word credit", () => {
    expect(findings(/\d\s*(?:ai\s+)?credits?\b/i)).toEqual([]);
    expect(findings(/\bcredits?\s*[:=]\s*\d/i)).toEqual([]);
  });

  test("names no product, customer or service", () => {
    expect(findings(/\b(?:Pages|Reach|Shop|Shofar|Silvertree)\b/)).toEqual([]);
    expect(findings(/\b(?:pages|reach|shop)\.[a-z]/)).toEqual([]);
    expect(findings(/bantu\s*hr|zavonpages/i)).toEqual([]);
  });

  test("holds no fixed address to fetch", () => {
    expect(findings(/\bfetch\s*\(|XMLHttpRequest|https?:\/\//)).toEqual([]);
  });
});
