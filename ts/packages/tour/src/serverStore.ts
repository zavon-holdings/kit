// A TourStore kept on a server (1.1): the person's progress in an app's tours
// lives on the host's identity service, so a cleared browser does not replay a
// tour and a shared computer does not hand one person's answer to the next.
//
// The package still names no service and holds no credentials: the host hands
// in a `fetch` that adds its own authorisation (and renews it), and the
// address. The wire it speaks:
//
//   GET    {endpoint}/tours?app=A                → {tours: [ServerProgress]}
//   PUT    {endpoint}/tours/A/T                  {version, status, step, step_id, at, gen?}
//   DELETE {endpoint}/tours/A/T                  restart
//   POST   {endpoint}/tours/A/events             {events: [{id, tour, version, step, index, action, at, gen?}]}
//
// Offline-tolerant:
//   - reads ask the server first and fall back to this browser's copy;
//   - writes go to this browser's copy at once and to the server through a
//     queue kept in localStorage, retried with backoff until it answers, and
//     flushed with `keepalive` as the page is hidden;
//   - everything local is filed under the PERSON (the host's stable account
//     id), so two people taking turns on one browser never share an answer;
//   - the first time a person's progress is read for an app, records a
//     pre-1.1 host left in localStorage under their old key are sent up with
//     their original dates, so nobody who already finished a tour is shown it
//     again.
import { readRecord, type TourRecord, type TourStepEvent, type TourStore, type TourStoreContext } from "./storage.js";

/** One tour's progress as the server holds it. */
export type ServerProgress = {
  tour: string;
  version: number;
  status: "not_started" | "in_progress" | "completed" | "skipped";
  step?: number;
  step_id?: string;
  steps_seen?: string[];
  completed_at?: string | null;
  skipped_at?: string | null;
  updated_at?: string;
  /** How many times the tour was restarted; writes carry it back as `gen`. */
  resets?: number;
};

type QueueItem =
  | { kind: "put"; tour: string; body: Record<string, unknown> }
  | { kind: "delete"; tour: string }
  | { kind: "event"; event: Record<string, unknown> };

export type ServerTourStoreOptions = {
  /** The host's fetch: adds the authorisation and renews it on a 401. */
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** The base the paths above hang off, e.g. "https://login.example.org/api/me". */
  endpoint: string;
  /** The app these tours belong to; the server checks the credential is for it. */
  app: string;
  /**
   * Where a pre-1.1 host kept records in localStorage: its prefix, its
   * `scope`, and the person's OLD key (an email address, say) — read once
   * per person and sent up. Omit when there was nothing before.
   */
  legacy?: { prefix: string; scope?: string; person: string };
  /** Local keys start with this. */
  prefix?: string;
  /** First retry after this long (ms), doubling to `maxDelay`. */
  retryDelay?: number;
  maxDelay?: number;
  /** Events wait this long (ms) to be sent together. */
  batchDelay?: number;
  /** The clock and the id maker, for tests. */
  now?: () => Date;
  newId?: () => string;
  /** This browser's storage; window.localStorage by default. */
  storage?: Storage | null;
};

export type ServerTourStore = TourStore & {
  event(event: TourStepEvent, ctx: TourStoreContext): void;
  reset(key: string, ctx: TourStoreContext): Promise<void>;
  /** Send what is queued now. Resolves when the queue is empty or the server cannot be reached. */
  flush(opts?: { keepalive?: boolean }): Promise<void>;
  /** What is waiting to be sent for a person (tests, a status line). */
  pending(person: string): number;
  /** The server's (or the cached) progress of every tour of the app, or null if neither is known. */
  progress(person: string): Promise<Record<string, ServerProgress> | null>;
  /** Stop the timers and listeners. */
  dispose(): void;
};

const MAX_BATCH = 50;
const MAX_QUEUE = 500;

function defaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function newUuid(): string {
  try {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    /* fall through */
  }
  return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** A server status as the provider's record: finished only. */
export function recordFromProgress(p: ServerProgress | undefined): TourRecord | null {
  if (!p) return null;
  if (p.status === "completed") return { status: "completed", version: p.version || 1, at: p.completed_at ?? p.updated_at ?? "" };
  if (p.status === "skipped")
    return { status: "dismissed", version: p.version || 1, at: p.skipped_at ?? p.updated_at ?? "", ...(typeof p.step === "number" ? { step: p.step } : {}) };
  // In progress or never started: not seen, so it may start by itself.
  return null;
}

/** What a response means for the queue item that caused it. */
function outcome(status: number): "done" | "drop" | "retry" {
  if (status >= 200 && status < 300) return "done";
  // Refused for good — a malformed write, a role being acted, a gone
  // announcement: retrying sends the same thing to the same answer.
  if (status === 400 || status === 403 || status === 404 || status === 409 || status === 413 || status === 422) return "drop";
  // 401 (a token the host could not renew yet), 408, 429, 5xx: later.
  return "retry";
}

export function createServerTourStore(opts: ServerTourStoreOptions): ServerTourStore {
  const prefix = opts.prefix ?? "zavon.tours:";
  const base = opts.endpoint.replace(/\/+$/, "");
  const app = opts.app;
  const now = opts.now ?? (() => new Date());
  const newId = opts.newId ?? newUuid;
  const retryDelay = opts.retryDelay ?? 2000;
  const maxDelay = opts.maxDelay ?? 5 * 60 * 1000;
  const batchDelay = opts.batchDelay ?? 1000;
  const storage = () => (opts.storage !== undefined ? opts.storage : defaultStorage());

  // Per person: the progress known now, and the one request that loads it.
  const known = new Map<string, Record<string, ServerProgress>>();
  const loading = new Map<string, Promise<Record<string, ServerProgress> | null>>();
  // Whose credential the host's fetch carries: the person last named by the
  // provider. Only their queue is ever sent — another person's queued steps
  // wait on this browser until THEY sign in, and are never written into
  // somebody else's account.
  let current: string | null = null;
  const touch = (person: string) => {
    current = person;
  };
  let delay = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushing: Promise<void> | null = null;

  const k = (kind: "cache" | "queue" | "migrated", person: string) => `${prefix}${kind}:${app}:${person}`;

  function readJSON<T>(key: string, fallback: T): T {
    try {
      const raw = storage()?.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }
  function writeJSON(key: string, v: unknown) {
    try {
      storage()?.setItem(key, JSON.stringify(v));
    } catch {
      /* blocked or full: the server still has it, or will */
    }
  }

  const queueOf = (person: string) => readJSON<QueueItem[]>(k("queue", person), []);
  function enqueue(person: string, item: QueueItem) {
    const q = queueOf(person);
    q.push(item);
    // A browser offline for weeks keeps the newest; the oldest steps are the
    // least use and the server's progress already moves only forward.
    writeJSON(k("queue", person), q.slice(-MAX_QUEUE));
  }

  function remember(person: string, map: Record<string, ServerProgress>) {
    known.set(person, map);
    writeJSON(k("cache", person), map);
  }
  function patch(person: string, tour: string, f: (p: ServerProgress) => ServerProgress) {
    const map = { ...(known.get(person) ?? readJSON<Record<string, ServerProgress>>(k("cache", person), {})) };
    map[tour] = f(map[tour] ?? { tour, version: 1, status: "not_started", resets: 0 });
    remember(person, map);
  }

  /** The pre-1.1 records for this person, by tour id. */
  function legacyRecords(): Record<string, TourRecord> {
    const out: Record<string, TourRecord> = {};
    const l = opts.legacy;
    const st = storage();
    if (!l || !l.person || !st) return out;
    const head = l.prefix + [l.scope, l.person].filter(Boolean).join(":") + ":";
    try {
      for (let i = 0; i < st.length; i++) {
        const key = st.key(i);
        if (!key || !key.startsWith(head)) continue;
        const tour = key.slice(head.length);
        const rec = readRecord(JSON.parse(st.getItem(key) ?? "null"));
        if (tour && rec) out[tour] = rec;
      }
    } catch {
      /* unreadable storage: nothing to bring up */
    }
    return out;
  }

  function forgetLegacy(tour: string) {
    const l = opts.legacy;
    if (!l || !l.person) return;
    try {
      storage()?.removeItem(l.prefix + [l.scope, l.person, tour].filter(Boolean).join(":"));
    } catch {
      /* nothing to forget */
    }
  }

  /** Once per person and app: bring the old browser records up. */
  function migrate(person: string, map: Record<string, ServerProgress>) {
    if (readJSON<boolean>(k("migrated", person), false)) return;
    for (const [tour, rec] of Object.entries(legacyRecords())) {
      const have = map[tour];
      if (have && (have.status === "completed" || have.status === "skipped")) continue;
      const status = rec.status === "completed" ? "completed" : "skipped";
      const body = { version: rec.version, status, step: rec.step ?? 0, at: rec.at || now().toISOString() };
      enqueue(person, { kind: "put", tour, body });
      map[tour] = { tour, version: rec.version, status, step: rec.step ?? 0, resets: have?.resets ?? 0, ...(status === "completed" ? { completed_at: rec.at } : { skipped_at: rec.at }) };
    }
    writeJSON(k("migrated", person), true);
    remember(person, map);
    schedule(0);
  }

  /** Apply what is still queued to a map, so an offline answer is not lost. */
  function withPending(person: string, map: Record<string, ServerProgress>): Record<string, ServerProgress> {
    const out = { ...map };
    for (const item of queueOf(person)) {
      if (item.kind === "put") {
        const s = item.body.status as ServerProgress["status"];
        const prev = out[item.tour];
        const rank = { not_started: 0, in_progress: 1, skipped: 2, completed: 3 } as const;
        if (!prev || rank[s] >= rank[prev.status]) out[item.tour] = { ...(prev ?? { tour: item.tour, resets: 0 }), tour: item.tour, version: Number(item.body.version) || 1, status: s };
      } else if (item.kind === "delete") {
        const prev = out[item.tour];
        out[item.tour] = { ...(prev ?? { tour: item.tour, version: 1 }), status: "not_started", resets: (prev?.resets ?? 0) + 1 } as ServerProgress;
      }
    }
    return out;
  }

  function load(person: string): Promise<Record<string, ServerProgress> | null> {
    if (known.has(person)) return Promise.resolve(known.get(person)!);
    const inflight = loading.get(person);
    if (inflight) return inflight;
    const p = (async () => {
      try {
        const res = await opts.fetch(`${base}/tours?app=${encodeURIComponent(app)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { tours?: ServerProgress[] };
        const map: Record<string, ServerProgress> = {};
        for (const t of body.tours ?? []) if (t && typeof t.tour === "string") map[t.tour] = t;
        const merged = withPending(person, map);
        remember(person, merged);
        migrate(person, merged);
        schedule(0);
        return known.get(person)!;
      } catch {
        // The server cannot answer: this browser's copy for THIS person, if
        // any — and what waits to be sent is tried again later.
        if (queueOf(person).length > 0) backoff();
        const cached = readJSON<Record<string, ServerProgress> | null>(k("cache", person), null);
        const pend = queueOf(person).length > 0;
        if (!cached && !pend) {
          // Never read for this person on this browser: the old local
          // records are the best answer there is, and they stay put to be
          // migrated when the server answers.
          const legacy = legacyRecords();
          if (Object.keys(legacy).length === 0) return null;
          const map: Record<string, ServerProgress> = {};
          for (const [tour, rec] of Object.entries(legacy))
            map[tour] = { tour, version: rec.version, status: rec.status === "completed" ? "completed" : "skipped" };
          return map;
        }
        return withPending(person, cached ?? {});
      } finally {
        loading.delete(person);
      }
    })();
    loading.set(person, p);
    return p;
  }

  /** The reset count to stamp a write with: the server's, or 0 for a tour it has no record of; unknown before it answered. */
  function genOf(person: string, tour: string): number | undefined {
    const map = known.get(person);
    if (!map) return undefined;
    const r = map[tour]?.resets;
    return typeof r === "number" ? r : 0;
  }

  function backoff() {
    delay = delay ? Math.min(delay * 2, maxDelay) : retryDelay;
    schedule(delay);
  }

  function schedule(ms: number) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, ms);
  }

  async function send(person: string, keepalive: boolean): Promise<"empty" | "retry"> {
    for (;;) {
      const q = queueOf(person);
      if (q.length === 0) return "empty";
      const head = q[0];
      let n = 1;
      let res: Response;
      try {
        if (head.kind === "event") {
          while (n < q.length && n < MAX_BATCH && q[n].kind === "event") n++;
          const events = q.slice(0, n).map((i) => (i as { event: Record<string, unknown> }).event);
          res = await opts.fetch(`${base}/tours/${encodeURIComponent(app)}/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ events }),
            keepalive,
          });
        } else if (head.kind === "put") {
          res = await opts.fetch(`${base}/tours/${encodeURIComponent(app)}/${encodeURIComponent(head.tour)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(head.body),
            keepalive,
          });
        } else {
          res = await opts.fetch(`${base}/tours/${encodeURIComponent(app)}/${encodeURIComponent(head.tour)}`, { method: "DELETE", keepalive });
        }
      } catch {
        return "retry";
      }
      const o = outcome(res.status);
      if (o === "retry") return "retry";
      if (o === "done" && head.kind === "put") {
        try {
          const p = (await res.clone().json()) as ServerProgress;
          if (p && p.tour === head.tour) patch(person, head.tour, (prev) => ({ ...prev, ...p }));
        } catch {
          /* an answer without a body is still a yes */
        }
      }
      // Done or refused for good: either way it leaves the queue. The queue
      // is re-read, since a step may have been added while this was away.
      const now = queueOf(person);
      writeJSON(k("queue", person), now.slice(n));
    }
  }

  function flush(o: { keepalive?: boolean } = {}): Promise<void> {
    if (flushing) return flushing;
    flushing = (async () => {
      let retry = false;
      if (current && (await send(current, !!o.keepalive)) === "retry") retry = true;
      if (retry) backoff();
      else delay = 0;
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  // Leaving or hiding the page: send now, with keepalive, so a closed tab
  // does not keep the last step. Coming back online: send what waited.
  const onHide = () => {
    if (typeof document === "undefined" || document.visibilityState === "hidden") void flush({ keepalive: true });
  };
  const onOnline = () => {
    delay = 0;
    void flush();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", onHide);
    window.addEventListener("online", onOnline);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onHide);
  }

  return {
    async get(_key, ctx) {
      if (!ctx?.person) return null;
      touch(ctx.person);
      const map = await load(ctx.person);
      return recordFromProgress(map?.[ctx.tour]);
    },
    async set(_key, record, ctx) {
      if (!ctx?.person) return;
      touch(ctx.person);
      const status = record.status === "completed" ? "completed" : "skipped";
      const at = record.at || now().toISOString();
      const gen = genOf(ctx.person, ctx.tour);
      patch(ctx.person, ctx.tour, (p) => ({
        ...p,
        version: record.version,
        status: p.status === "completed" ? "completed" : status,
        ...(status === "completed" ? { completed_at: p.completed_at ?? at } : { skipped_at: p.skipped_at ?? at }),
      }));
      enqueue(ctx.person, {
        kind: "put",
        tour: ctx.tour,
        body: { version: record.version, status, step: record.step ?? 0, at, ...(gen !== undefined ? { gen } : {}) },
      });
      schedule(0);
    },
    event(e, ctx) {
      if (!ctx?.person) return;
      touch(ctx.person);
      const gen = genOf(ctx.person, ctx.tour);
      enqueue(ctx.person, {
        kind: "event",
        event: { id: newId(), tour: ctx.tour, version: ctx.version, step: e.step, index: e.index, action: e.action, at: e.at, ...(gen !== undefined ? { gen } : {}) },
      });
      if (e.action !== "completed" && e.action !== "skipped") {
        patch(ctx.person, ctx.tour, (p) => (p.status === "not_started" ? { ...p, status: "in_progress", step: e.index, step_id: e.step } : { ...p, step: e.index, step_id: e.step }));
      }
      schedule(e.action === "completed" || e.action === "skipped" ? 0 : batchDelay);
    },
    async reset(_key, ctx) {
      if (!ctx?.person) return;
      touch(ctx.person);
      // Forget it here at once — this browser's old record included, or the
      // migration would bring the old answer back — then on the server.
      forgetLegacy(ctx.tour);
      patch(ctx.person, ctx.tour, (p) => ({ ...p, status: "not_started", completed_at: null, skipped_at: null, resets: (p.resets ?? 0) + 1 }));
      enqueue(ctx.person, { kind: "delete", tour: ctx.tour });
      await flush();
    },
    flush,
    pending: (person) => queueOf(person).length,
    progress: (person) => {
      touch(person);
      return load(person);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", onHide);
        window.removeEventListener("online", onOnline);
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onHide);
      }
    },
  };
}
