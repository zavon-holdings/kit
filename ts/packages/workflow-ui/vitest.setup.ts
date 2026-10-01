// jsdom has no layout. The canvas library measures nodes with ResizeObserver
// and reads transforms with DOMMatrixReadOnly; give it inert stand-ins so a
// render test can exercise the markup the package owns.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => cleanup());

class ResizeObserverStub {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  // The canvas only shows a node once it has been measured: report every
  // observed element at once, as React Flow's own test setup does.
  observe(target: Element) {
    const box = { width: 1000, height: 600 };
    this.callback([{ target, contentRect: box, borderBoxSize: [{ inlineSize: 1000, blockSize: 600 }] } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

class DOMMatrixReadOnlyStub {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([1-9.])\)/)?.[1];
    this.m22 = scale !== undefined ? Number(scale) : 1;
  }
}

const g = globalThis as Record<string, unknown>;
g.ResizeObserver ??= ResizeObserverStub;
g.DOMMatrixReadOnly ??= DOMMatrixReadOnlyStub;

Object.defineProperties(globalThis.HTMLElement.prototype, {
  offsetHeight: { get() { return Number.parseFloat(this.style?.height) || 40; }, configurable: true },
  offsetWidth: { get() { return Number.parseFloat(this.style?.width) || 160; }, configurable: true },
});

(globalThis.SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
  ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
