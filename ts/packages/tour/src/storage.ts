// Where "has this person seen this tour" lives.
//
// The stores here hold no network code. A host that keeps the answer on a
// server either passes its own store whose `get` and `set` call it (with
// `localStorageStore` behind it through `fallbackStore`), or uses
// `createServerTourStore` (serverStore.ts), which takes the host's `fetch`
// and names no service.

export type TourRecord = {
  /** `completed`: the last step's Done; `dismissed`: Skip, Escape or the close button. */
  status: "completed" | "dismissed";
  /** The tour's version when it was recorded. */
  version: number;
  /** ISO 8601. */
  at: string;
  /** The step showing when it was dismissed (0-based). */
  step?: number;
};

/**
 * What the provider knows about a record it reads or writes (1.1): which
 * tour, at which version, for whom. A store that files records by `key`
 * alone (localStorage, memory) ignores it; a server store needs it, since a
 * key is a string and a tour id may itself hold a ":".
 */
export type TourStoreContext = {
  tour: string;
  version: number;
  person: string;
  scope?: string;
};

/** Something that happened on one step, for a store that keeps a history (1.1). */
export type TourStepAction = "shown" | "next" | "back" | "completed" | "skipped";

export type TourStepEvent = {
  action: TourStepAction;
  /** The step's id and its place in the tour (0-based). */
  step: string;
  index: number;
  /** ISO 8601. */
  at: string;
};

export type TourStore = {
  get(key: string, ctx?: TourStoreContext): Promise<TourRecord | null>;
  set(key: string, record: TourRecord, ctx?: TourStoreContext): Promise<void>;
  /** Optional (1.1): each step event as it happens. */
  event?(event: TourStepEvent, ctx: TourStoreContext): void | Promise<void>;
  /** Optional (1.1): "Restart tour" — forget the record, so the tour counts as not seen. */
  reset?(key: string, ctx: TourStoreContext): Promise<void>;
};

/** The key a record is filed under: one per tour, per person, per product. */
export function tourKey(parts: { tour: string; person: string; scope?: string }): string {
  return [parts.scope, parts.person, parts.tour].filter(Boolean).join(":");
}

function parse(raw: unknown): TourRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<TourRecord>;
  if (r.status !== "completed" && r.status !== "dismissed") return null;
  return {
    status: r.status,
    version: typeof r.version === "number" ? r.version : 1,
    at: typeof r.at === "string" ? r.at : "",
    ...(typeof r.step === "number" ? { step: r.step } : {}),
  };
}

/** Read a stored value as a record, or null when it is not one. Exported for hosts' server stores. */
export const readRecord = parse;

/**
 * The browser's localStorage, under `prefix`. Never throws: storage that is
 * blocked, full or absent reads as nothing and writes as nothing.
 */
export function localStorageStore(prefix = "tour:"): TourStore {
  const storage = (): Storage | null => {
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return null;
    }
  };
  return {
    async get(key) {
      try {
        const raw = storage()?.getItem(prefix + key);
        return raw ? parse(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    },
    async set(key, record) {
      try {
        storage()?.setItem(prefix + key, JSON.stringify(record));
      } catch {
        /* blocked or full: the tour simply shows again next time */
      }
    },
    async reset(key) {
      try {
        storage()?.removeItem(prefix + key);
      } catch {
        /* nothing stored, nothing to forget */
      }
    },
  };
}

/** A store in memory, for tests and for pages that must not remember. */
export function memoryStore(initial: Record<string, TourRecord> = {}): TourStore {
  const m = new Map(Object.entries(initial));
  return {
    async get(key) {
      return m.get(key) ?? null;
    },
    async set(key, record) {
      m.set(key, record);
    },
    async reset(key) {
      m.delete(key);
    },
  };
}

/**
 * `primary` first (a host's server), `secondary` (local) when it fails or has
 * nothing. A write goes to both; the primary's failure is swallowed, since
 * the secondary already holds the answer for this device.
 */
export function fallbackStore(primary: TourStore, secondary: TourStore): TourStore {
  return {
    async get(key, ctx) {
      try {
        const r = await primary.get(key, ctx);
        if (r) return r;
      } catch {
        /* fall through to the device's copy */
      }
      return secondary.get(key, ctx);
    },
    async set(key, record, ctx) {
      await secondary.set(key, record, ctx);
      try {
        await primary.set(key, record, ctx);
      } catch {
        /* kept locally */
      }
    },
    event(event, ctx) {
      try {
        return primary.event?.(event, ctx);
      } catch {
        /* history is best effort */
      }
    },
    async reset(key, ctx) {
      await secondary.reset?.(key, ctx);
      await primary.reset?.(key, ctx);
    },
  };
}

/** Whether a record means the tour (at `version`) has been seen: finished, at that version or later. */
export function isSeen(record: TourRecord | null, version = 1): boolean {
  return !!record && (record.status === "completed" || record.status === "dismissed") && record.version >= version;
}
