import { useCallback, useEffect, useLayoutEffect, useState } from "react";

/** Height that makes an element fill the window from where it starts down to
 *  `bottomGap` px above the bottom — so the page itself never scrolls and the
 *  element scrolls inside. Re-measures on resize and whenever the page's
 *  layout changes above it (filters wrapping, a banner appearing). Returns a
 *  callback ref and the height (undefined until measured). */
export function useFillHeight<T extends HTMLElement>(bottomGap = 24, min = 260, fitPage = false) {
  const [el, setEl] = useState<T | null>(null);
  const [height, setHeight] = useState<number>();
  const measure = useCallback(() => {
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    // fitPage: whatever sits below the element (page padding, a footer)
    // comes off too, so a board's page never scrolls. spaceBelow doesn't
    // depend on the element's own height, so this settles in one pass
    // (measuring the page's overflow instead flip-flopped — shrink, no
    // overflow, grow, overflow — and React stopped it: error #185).
    const below = fitPage ? spaceBelow(el) : 0;
    const h = Math.max(min, Math.floor(window.innerHeight - top - Math.max(bottomGap, below)));
    setHeight((cur) => (cur === h ? cur : h));
  }, [el, bottomGap, min, fitPage]);
  // Every render: cheap, and setHeight bails out when nothing moved.
  useLayoutEffect(() => {
    measure();
  });
  useEffect(() => {
    window.addEventListener("resize", measure);
    // Content above the element can change size without this component
    // re-rendering (a sibling's filters wrap): watch the page body too.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    ro?.observe(document.body);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [measure]);
  return { ref: setEl, height, measure };
}

/** True when the window is at least `px` wide — for layouts that only fill
 *  the window side by side (on a phone they stack and scroll as a page). */
export function useIsWide(px = 1024): boolean {
  const query = `(min-width: ${px}px)`;
  const [wide, setWide] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return wide;
}

/** What the page lays out below an element: its bottom margin, then, up
 *  every ancestor to <body>, the siblings after it and the ancestor's bottom
 *  padding and border. Independent of the element's own height. */
function spaceBelow(el: HTMLElement): number {
  let total = 0;
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    const cs = getComputedStyle(node);
    total += parseFloat(cs.marginBottom) || 0;
    for (let sib = node.nextElementSibling as HTMLElement | null; sib; sib = sib.nextElementSibling as HTMLElement | null) {
      const ss = getComputedStyle(sib);
      if (ss.position === "absolute" || ss.position === "fixed" || ss.display === "none") continue;
      // Only what is laid out under it (not a rail or panel beside it).
      if (sib.getBoundingClientRect().top < node.getBoundingClientRect().bottom - 1) continue;
      total += sib.offsetHeight + (parseFloat(ss.marginTop) || 0) + (parseFloat(ss.marginBottom) || 0);
    }
    const parent: HTMLElement | null = node.parentElement;
    if (parent && parent !== document.body) {
      const ps = getComputedStyle(parent);
      total += (parseFloat(ps.paddingBottom) || 0) + (parseFloat(ps.borderBottomWidth) || 0);
    }
    node = parent;
  }
  return Math.ceil(total);
}
