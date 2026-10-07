// Where "has this person seen this tour" lives.
//
// The package holds no fetch code: a host that keeps the answer on its own
// server passes a store whose `get` and `set` call it, and puts
// `localStorageStore` behind it with `fallbackStore` so a failed request
// neither replays the tour nor loses the answer.

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

export type TourStore = {
  get(key: string): Promise<TourRecord | null>;
  set(key: string, record: TourRecord): Promise<void>;
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
  };
}

/**
 * `primary` first (a host's server), `secondary` (local) when it fails or has
 * nothing. A write goes to both; the primary's failure is swallowed, since
 * the secondary already holds the answer for this device.
 */
export function fallbackStore(primary: TourStore, secondary: TourStore): TourStore {
  return {
    async get(key) {
      try {
        const r = await primary.get(key);
        if (r) return r;
      } catch {
        /* fall through to the device's copy */
      }
      return secondary.get(key);
    },
    async set(key, record) {
      await secondary.set(key, record);
      try {
        await primary.set(key, record);
      } catch {
        /* kept locally */
      }
    },
  };
}

/** Whether a record means the tour (at `version`) has been seen. */
export function isSeen(record: TourRecord | null, version = 1): boolean {
  return !!record && record.version >= version;
}
