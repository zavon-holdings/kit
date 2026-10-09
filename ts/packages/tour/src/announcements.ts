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
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

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
};

export type AnnouncementFeed = {
  items: AnnouncementItem[];
  /** Items never listed in an open panel: the badge. */
  unseen: number;
  /** The person's latest toast in any product, so there is at most one a day. */
  last_toasted_at?: string | null;
};

export type ReceiptAction = "shown" | "toasted" | "opened" | "tour_started" | "tour_completed" | "dismissed";

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
        return { items, unseen: typeof body.unseen === "number" ? body.unseen : items.filter((i) => !i.shown_at).length, last_toasted_at: body.last_toasted_at ?? null };
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
export function useWhatsNew({ client, person, toast: toastOn = true, enabled = true, now = () => new Date(), prefix = "zavon.whatsnew:" }: UseWhatsNewOptions): WhatsNew {
  const [feed, setFeed] = useState<AnnouncementFeed | null>(null);
  const [toast, setToast] = useState<AnnouncementItem | null>(null);
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
    void refresh();
  }, [refresh]);

  // The day's toast, once: recorded at once, so another page or product
  // does not show it again today.
  const toasted = useRef(false);
  useEffect(() => {
    if (!feed || !toastOn || toasted.current || !client) return;
    const pick = toastCandidate(feed, nowRef.current(), readDay(dayKey));
    if (!pick) return;
    toasted.current = true;
    setToast(pick);
    writeDay(dayKey, localDay(nowRef.current()));
    void client.receipt(pick.key, "toasted");
  }, [feed, toastOn, client, dayKey]);

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
    }),
    [feed, toast, refresh, markShown, dismiss, opened, showMe, tourClosed, dismissToast],
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
