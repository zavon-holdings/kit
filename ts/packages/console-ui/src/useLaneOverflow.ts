import { useCallback, useEffect, useState } from "react";

/** A board lane's overflow, for lanes that hide their scrollbar (owner, 2 Nov
 *  2026: "the scrollbar disappears, but we need some alternative indication
 *  that they are still scrollable"): whether cards are cut off above, and how
 *  many are below — the loaded ones out of view plus, given the lane's true
 *  total, the ones not loaded yet. Cards are the elements marked
 *  data-lane-item. Re-measured on scroll, resize and when cards come or go.
 *  Spread `props` on the scrolling element. */
export function useLaneOverflow(total?: number) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [state, setState] = useState({ above: false, below: 0, more: false });
  const measure = useCallback(() => {
    if (!el) return;
    const bottom = el.scrollTop + el.clientHeight;
    const items = el.querySelectorAll<HTMLElement>("[data-lane-item]");
    let out = 0;
    // A card is "below" once its middle is past the lane's bottom edge.
    items.forEach((it) => {
      if (it.offsetTop + it.offsetHeight / 2 > bottom) out++;
    });
    const unloaded = total !== undefined ? Math.max(0, total - items.length) : 0;
    const more = el.scrollHeight - bottom > 2;
    const next = { above: el.scrollTop > 2, below: more ? out + unloaded : 0, more };
    setState((cur) => (cur.above === next.above && cur.below === next.below && cur.more === next.more ? cur : next));
  }, [el, total]);
  useEffect(() => {
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(measure);
    mo?.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [el, measure]);
  /** Scroll on by most of a lane's height (the "N more" chip). */
  const scrollOn = useCallback(() => {
    el?.scrollBy({ top: Math.round(el.clientHeight * 0.8), behavior: "smooth" });
  }, [el]);
  return {
    ref: setEl,
    ...state,
    scrollOn,
    props: { "data-more-above": state.above || undefined, "data-more-below": state.more || undefined },
  };
}
