import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// jsdom has no layout and no matchMedia; a test sets a narrow screen or
// reduced motion through __media, and every test starts from neither.
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

afterEach(() => {
  cleanup();
  mq.reduce = false;
  mq.narrow = false;
});
