// Shared by the tests: the contract vectors and an axe run.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import axe from "axe-core";

export const contractDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "contract", "ai");

/** Reads one file of contract/ai, for example "status-ready.json" or "errors/off.json". */
export function vector<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(join(contractDir, name), "utf8")) as T;
}

export async function violations(root: Element = document.body): Promise<string[]> {
  const out = await axe.run(root, {
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: false },
      "page-has-heading-one": { enabled: false },
      "landmark-one-main": { enabled: false },
    },
  });
  return out.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
}

export function setNarrow(narrow: boolean) {
  ((globalThis as Record<string, unknown>).__media as { narrow: boolean }).narrow = narrow;
}
