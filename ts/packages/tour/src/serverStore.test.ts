import { afterEach, describe, expect, test, vi } from "vitest";
import { createServerTourStore, recordFromProgress, type ServerProgress, type ServerTourStore } from "./serverStore.js";
import { isSeen, localStorageStore, tourKey, type TourStoreContext } from "./storage.js";

/**
 * A server in memory that speaks the store's wire: progress per person (the
 * credential decides who, as on the real one), status only moving up, writes
 * stamped with an old reset count ignored, events once by id.
 */
function fakeServer() {
  const state = { online: true, status: 0 as number, who: "acct-a" };
  const progress = new Map<string, Map<string, ServerProgress>>();
  const events = new Map<string, Record<string, unknown>[]>();
  const calls: { method: string; path: string; body?: unknown; keepalive?: boolean; who: string }[] = [];
  const rank = { not_started: 0, in_progress: 1, skipped: 2, completed: 3 } as const;
  const mine = () => {
    if (!progress.has(state.who)) progress.set(state.who, new Map());
    return progress.get(state.who)!;
  };
  const apply = (tour: string, status: ServerProgress["status"], step: number, gen: unknown, version = 1) => {
    const m = mine();
    const p = m.get(tour) ?? { tour, version, status: "not_started", resets: 0 };
    if (typeof gen === "number" && gen < (p.resets ?? 0)) return p;
    const next = { ...p, step, status: rank[status] > rank[p.status] ? status : p.status };
    if (status === "completed") next.completed_at ??= new Date().toISOString();
    m.set(tour, next);
    return next;
  };
  const json = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { "Content-Type": "application/json" } });
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: u.pathname + u.search, body, keepalive: init?.keepalive, who: state.who });
    if (!state.online) throw new TypeError("Failed to fetch");
    if (state.status) return json(state.status, { error: "refused" });
    const parts = u.pathname.replace(/^\/api\/me\//, "").split("/");
    if (method === "GET" && parts[0] === "tours") return json(200, { app: u.searchParams.get("app"), tours: [...mine().values()] });
    if (method === "PUT") return json(200, apply(parts[2], body.status, body.step ?? 0, body.gen, body.version));
    if (method === "DELETE") {
      const p = mine().get(parts[2]);
      if (p) mine().set(parts[2], { ...p, status: "not_started", completed_at: null, resets: (p.resets ?? 0) + 1 });
      return json(200, { reset: !!p });
    }
    if (method === "POST" && parts[2] === "events") {
      const seen = events.get(state.who) ?? [];
      let accepted = 0;
      for (const e of body.events) {
        if (seen.some((x) => x.id === e.id)) continue;
        seen.push(e);
        accepted++;
        apply(e.tour, e.action === "completed" ? "completed" : e.action === "skipped" ? "skipped" : "in_progress", e.index, e.gen, e.version);
      }
      events.set(state.who, seen);
      return json(200, { accepted });
    }
    return json(404, {});
  });
  return { state, progress, events, calls, fetch };
}

const ctx = (person: string, tour = "first-run", version = 1): TourStoreContext => ({ person, tour, version, scope: "app" });
const key = (c: TourStoreContext) => tourKey({ tour: c.tour, person: c.person, scope: c.scope });
const stores: ServerTourStore[] = [];
function make(server: ReturnType<typeof fakeServer>, extra: Partial<Parameters<typeof createServerTourStore>[0]> = {}) {
  let n = 0;
  const s = createServerTourStore({
    fetch: server.fetch,
    endpoint: "https://login.example.org/api/me/",
    app: "app",
    retryDelay: 20,
    maxDelay: 80,
    batchDelay: 5,
    newId: () => `evt-${String(++n).padStart(6, "0")}`,
    ...extra,
  });
  stores.push(s);
  return s;
}
const until = async (f: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};

afterEach(() => {
  while (stores.length) stores.pop()!.dispose();
});

describe("a server-backed tour store", () => {
  test("reads the server once per person, and only finished tours count as seen", async () => {
    const server = fakeServer();
    server.progress.set("acct-a", new Map([
      ["first-run", { tour: "first-run", version: 1, status: "completed", completed_at: "2026-10-01T10:00:00Z" }],
      ["screen", { tour: "screen", version: 1, status: "in_progress", step: 2 }],
    ]));
    const store = make(server);
    const [a, b, c] = await Promise.all([store.get("k", ctx("acct-a")), store.get("k", ctx("acct-a", "screen")), store.get("k", ctx("acct-a", "never"))]);
    expect(a).toMatchObject({ status: "completed", version: 1 });
    expect(isSeen(a)).toBe(true);
    // In progress is not seen: a tour left half-way may start again.
    expect(b).toBeNull();
    expect(c).toBeNull();
    expect(server.calls.filter((x) => x.method === "GET")).toHaveLength(1);
    expect(server.calls[0].path).toBe("/api/me/tours?app=app");
  });

  test("a skipped tour reads as dismissed; an older version is not seen at a newer one", async () => {
    expect(recordFromProgress({ tour: "t", version: 2, status: "skipped", step: 3 })).toMatchObject({ status: "dismissed", version: 2, step: 3 });
    expect(isSeen(recordFromProgress({ tour: "t", version: 1, status: "completed" }), 2)).toBe(false);
    expect(recordFromProgress({ tour: "t", version: 1, status: "not_started" })).toBeNull();
  });

  test("writes through to the server, and step events go in batches with ids, once", async () => {
    const server = fakeServer();
    const store = make(server);
    const c = ctx("acct-a");
    await store.get(key(c), c);
    store.event({ action: "shown", step: "hello", index: 0, at: new Date().toISOString() }, c);
    store.event({ action: "next", step: "hello", index: 0, at: new Date().toISOString() }, c);
    store.event({ action: "shown", step: "list", index: 1, at: new Date().toISOString() }, c);
    await until(() => store.pending("acct-a") === 0);
    const posts = server.calls.filter((x) => x.method === "POST");
    expect(posts).toHaveLength(1);
    const sent = (posts[0].body as { events: { id: string; action: string; tour: string; gen?: number }[] }).events;
    expect(sent.map((e) => e.action)).toEqual(["shown", "next", "shown"]);
    expect(new Set(sent.map((e) => e.id)).size).toBe(3);
    expect(sent[0]).toMatchObject({ tour: "first-run", gen: 0 });
    await store.set(key(c), { status: "completed", version: 1, at: "2026-10-09T09:00:00.000Z" }, c);
    await until(() => store.pending("acct-a") === 0);
    expect(server.progress.get("acct-a")!.get("first-run")!.status).toBe("completed");
    expect(server.calls.find((x) => x.method === "PUT")!.path).toBe("/api/me/tours/app/first-run");
  });

  test("offline: the answer is kept here, the queue survives a reload, and it is sent when the server answers", async () => {
    const server = fakeServer();
    server.state.online = false;
    const store = make(server);
    const c = ctx("acct-a");
    expect(await store.get(key(c), c)).toBeNull();
    await store.set(key(c), { status: "dismissed", version: 1, at: "2026-10-09T09:00:00.000Z", step: 2 }, c);
    store.event({ action: "skipped", step: "list", index: 2, at: "2026-10-09T09:00:00.000Z" }, c);
    // Seen on this browser at once, server or not.
    expect(isSeen(await store.get(key(c), c))).toBe(true);
    await until(() => server.calls.filter((x) => x.method !== "GET").length >= 2);
    expect(store.pending("acct-a")).toBe(2);
    store.dispose();

    // The page is reloaded while still offline: the queue is still there and
    // the answer still holds.
    const again = make(server);
    expect(isSeen(await again.get(key(c), c))).toBe(true);
    expect(again.pending("acct-a")).toBe(2);
    // The server comes back: the retry (with backoff) sends it.
    server.state.online = true;
    await until(() => again.pending("acct-a") === 0, 3000);
    expect(server.progress.get("acct-a")!.get("first-run")!.status).toBe("skipped");
  });

  test("retries with growing delays, and gives up on nothing", async () => {
    const server = fakeServer();
    const store = make(server);
    const c = ctx("acct-a");
    await store.get(key(c), c);
    server.state.status = 503;
    await store.set(key(c), { status: "completed", version: 1, at: "" }, c);
    await until(() => server.calls.filter((x) => x.method === "PUT").length >= 3, 3000);
    const times = server.calls.filter((x) => x.method === "PUT").length;
    expect(times).toBeGreaterThanOrEqual(3);
    expect(store.pending("acct-a")).toBe(1);
    server.state.status = 0;
    await until(() => store.pending("acct-a") === 0, 3000);
  });

  test("a write refused for good (acting as a role, a bad shape) leaves the queue", async () => {
    const server = fakeServer();
    const store = make(server);
    const c = ctx("acct-a");
    await store.get(key(c), c);
    server.state.status = 403;
    await store.set(key(c), { status: "completed", version: 1, at: "" }, c);
    await until(() => store.pending("acct-a") === 0);
    expect(server.calls.filter((x) => x.method === "PUT")).toHaveLength(1);
  });

  test("two people on one browser never share an answer, a cache or a queue", async () => {
    const server = fakeServer();
    const store = make(server);
    const a = ctx("acct-a");
    await store.get(key(a), a);
    await store.set(key(a), { status: "completed", version: 1, at: "" }, a);
    await until(() => store.pending("acct-a") === 0);
    // B signs in on the same browser (and the server's credential is B's).
    server.state.who = "acct-b";
    const b = ctx("acct-b");
    expect(await store.get(key(b), b)).toBeNull();
    // Offline, B's own cache is used — never A's.
    server.state.online = false;
    const fresh = make(server);
    expect(await fresh.get(key(b), b)).toBeNull();
    expect(isSeen(await fresh.get(key(a), a))).toBe(true);
    // A's steps queued while A was away are not sent with B's credential.
    server.state.online = true;
    server.state.who = "acct-a";
    const third = make(server);
    third.event({ action: "shown", step: "x", index: 0, at: new Date().toISOString() }, a);
    third.dispose();
    server.state.who = "acct-b";
    const fourth = make(server);
    await fourth.get(key(b), b);
    await fourth.flush();
    expect(server.events.get("acct-b") ?? []).toHaveLength(0);
    expect(fourth.pending("acct-a")).toBeGreaterThan(0);
  });

  test("records a pre-1.1 host left in localStorage are sent up once, with their dates", async () => {
    const legacy = localStorageStore("zavon.tour:");
    await legacy.set("app:ama@example.org:first-run", { status: "completed", version: 1, at: "2026-06-01T08:00:00.000Z" });
    await legacy.set("app:ama@example.org:screen", { status: "dismissed", version: 1, at: "2026-06-02T08:00:00.000Z", step: 1 });
    await legacy.set("app:someone@example.org:other", { status: "completed", version: 1, at: "2026-06-03T08:00:00.000Z" });
    const server = fakeServer();
    const store = make(server, { legacy: { prefix: "zavon.tour:", scope: "app", person: "ama@example.org" } });
    const c = ctx("acct-a");
    // Seen at once — nobody who already finished is shown it again.
    expect(isSeen(await store.get(key(c), c))).toBe(true);
    await until(() => store.pending("acct-a") === 0);
    const puts = server.calls.filter((x) => x.method === "PUT");
    expect(puts.map((p) => p.path).sort()).toEqual(["/api/me/tours/app/first-run", "/api/me/tours/app/screen"]);
    expect(puts.find((p) => p.path.endsWith("first-run"))!.body).toMatchObject({ status: "completed", at: "2026-06-01T08:00:00.000Z" });
    expect(puts.find((p) => p.path.endsWith("screen"))!.body).toMatchObject({ status: "skipped", step: 1 });
    // Once: a second store on this browser sends nothing more.
    const again = make(server, { legacy: { prefix: "zavon.tour:", scope: "app", person: "ama@example.org" } });
    await again.get(key(c), c);
    await again.flush();
    expect(server.calls.filter((x) => x.method === "PUT")).toHaveLength(2);
  });

  test("a legacy record is the offline answer for somebody never read on this browser", async () => {
    await localStorageStore("zavon.tour:").set("app:ama@example.org:first-run", { status: "completed", version: 1, at: "2026-06-01T08:00:00.000Z" });
    const server = fakeServer();
    server.state.online = false;
    const store = make(server, { legacy: { prefix: "zavon.tour:", scope: "app", person: "ama@example.org" } });
    expect(isSeen(await store.get("k", ctx("acct-a")))).toBe(true);
  });

  test("Restart tour forgets it here and on the server, and a queued old write cannot finish it again", async () => {
    await localStorageStore("zavon.tour:").set("app:ama@example.org:first-run", { status: "completed", version: 1, at: "2026-06-01T08:00:00.000Z" });
    const server = fakeServer();
    const store = make(server, { legacy: { prefix: "zavon.tour:", scope: "app", person: "ama@example.org" } });
    const c = ctx("acct-a");
    await store.get(key(c), c);
    await until(() => store.pending("acct-a") === 0);
    await store.reset(key(c), c);
    expect(await store.get(key(c), c)).toBeNull();
    expect(server.progress.get("acct-a")!.get("first-run")!).toMatchObject({ status: "not_started", resets: 1 });
    // The old browser record is gone, so no migration brings it back.
    expect(window.localStorage.getItem("zavon.tour:app:ama@example.org:first-run")).toBeNull();
    // A write that was stamped before the restart is ignored by the server…
    await server.fetch("https://login.example.org/api/me/tours/app/first-run", { method: "PUT", body: JSON.stringify({ status: "completed", gen: 0 }) });
    expect(server.progress.get("acct-a")!.get("first-run")!.status).toBe("not_started");
    // …and the store stamps new ones with the new count.
    store.event({ action: "shown", step: "hello", index: 0, at: new Date().toISOString() }, c);
    await until(() => store.pending("acct-a") === 0);
    const last = server.calls.filter((x) => x.method === "POST").pop()!.body as { events: { gen: number }[] };
    expect(last.events[0].gen).toBe(1);
    expect(server.progress.get("acct-a")!.get("first-run")!.status).toBe("in_progress");
  });

  test("hiding the page sends what waits, with keepalive", async () => {
    const server = fakeServer();
    const store = make(server, { batchDelay: 60_000 });
    const c = ctx("acct-a");
    await store.get(key(c), c);
    store.event({ action: "shown", step: "hello", index: 0, at: new Date().toISOString() }, c);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await until(() => store.pending("acct-a") === 0);
    expect(server.calls.filter((x) => x.method === "POST")[0].keepalive).toBe(true);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  test("no person, no records: the store answers nothing and sends nothing", async () => {
    const server = fakeServer();
    const store = make(server);
    expect(await store.get("k", { tour: "first-run", version: 1, person: "" })).toBeNull();
    await store.set("k", { status: "completed", version: 1, at: "" }, { tour: "first-run", version: 1, person: "" });
    expect(await store.get("k")).toBeNull();
    expect(server.calls).toHaveLength(0);
  });
});
