// Tours for a whole app: which tours exist, where "seen" is kept, the tour
// that starts by itself the first time a person arrives, and `useTours()`
// for a Help menu's "Take the tour".
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Spotlight, type CloseReason, type TourLabels } from "./Spotlight.js";
import { isSeen, localStorageStore, tourKey, type TourStepAction, type TourStore, type TourStoreContext } from "./storage.js";
import type { Tour, TourStep } from "./tour.js";

export type TourContextValue = {
  /** The tours this provider knows. */
  tours: Tour[];
  /** Start a tour now, seen or not. False when there is no such tour. */
  start: (id: string) => boolean;
  /**
   * "Restart tour" (1.1): forget the person's record (the store's `reset`,
   * on the server too for a server store), then start it from the first
   * step. False when there is no such tour.
   */
  restart: (id: string) => boolean;
  /** The id of the tour on screen, or null. */
  active: string | null;
  /** Whether the person has seen a tour; undefined until the store has answered. */
  seen: (id: string) => boolean | undefined;
};

const TourContext = createContext<TourContextValue | null>(null);

/** The provider's controls. Outside a provider: no tours, and `start` does nothing. */
export function useTours(): TourContextValue {
  return (
    useContext(TourContext) ?? {
      tours: [],
      start: () => false,
      restart: () => false,
      active: null,
      seen: () => undefined,
    }
  );
}

export type TourProviderProps = {
  tours: Tour[];
  /**
   * Who is looking: a stable id for the signed-in person. Nothing starts by
   * itself until it is set, so a tour never shows to a page still deciding
   * who is signed in.
   */
  person: string | null | undefined;
  /** Files the records per product, so one person's tours in two apps are two answers. */
  scope?: string;
  /** Defaults to this browser's localStorage. */
  store?: TourStore;
  /** The tour that starts on a person's first visit. */
  autoStart?: string;
  /** Wait this long after the person is known before starting (ms), so the page can draw. */
  autoStartDelay?: number;
  /** Turn the automatic start off (a print view, an embed, an automated test). */
  autoStartEnabled?: boolean;
  docsBase?: string;
  labels?: Partial<TourLabels>;
  headingLevel?: 2 | 3 | 4;
  onStep?: (tour: string, index: number, step: TourStep) => void;
  onClose?: (tour: string, reason: CloseReason, step: number) => void;
  children?: ReactNode;
};

export function TourProvider({
  tours,
  person,
  scope,
  store: given,
  autoStart,
  autoStartDelay = 600,
  autoStartEnabled = true,
  docsBase,
  labels,
  headingLevel,
  onStep,
  onClose,
  children,
}: TourProviderProps) {
  const store = useMemo(() => given ?? localStorageStore(), [given]);
  const [active, setActive] = useState<string | null>(null);
  const [seenMap, setSeenMap] = useState<Record<string, boolean>>({});
  const autoTried = useRef<string | null>(null);
  const byId = useMemo(() => new Map(tours.map((t) => [t.id, t])), [tours]);
  const keyFor = useCallback((id: string) => tourKey({ tour: id, person: person ?? "", scope }), [person, scope]);
  const ctxFor = useCallback(
    (id: string): TourStoreContext => ({ tour: id, version: byId.get(id)?.version ?? 1, person: person ?? "", scope }),
    [person, scope, byId],
  );
  // The step on screen, so the next one shown can say whether it came by
  // Next or by Back.
  const lastStep = useRef<{ tour: string; index: number; id: string } | null>(null);
  const record = useCallback(
    (tour: string, action: TourStepAction, index: number, step: string) => {
      if (!person || !store.event) return;
      try {
        void Promise.resolve(store.event({ action, step, index, at: new Date().toISOString() }, ctxFor(tour))).catch(() => {});
      } catch {
        /* history is best effort; the tour goes on */
      }
    },
    [person, store, ctxFor],
  );

  // Ask the store about every tour once the person is known.
  useEffect(() => {
    if (!person) return;
    let cancelled = false;
    setSeenMap({});
    Promise.all(
      tours.map(async (t) => {
        try {
          return [t.id, isSeen(await store.get(keyFor(t.id), ctxFor(t.id)), t.version ?? 1)] as const;
        } catch {
          return [t.id, false] as const;
        }
      }),
    ).then((pairs) => {
      if (!cancelled) setSeenMap(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
    // ctxFor follows person and tours, which are here already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person, tours, store, keyFor]);

  // The first visit: start the tour once, after the store said "not seen".
  useEffect(() => {
    if (!autoStartEnabled || !autoStart || !person || active) return;
    if (seenMap[autoStart] !== false) return;
    const marker = `${person}:${autoStart}`;
    if (autoTried.current === marker) return;
    autoTried.current = marker;
    const t = setTimeout(() => setActive(autoStart), autoStartDelay);
    return () => clearTimeout(t);
  }, [autoStartEnabled, autoStart, person, active, seenMap, autoStartDelay]);

  const start = useCallback(
    (id: string) => {
      if (!byId.has(id)) return false;
      lastStep.current = null;
      setActive(id);
      return true;
    },
    [byId],
  );

  const restart = useCallback(
    (id: string) => {
      if (!byId.has(id)) return false;
      setSeenMap((m) => ({ ...m, [id]: false }));
      const begin = () => {
        lastStep.current = null;
        setActive(id);
      };
      if (person && store.reset) {
        // Start once the store has forgotten, so the steps that follow are
        // written after the reset; a failed reset still starts the tour.
        void store.reset(keyFor(id), ctxFor(id)).then(begin, begin);
      } else begin();
      return true;
    },
    [byId, person, store, keyFor, ctxFor],
  );

  const onShow = useCallback(
    (tour: string, index: number, step: TourStep) => {
      const prev = lastStep.current;
      if (prev && prev.tour === tour && prev.index !== index) {
        record(tour, index > prev.index ? "next" : "back", prev.index, prev.id);
      }
      lastStep.current = { tour, index, id: step.id };
      record(tour, "shown", index, step.id);
      onStep?.(tour, index, step);
    },
    [record, onStep],
  );

  const close = useCallback(
    (reason: CloseReason, step: number) => {
      const id = active;
      setActive(null);
      if (!id) return;
      onClose?.(id, reason, step);
      const last = lastStep.current;
      lastStep.current = null;
      // Nothing to point at is not "seen": the next visit tries again.
      if (reason === "unavailable" || !person) return;
      const tour = byId.get(id);
      record(id, reason === "completed" ? "completed" : "skipped", step, last && last.tour === id ? last.id : tour?.steps[step]?.id ?? "");
      setSeenMap((m) => ({ ...m, [id]: true }));
      void store
        .set(
          keyFor(id),
          {
            status: reason === "completed" ? "completed" : "dismissed",
            version: tour?.version ?? 1,
            at: new Date().toISOString(),
            ...(reason === "dismissed" ? { step } : {}),
          },
          ctxFor(id),
        )
        .catch(() => {});
    },
    [active, person, byId, store, keyFor, ctxFor, onClose, record],
  );

  const value = useMemo<TourContextValue>(
    () => ({ tours, start, restart, active, seen: (id) => seenMap[id] }),
    [tours, start, restart, active, seenMap],
  );
  const tour = active ? byId.get(active) : undefined;

  return (
    <TourContext.Provider value={value}>
      {children}
      {tour ? (
        <Spotlight
          tour={tour}
          open
          onClose={close}
          docsBase={docsBase}
          labels={labels}
          headingLevel={headingLevel}
          onStep={(i, s) => onShow(tour.id, i, s)}
        />
      ) : null}
    </TourContext.Provider>
  );
}
