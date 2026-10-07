// The tour on screen: the page dimmed, a cut-out around the step's target,
// and the tooltip beside it — the brightest thing on the screen.
//
// Accessible: the tooltip is a modal dialog named by its title and described
// by its body; focus moves into it on every step and back where it was when
// the tour closes; Tab stays inside it; Escape, Skip and the close button end
// it from any step, so it never holds anybody. Arrow keys step. A live region
// says which step this is. `prefers-reduced-motion` turns off every
// transition and smooth scroll. Narrow screens get the tooltip as a sheet
// along the bottom with the cut-out above it.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { holeFor, placeTooltip, type Box, type Spot } from "./geometry.js";
import { resolveDocsUrl, selectorFor, type Tour, type TourStep } from "./tour.js";

export type TourLabels = {
  next: string;
  back: string;
  done: string;
  skip: string;
  close: string;
  learn: string;
  newTab: string;
  stepOf: (n: number, of: number) => string;
};

export const DEFAULT_LABELS: TourLabels = {
  next: "Next",
  back: "Back",
  done: "Done",
  skip: "Skip tour",
  close: "Close tour",
  learn: "Learn how",
  newTab: "(opens in a new tab)",
  stepOf: (n, of) => `Step ${n} of ${of}`,
};

/** Why a tour closed. `unavailable`: no step had anything to point at. */
export type CloseReason = "completed" | "dismissed" | "unavailable";

export type SpotlightProps = {
  tour: Tour;
  open: boolean;
  onClose: (reason: CloseReason, step: number) => void;
  /** Joined to every step's relative `docsUrl`. */
  docsBase?: string;
  labels?: Partial<TourLabels>;
  /** The tooltip's title level; 2 unless the host's outline says otherwise. */
  headingLevel?: 2 | 3 | 4;
  /** Called as each step shows (analytics, or the host's own state). */
  onStep?: (index: number, step: TourStep) => void;
  /** At or below this width the tooltip is a bottom sheet. */
  sheetBelow?: number;
  /** How long to wait for a first target to appear before giving up (ms). */
  waitFor?: number;
};

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function media(query: string): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.(query).matches;
  } catch {
    return false;
  }
}

/**
 * The step's target when it is on the page AND drawn: a rail item inside a
 * closed phone menu is in the document but not on the screen, and a cut-out
 * around nothing at the top-left corner is worse than skipping the step.
 */
function targetOf(step: TourStep | undefined): Element | null {
  if (!step?.target || typeof document === "undefined") return null;
  for (const el of Array.from(document.querySelectorAll(selectorFor(step.target)))) {
    if (drawn(el)) return el;
  }
  return null;
}

function drawn(el: Element): boolean {
  const check = (el as Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean }).checkVisibility;
  if (typeof check === "function") return check.call(el, { checkVisibilityCSS: true, visibilityProperty: true });
  // No checkVisibility (an older browser, or a test document): the inline
  // and computed display are the best evidence there is.
  if (el instanceof HTMLElement && el.hidden) return false;
  try {
    for (let n: Element | null = el; n; n = n.parentElement) {
      if (getComputedStyle(n).display === "none") return false;
    }
  } catch {
    /* no computed style here: assume drawn */
  }
  return true;
}

/** A step can show when it points at nothing or its target is on the page. */
function showable(step: TourStep | undefined): boolean {
  return !!step && (!step.target || targetOf(step) !== null);
}

/** The next showable step from `from` in `dir`, or -1. */
export function nextShowable(steps: TourStep[], from: number, dir: 1 | -1): number {
  for (let i = from; i >= 0 && i < steps.length; i += dir) if (showable(steps[i])) return i;
  return -1;
}

function viewport() {
  return { width: window.innerWidth || document.documentElement.clientWidth, height: window.innerHeight || document.documentElement.clientHeight };
}

export function Spotlight({ tour, open, onClose, docsBase, labels: given, headingLevel = 2, onStep, sheetBelow = 640, waitFor = 3000 }: SpotlightProps) {
  const labels = { ...DEFAULT_LABELS, ...given };
  const steps = tour.steps;
  const [index, setIndex] = useState(-1);
  const [hole, setHole] = useState<Box | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [sheet, setSheet] = useState(false);
  const [still, setStill] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const step = index >= 0 ? steps[index] : undefined;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Opening: remember where focus was, then find the first step that can
  // show — waiting a moment for a page that is still loading its targets.
  useEffect(() => {
    if (!open) {
      setIndex(-1);
      return;
    }
    returnTo.current = typeof document !== "undefined" ? document.activeElement : null;
    setStill(media("(prefers-reduced-motion: reduce)"));
    let cancelled = false;
    const started = Date.now();
    const tryStart = () => {
      if (cancelled) return;
      const first = nextShowable(steps, 0, 1);
      if (first >= 0) {
        setIndex(first);
        return;
      }
      if (Date.now() - started >= waitFor) {
        onCloseRef.current("unavailable", 0);
        return;
      }
      timer = setTimeout(tryStart, 150);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    tryStart();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, steps, waitFor]);

  // Closing: focus goes back where it came from.
  const finish = useCallback(
    (reason: CloseReason) => {
      const at = Math.max(0, index);
      setIndex(-1);
      const back = returnTo.current;
      onCloseRef.current(reason, at);
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    },
    [index],
  );

  // Measure: the target's box (after scrolling it into view) and the tooltip's.
  const measure = useCallback(() => {
    if (!step) return;
    const vp = viewport();
    const narrow = vp.width <= sheetBelow || media(`(max-width: ${sheetBelow}px)`);
    setSheet(narrow);
    const el = targetOf(step);
    if (!el) {
      setHole(null);
      setSpot(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const h = holeFor({ top: r.top, left: r.left, width: r.width, height: r.height }, vp);
    setHole(h);
    const tip = dialog.current?.getBoundingClientRect();
    setSpot(narrow ? null : placeTooltip(h, { width: tip?.width || 320, height: tip?.height || 180 }, vp, step.placement));
  }, [step, sheetBelow]);

  useLayoutEffect(() => {
    if (!step) return;
    const el = targetOf(step);
    // Not every document scrolls (a test document has no scrollIntoView);
    // the step shows either way.
    if (el && typeof el.scrollIntoView === "function") {
      try {
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: still ? "auto" : "smooth" });
      } catch {
        /* an old browser that takes no options: the step shows where it is */
      }
    }
    measure();
    // Once more after the tooltip has its size and a smooth scroll has moved.
    const raf = requestAnimationFrame(measure);
    const late = setTimeout(measure, still ? 0 : 350);
    dialog.current?.focus();
    onStep?.(index, step);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(late);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (!step) return;
    let raf = 0;
    const again = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", again);
    window.addEventListener("scroll", again, true);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(again) : null;
    const el = targetOf(step);
    if (ro && el) ro.observe(el);
    if (ro && dialog.current) ro.observe(dialog.current);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", again);
      window.removeEventListener("scroll", again, true);
      ro?.disconnect();
    };
  }, [step, measure]);

  const go = useCallback(
    (dir: 1 | -1) => {
      const to = nextShowable(steps, index + dir, dir);
      if (to >= 0) setIndex(to);
      else if (dir === 1) finish("completed");
    },
    [steps, index, finish],
  );

  if (!open || !step || typeof document === "undefined") return null;

  // Counted over the steps that can show now, so "Step 3 of 5" never skips.
  const live = steps.map((s, i) => (showable(s) || i === index ? i : -1)).filter((i) => i >= 0);
  const position = live.indexOf(index) + 1;
  const total = live.length;
  const isLast = nextShowable(steps, index + 1, 1) < 0;
  const isFirst = nextShowable(steps, index - 1, -1) < 0;
  const docs = step.docsUrl ? resolveDocsUrl(step.docsUrl, docsBase) : "";
  const Title = `h${headingLevel}` as "h2";

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      finish("dismissed");
    } else if (e.key === "ArrowRight" && !(e.target instanceof HTMLAnchorElement)) {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft" && !(e.target instanceof HTMLAnchorElement)) {
      e.preventDefault();
      if (!isFirst) go(-1);
    } else if (e.key === "Tab") {
      // Tab cycles inside the tooltip; Escape and Skip are always one key away.
      const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialog.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const tipStyle: CSSProperties | undefined = sheet ? undefined : spot ? { top: spot.top, left: spot.left } : undefined;
  const classes = ["ztour", still ? "ztour--still" : "", sheet ? "ztour--sheet" : "", hole ? "" : "ztour--center"].filter(Boolean).join(" ");

  return createPortal(
    <div className={classes} data-tour-id={tour.id} data-step={step.id}>
      {/* Clicks on the dimmed page do nothing: the page is behind the tour,
          and an accidental tap must not lose the person's place. */}
      <div className="ztour__scrim" aria-hidden="true" onClick={(e) => e.stopPropagation()} />
      {hole ? (
        <div
          className="ztour__hole"
          aria-hidden="true"
          style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
        />
      ) : null}
      <div
        ref={dialog}
        className={`ztour__tip${spot ? ` ztour__tip--${spot.placement}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        style={tipStyle}
        onKeyDown={onKeyDown}
      >
        <div className="ztour__head">
          <p className="ztour__count" aria-live="polite">
            {labels.stepOf(position, total)}
          </p>
          <button type="button" className="ztour__close" aria-label={labels.close} onClick={() => finish("dismissed")}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <Title id={titleId} className="ztour__title">
          {step.title}
        </Title>
        <p id={bodyId} className="ztour__body">
          {step.body}
        </p>
        {docs ? (
          <a className="ztour__learn" href={docs} target="_blank" rel="noopener noreferrer">
            {step.learnLabel ?? labels.learn}
            <span className="ztour__sr"> {labels.newTab}</span>
            <span aria-hidden="true"> →</span>
          </a>
        ) : null}
        <div className="ztour__actions">
          {isLast ? <span /> : (
            <button type="button" className="ztour__skip" onClick={() => finish("dismissed")}>
              {labels.skip}
            </button>
          )}
          <div className="ztour__nav">
            {isFirst ? null : (
              <button type="button" className="ztour__back" onClick={() => go(-1)}>
                {labels.back}
              </button>
            )}
            <button type="button" className="ztour__next" onClick={() => go(1)}>
              {isLast ? labels.done : labels.next}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
