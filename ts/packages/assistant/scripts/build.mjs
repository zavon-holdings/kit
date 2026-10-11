// Builds dist/: the TypeScript compiled to ESM with declarations, and the
// stylesheet copied beside it. Run by `npm pack` (prepack) in the release.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
rmSync(join(root, "dist"), { recursive: true, force: true });
execFileSync(process.execPath, [tsc, "-p", join(root, "tsconfig.build.json")], { stdio: "inherit", cwd: root });
mkdirSync(join(root, "dist"), { recursive: true });
copyFileSync(join(root, "src", "styles.css"), join(root, "dist", "styles.css"));
