// "What's new" (1.1): short notes about new features, listed in a host's Help
// menu to people who already know the product, each able to start a short
// tour ("Show me") or open its guide ("Find out more").
//
// Which notes a person sees is the server's decision (who they are, what
// they finished, what they dismissed); this is the client for it and the
// state a host's menu draws from. The drawing is the host's own. The wire:
//
//   GET  {endpoint}/announcements?app=A&main=T          → Feed
//   POST {endpoint}/announcements/{key}/receipts        {app, main?, action}
//
// Returning people (1.2): the feed also answers when the person was last in
// the app (`last_seen_at`) and the platform's `auto_open_days`. After an
// absence of at least that many days, with something published meanwhile,
// the panel opens by itself once (`shouldAutoOpen`, held to
// contract/whatsnew/auto_open.json; `useWhatsNew({ autoOpen })` and
// `useAutoOpenWhatsNew`).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTours } from "./TourProvider.js";

export type AnnouncementItem = {
  key: string;
  app: string;
  title: string;
  body: string;
  docs_path?: string;
  /** A tour in the host's own registry; absent for a note about every product. */
  tour_id?: string;
  /** Big-ticket: may show once as the day's toast. */
  big: boolean;
  published_at: string;
  shown_at?: string;
  toasted_at?: string;
  opened_at?: string;
  tour_started_at?: string;
  completed_tour_at?: string;
  /** 1.2: the panel opened by itself with this note new. */
  auto_shown_at?: string;
};

export type AnnouncementFeed = {
  items: AnnouncementItem[];
  /** Items never listed in an open panel: the badge. */
  unseen: number;
  /** The person's latest toast in any product, so there is at most one a day. */
  last_toasted_at?: string | null;
  /**
   * 1.2: when the person was last in this app, as the open rule reads it —
   * null on a first visit and while acting as a role (nothing opens).
   */
  last_seen_at?: string | null;
  /** 1.2: the absence, in days, after which the panel opens by itself; 0 is never. */
  auto_open_days?: number;
};

export type ReceiptAction = "shown" | "toasted" | "opened" | "tour_started" | "tour_completed" | "dismissed" | "auto_shown";

export type AnnouncementsClientOptions = {
  /** The host's fetch: adds the authorisation and renews it on a 401. */
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  endpoint: string;
  app: string;
  /** The host's first-run tour: notes go to people who finished it before they were published. */
  mainTour?: string;
};

export type AnnouncementsClient = {
  list(): Promise<AnnouncementFeed | null>;
  receipt(key: string, action: ReceiptAction): Promise<boolean>;
};

export function createAnnouncementsClient(opts: AnnouncementsClientOptions): AnnouncementsClient {
  const base = opts.endpoint.replace(/\/+$/, "");
  return {
    async list() {
      try {
        const q = new URLSearchParams({ app: opts.app });
        if (opts.mainTour) q.set("main", opts.mainTour);
        const res = await opts.fetch(`${base}/announcements?${q}`, { cache: "no-store" });
        if (!res.ok) return null;
        const body = (await res.json()) as Partial<AnnouncementFeed>;
        const items = Array.isArray(body.items) ? body.items.filter((i) => i && typeof i.key === "string" && typeof i.title === "string") : [];
        return {
          items,
          unseen: typeof body.unseen === "number" ? body.unseen : items.filter((i) => !i.shown_at).length,
          last_toasted_at: body.last_toasted_at ?? null,
          last_seen_at: typeof body.last_seen_at === "string" ? body.last_seen_at : null,
          auto_open_days: typeof body.auto_open_days === "number" ? body.auto_open_days : 0,
        };
      } catch {
        return null;
      }
    },
    async receipt(key, action) {
      try {
        const res = await opts.fetch(`${base}/announcements/${encodeURIComponent(key)}/receipts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ app: opts.app, ...(opts.mainTour ? { main: opts.mainTour } : {}), action }),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

/** The local calendar day of a moment, as YYYY-MM-DD. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The note to show as today's toast, or null: a big-ticket one never toasted,
 * and only when the person has had no toast today — in any product (the
 * server's `last_toasted_at`) or on this browser (`localToastDay`, for a
 * receipt that could not be sent).
 */
export function toastCandidate(feed: AnnouncementFeed | null, now: Date, localToastDay?: string | null): AnnouncementItem | null {
  if (!feed) return null;
  const today = localDay(now);
  if (localToastDay === today) return null;
  if (feed.last_toasted_at) {
    const last = new Date(feed.last_toasted_at);
    if (!Number.isNaN(last.getTime()) && localDay(last) === today) return null;
  }
  return feed.items.find((i) => i.big && !i.toasted_at) ?? null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function instant(iso: string | null | undefined): number | null {
  if (typeof iso !== "string" || iso === "") return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

type Dated = Pick<AnnouncementItem, "key" | "published_at" | "auto_shown_at">;

/**
 * The notes new since a person's last visit, in the feed's order: published
 * after `lastSeenAt` and never opened by themselves before. They come first
 * in a panel that opened by itself; the rest go below an "Earlier" divider.
 * None when the last visit is unknown.
 */
export function freshSince<T extends Dated>(lastSeenAt: string | null | undefined, items: T[]): T[] {
  const last = instant(lastSeenAt);
  if (last === null) return [];
  return items.filter((i) => {
    const at = instant(i.published_at);
    return at !== null && at > last && !i.auto_shown_at;
  });
}

/**
 * Whether What's new opens by itself (contract/whatsnew/auto_open.json):
 * the person was away at least `minDays` whole days and something was
 * published while they were away that has not opened by itself before. A
 * first visit (no `lastSeenAt`) is the first-run tour's, and `minDays` 0 or
 * less turns it off. Dismissed notes are never in the list.
 */
export function shouldAutoOpen(lastSeenAt: string | null | undefined, now: Date, minDays: number, items: Dated[]): boolean {
  const last = instant(lastSeenAt);
  if (last === null || !Number.isFinite(minDays) || minDays <= 0) return false;
  if (now.getTime() - last < minDays * DAY_MS) return false;
  return freshSince(lastSeenAt, items).length > 0;
}

export type UseWhatsNewOptions = {
  client: AnnouncementsClient | null;
  /** The signed-in person; nothing loads until it is known, and the local day is kept per person. */
  person: string | null | undefined;
  /** Turn the day's toast off (an embed, an automated test). */
  toast?: boolean;
  /** Turn it all off. */
  enabled?: boolean;
  now?: () => Date;
  /** Local key prefix for the toast day. */
  prefix?: string;
  /**
   * 1.2: let the panel open by itself for a returning person
   * (`shouldAutoOpen`). Off by default. The host turns it off where it must
   * never open: while acting as a role, in an editor, under automation.
   * Opening waits for `openAuto()` — `useAutoOpenWhatsNew` calls it once no
   * tour is on screen — so a return is never spent on a screen that cannot
   * show it.
   */
  autoOpen?: boolean;
};

export type WhatsNew = {
  items: AnnouncementItem[];
  unseen: number;
  loaded: boolean;
  /** The day's toast, or null. */
  toast: AnnouncementItem | null;
  refresh(): Promise<void>;
  /** The panel opened: every listed note counts as seen and the badge clears. */
  markShown(): void;
  dismiss(key: string): void;
  /** "Find out more". */
  opened(key: string): void;
  /** "Show me": records it and answers the tour to start (null when there is none). */
  showMe(key: string): string | null;
  /** Tell it how a tour ended, so a "Show me" tour that reached its last step is recorded. */
  tourClosed(tour: string, reason: string): void;
  dismissToast(): void;
  /** 1.2: the open rule holds for this return and the panel has not opened for it yet. */
  autoOpenDue: boolean;
  /**
   * 1.2: open the panel by itself now, when it is due: records `auto_shown`
   * for each new note and remembers the return in this browser, so it
   * opens once. False when it is not due.
   */
  openAuto(): boolean;
  /** 1.2: the panel is open by itself. */
  autoOpened: boolean;
  /** 1.2: the keys of the notes that were new when it opened by itself (first in the panel). */
  fresh: string[];
  /** 1.2: the person closed the panel that opened by itself. */
  closeAuto(): void;
};

function readDay(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeDay(key: string, day: string) {
  try {
    window.localStorage.setItem(key, day);
  } catch {
    /* the server's receipt still says it */
  }
}

/** What's new for a host's Help menu: the list, its badge, the day's toast, and the receipts. */
export function useWhatsNew({
  client,
  person,
  toast: toastOn = true,
  enabled = true,
  now = () => new Date(),
  prefix = "zavon.whatsnew:",
  autoOpen = false,
}: UseWhatsNewOptions): WhatsNew {
  const [feed, setFeed] = useState<AnnouncementFeed | null>(null);
  const [toast, setToast] = useState<AnnouncementItem | null>(null);
  const [autoOpened, setAutoOpened] = useState(false);
  const [fresh, setFresh] = useState<string[]>([]);
  // The return this page decided on, once: the feed's last visit when the
  // rule held at its first load, or null.
  const [due, setDue] = useState<string | null>(null);
  const decided = useRef(false);
  const autoKey = `${prefix}autoopen:${person ?? ""}`;
  const started = useRef<Map<string, string>>(new Map());
  const nowRef = useRef(now);
  nowRef.current = now;
  const dayKey = `${prefix}toastday:${person ?? ""}`;

  const refresh = useCallback(async () => {
    if (!client || !person || !enabled) return;
    const f = await client.list();
    if (f) setFeed(f);
  }, [client, person, enabled]);

  useEffect(() => {
    setFeed(null);
    setToast(null);
    setDue(null);
    setAutoOpened(false);
    decided.current = false;
    dueRef.current = null;
    void refresh();
  }, [refresh]);

  // One effect, so the return is decided before the toast is:
  //
  // A return, decided once per page — the first time the feed is in and the
  // host allows opening (an editor first, then a list screen, still opens):
  // the rule holds and this browser has not opened for this return already
  // (a receipt that could not be sent must not open it twice).
  //
  // The day's toast, once: recorded at once, so another page or product
  // does not show it again today. Never beside a panel due to open.
  const toasted = useRef(false);
  const dueRef = useRef<string | null>(null);
  useEffect(() => {
    if (!feed) return;
    if (autoOpen && !decided.current) {
      decided.current = true;
      const last = feed.last_seen_at ?? null;
      if (last && shouldAutoOpen(last, nowRef.current(), feed.auto_open_days ?? 0, feed.items) && readDay(autoKey) !== last) {
        dueRef.current = last;
        setDue(last);
      }
    }
    if (!toastOn || toasted.current || !client || dueRef.current !== null) return;
    const pick = toastCandidate(feed, nowRef.current(), readDay(dayKey));
    if (!pick) return;
    toasted.current = true;
    setToast(pick);
    writeDay(dayKey, localDay(nowRef.current()));
    void client.receipt(pick.key, "toasted");
  }, [feed, toastOn, client, dayKey, autoOpen, autoKey]);

  const stamp = useCallback(
    (key: string, field: keyof AnnouncementItem) =>
      setFeed((f) => (f ? { ...f, items: f.items.map((i) => (i.key === key && !i[field] ? { ...i, [field]: nowRef.current().toISOString() } : i)) } : f)),
    [],
  );

  const markShown = useCallback(() => {
    if (!feed || !client) return;
    const fresh = feed.items.filter((i) => !i.shown_at);
    if (fresh.length === 0) return;
    const at = nowRef.current().toISOString();
    setFeed({ ...feed, unseen: 0, items: feed.items.map((i) => (i.shown_at ? i : { ...i, shown_at: at })) });
    for (const i of fresh) void client.receipt(i.key, "shown");
  }, [feed, client]);

  const dismiss = useCallback(
    (key: string) => {
      setFeed((f) => (f ? { ...f, unseen: f.items.filter((i) => i.key !== key && !i.shown_at).length, items: f.items.filter((i) => i.key !== key) } : f));
      setToast((t) => (t?.key === key ? null : t));
      void client?.receipt(key, "dismissed");
    },
    [client],
  );

  const opened = useCallback(
    (key: string) => {
      stamp(key, "opened_at");
      void client?.receipt(key, "opened");
    },
    [client, stamp],
  );

  const showMe = useCallback(
    (key: string) => {
      const item = feed?.items.find((i) => i.key === key);
      if (!item?.tour_id) return null;
      started.current.set(item.tour_id, key);
      stamp(key, "tour_started_at");
      setToast((t) => (t?.key === key ? null : t));
      void client?.receipt(key, "tour_started");
      return item.tour_id;
    },
    [feed, client, stamp],
  );

  const tourClosed = useCallback(
    (tour: string, reason: string) => {
      const key = started.current.get(tour);
      if (!key) return;
      started.current.delete(tour);
      if (reason !== "completed") return;
      stamp(key, "completed_tour_at");
      void client?.receipt(key, "tour_completed");
    },
    [client, stamp],
  );

  const dismissToast = useCallback(() => setToast(null), []);

  const autoOpenDue = autoOpen && due !== null && !autoOpened;

  const openAuto = useCallback(() => {
    if (!autoOpenDue || !feed || !client || due === null) return false;
    const items = freshSince(due, feed.items);
    if (items.length === 0) return false;
    const at = nowRef.current().toISOString();
    writeDay(autoKey, due);
    // This page's toast is spent too: the panel says it all.
    toasted.current = true;
    setDue(null);
    setFresh(items.map((i) => i.key));
    setAutoOpened(true);
    setToast(null);
    const keys = new Set(items.map((i) => i.key));
    setFeed((f) => (f ? { ...f, items: f.items.map((i) => (keys.has(i.key) && !i.auto_shown_at ? { ...i, auto_shown_at: at } : i)) } : f));
    for (const i of items) void client.receipt(i.key, "auto_shown");
    return true;
  }, [autoOpenDue, feed, client, due, autoKey]);

  const closeAuto = useCallback(() => setAutoOpened(false), []);

  return useMemo(
    () => ({
      items: feed?.items ?? [],
      unseen: feed?.unseen ?? 0,
      loaded: feed !== null,
      toast,
      refresh,
      markShown,
      dismiss,
      opened,
      showMe,
      tourClosed,
      dismissToast,
      autoOpenDue,
      openAuto,
      autoOpened,
      fresh,
      closeAuto,
    }),
    [feed, toast, refresh, markShown, dismiss, opened, showMe, tourClosed, dismissToast, autoOpenDue, openAuto, autoOpened, fresh, closeAuto],
  );
}

/**
 * One What's new per page: the host calls `useWhatsNew` once and provides it
 * here, so the badge, the panel and the toast draw from the same state.
 */
export const WhatsNewContext = createContext<WhatsNew | null>(null);

/** The page's What's new, or null outside a provider (a render test, say). */
export function useWhatsNewContext(): WhatsNew | null {
  return useContext(WhatsNewContext);
}

export type AutoOpenWhatsNew = {
  /** The panel is open by itself: draw it. */
  open: boolean;
  /** The keys new since the last visit: first, then an "Earlier" divider. */
  fresh: string[];
  /** Closing it counts as seen; it does not open again for this return. */
  close(): void;
};

/**
 * 1.2: the panel that opens by itself, for a host to draw. Call it inside
 * both `TourProvider` and `WhatsNewContext`. It opens once the page's What's
 * new is due (`useWhatsNew({ autoOpen: true })`) and no tour is on screen —
 * and never on a page that started with the first-run tour unfinished or on
 * screen: the tour comes first, the notes on a later visit.
 */
export function useAutoOpenWhatsNew({ mainTour }: { mainTour?: string } = {}): AutoOpenWhatsNew {
  const wn = useWhatsNewContext();
  const tours = useTours();
  const seen = mainTour ? tours.seen(mainTour) : true;
  // Latched: once a tour has been on screen, or the first-run tour was
  // found unfinished, nothing opens on this page.
  const blocked = useRef(false);
  if (tours.active !== null || seen === false) blocked.current = true;
  const due = wn?.autoOpenDue ?? false;
  const openAuto = wn?.openAuto;
  useEffect(() => {
    if (!due || !openAuto || blocked.current) return;
    if (tours.active !== null || seen !== true) return;
    openAuto();
  }, [due, openAuto, tours.active, seen]);
  const closeAuto = wn?.closeAuto;
  const close = useCallback(() => closeAuto?.(), [closeAuto]);
  return { open: !!wn?.autoOpened, fresh: wn?.fresh ?? [], close };
}
