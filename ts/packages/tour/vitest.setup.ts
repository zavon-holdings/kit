import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});

// jsdom has no layout and no matchMedia; a test sets either through these.
const mq = { reduce: false, narrow: false };
(globalThis as Record<string, unknown>).__media = mq;
window.matchMedia = (query: string) =>
  ({
    matches: query.includes("reduce") ? mq.reduce : query.includes("max-width") ? mq.narrow : false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList;

// Newer Node versions put an unconfigured localStorage of their own on the
// global, which hides jsdom's; give the tests a working one.
if (typeof window.localStorage?.setItem !== "function") {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
}
