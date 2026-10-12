import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { TourProvider, useTours } from "./TourProvider.js";
import { memoryStore, tourKey } from "./storage.js";
import {
  createAnnouncementsClient,
  freshSince,
  shouldAutoOpen,
  useAutoOpenWhatsNew,
  useWhatsNew,
  WhatsNewContext,
  type AnnouncementFeed,
  type AnnouncementItem,
} from "./announcements.js";
import type { Tour } from "./tour.js";

/**
 * 1.2: What's new opens by itself for a returning person — the rule, held to
 * contract/whatsnew/auto_open.json, the hook's once-per-return state and
 * receipts, and the provider-side gate (no tour on screen, the first-run
 * tour finished).
 */

type Vector = {
  now: string;
  items: Record<string, { key: string; published_at: string; auto_shown_at?: string }>;
  cases: { name: string; last_seen_at: string | null; min_days: number; items: string[]; open: boolean; fresh: string[] }[];
};
const vectors = JSON.parse(readFileSync(join(__dirname, "../../../../contract/whatsnew/auto_open.json"), "utf8")) as Vector;

describe("shouldAutoOpen and freshSince (contract/whatsnew/auto_open.json)", () => {
  test("there are vectors", () => {
    expect(vectors.cases.length).toBeGreaterThanOrEqual(15);
  });
  for (const c of vectors.cases) {
    test(c.name, () => {
      const items = c.items.map((k) => vectors.items[k]);
      expect(shouldAutoOpen(c.last_seen_at, new Date(vectors.now), c.min_days, items)).toBe(c.open);
      expect(freshSince(c.last_seen_at, items).map((i) => i.key)).toEqual(c.fresh);
    });
  }
  test("an undefined last visit and a minimum that is not a number never open", () => {
    const items = [vectors.items["new-a"]];
    expect(shouldAutoOpen(undefined, new Date(vectors.now), 7, items)).toBe(false);
    expect(shouldAutoOpen("2026-01-01T00:00:00Z", new Date(vectors.now), Number.NaN, items)).toBe(false);
    expect(shouldAutoOpen("2026-01-01T00:00:00Z", new Date(vectors.now), Number.POSITIVE_INFINITY, items)).toBe(false);
  });
});

const NOW = new Date("2026-10-12T09:00:00Z");
const AWAY = "2026-10-01T09:00:00Z";

const item = (key: string, published_at: string, extra: Partial<AnnouncementItem> = {}): AnnouncementItem => ({
  key,
  app: "app",
  title: key,
  body: "Body.",
  big: false,
  published_at,
  ...extra,
});

function feedServer(feed: AnnouncementFeed) {
  const calls: { url: string; method: string; body?: { action?: string } }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (!init?.method) return new Response(JSON.stringify(feed), { status: 200 });
    return new Response("{}", { status: 200 });
  };
  const receipts = (action: string) => calls.filter((c) => c.body?.action === action).map((c) => decodeURIComponent(c.url.split("/announcements/")[1].split("/")[0]));
  return { calls, fetch, receipts };
}

const returning = (extra: Partial<AnnouncementFeed> = {}): AnnouncementFeed => ({
  items: [item("new-a", "2026-10-10T08:00:00Z", { big: true }), item("new-b", "2026-10-05T08:00:00Z"), item("old", "2026-09-20T08:00:00Z")],
  unseen: 3,
  last_seen_at: AWAY,
  auto_open_days: 7,
  ...extra,
});

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("the client (1.2)", () => {
  test("passes the last visit and the setting through", async () => {
    const s = feedServer(returning());
    const c = createAnnouncementsClient({ fetch: s.fetch, endpoint: "https://e.example/api/me", app: "app" });
    const f = await c.list();
    expect(f?.last_seen_at).toBe(AWAY);
    expect(f?.auto_open_days).toBe(7);
  });

  test("an older server without them answers null and 0, so nothing opens", async () => {
    const s = feedServer({ items: [item("a", "2026-10-10T08:00:00Z")], unseen: 1 });
    const f = await createAnnouncementsClient({ fetch: s.fetch, endpoint: "https://e.example/api/me", app: "app" }).list();
    expect(f?.last_seen_at).toBeNull();
    expect(f?.auto_open_days).toBe(0);
  });

  test("posts an auto_shown receipt", async () => {
    const s = feedServer(returning());
    await createAnnouncementsClient({ fetch: s.fetch, endpoint: "https://e.example/api/me", app: "app" }).receipt("new-a", "auto_shown");
    expect(s.receipts("auto_shown")).toEqual(["new-a"]);
  });
});

describe("useWhatsNew({ autoOpen }) (1.2)", () => {
  const client = (feed: AnnouncementFeed) => {
    const s = feedServer(feed);
    return { s, client: createAnnouncementsClient({ fetch: s.fetch, endpoint: "https://e.example/api/me", app: "app" }) };
  };

  test("off by default: never due, and the day's toast is as before", async () => {
    const { client: c } = client(returning());
    const { result } = renderHook(() => useWhatsNew({ client: c, person: "acct-1", now: () => NOW }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.autoOpenDue).toBe(false);
    expect(result.current.openAuto()).toBe(false);
    await waitFor(() => expect(result.current.toast?.key).toBe("new-a"));
  });

  test("due after an absence; opening records auto_shown for the new notes only, once", async () => {
    const { s, client: c } = client(returning());
    const { result } = renderHook(() => useWhatsNew({ client: c, person: "acct-1", now: () => NOW, autoOpen: true }));
    await waitFor(() => expect(result.current.autoOpenDue).toBe(true));
    // The panel is coming: no toast beside it.
    expect(result.current.toast).toBeNull();
    let opened = false;
    act(() => void (opened = result.current.openAuto()));
    expect(opened).toBe(true);
    expect(result.current.autoOpened).toBe(true);
    expect(result.current.autoOpenDue).toBe(false);
    expect(result.current.fresh).toEqual(["new-a", "new-b"]);
    await waitFor(() => expect(s.receipts("auto_shown").sort()).toEqual(["new-a", "new-b"]));
    expect(result.current.items.find((i) => i.key === "new-a")?.auto_shown_at).toBeTruthy();
    expect(result.current.items.find((i) => i.key === "old")?.auto_shown_at).toBeUndefined();
    expect(result.current.toast).toBeNull();
    // Once: a second call does nothing; closing keeps the order for the menu.
    act(() => void (opened = result.current.openAuto()));
    expect(opened).toBe(false);
    act(() => result.current.closeAuto());
    expect(result.current.autoOpened).toBe(false);
    expect(s.receipts("auto_shown")).toHaveLength(2);
    expect(s.receipts("toasted")).toHaveLength(0);
  });

  test("once per return: a reload with the same last visit does not open again, a new return does", async () => {
    const { client: c } = client(returning());
    const first = renderHook(() => useWhatsNew({ client: c, person: "acct-1", now: () => NOW, autoOpen: true }));
    await waitFor(() => expect(first.result.current.autoOpenDue).toBe(true));
    act(() => void first.result.current.openAuto());
    first.unmount();

    // The receipt was lost, so the server still answers the same return.
    const again = renderHook(() => useWhatsNew({ client: c, person: "acct-1", now: () => NOW, autoOpen: true }));
    await waitFor(() => expect(again.result.current.loaded).toBe(true));
    expect(again.result.current.autoOpenDue).toBe(false);
    again.unmount();

    // Somebody else on this browser has their own return.
    const other = renderHook(() => useWhatsNew({ client: c, person: "acct-2", now: () => NOW, autoOpen: true }));
    await waitFor(() => expect(other.result.current.autoOpenDue).toBe(true));
    other.unmount();

    // A later return of the first person opens again.
    const { client: later } = client(returning({ last_seen_at: "2026-10-02T09:00:00Z" }));
    const next = renderHook(() => useWhatsNew({ client: later, person: "acct-1", now: () => NOW, autoOpen: true }));
    await waitFor(() => expect(next.result.current.autoOpenDue).toBe(true));
  });

  test("not due without an absence, without anything new, or with the setting off", async () => {
    for (const feed of [
      returning({ last_seen_at: "2026-10-09T09:00:00Z" }),
      returning({ items: [item("old", "2026-09-20T08:00:00Z")] }),
      returning({ auto_open_days: 0 }),
      returning({ last_seen_at: null }),
    ]) {
      const { client: c } = client(feed);
      const { result, unmount } = renderHook(() => useWhatsNew({ client: c, person: "acct-1", now: () => NOW, autoOpen: true }));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      expect(result.current.autoOpenDue).toBe(false);
      unmount();
    }
  });

  test("an editor first, then a list screen: the return still opens there", async () => {
    const { client: c } = client(returning());
    let allowed = false;
    const { result, rerender } = renderHook(() => useWhatsNew({ client: c, person: "acct-1", now: () => NOW, autoOpen: allowed, toast: false }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.autoOpenDue).toBe(false);
    allowed = true;
    rerender();
    await waitFor(() => expect(result.current.autoOpenDue).toBe(true));
  });
});

const firstRun: Tour = { id: "first-run", steps: [{ id: "one", target: "a", title: "Welcome", body: "Start here." }] };
// One array for every render: the provider reloads what it knows when its tours change.
const TOURS = [firstRun];

function Panel() {
  const auto = useAutoOpenWhatsNew({ mainTour: "first-run" });
  const { active } = useTours();
  return (
    <div>
      <span data-testid="active">{String(active)}</span>
      {auto.open && (
        <div role="dialog" aria-label="What’s new">
          <span data-testid="fresh">{auto.fresh.join(",")}</span>
          <button type="button" onClick={auto.close}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

function Host({ feed, finished }: { feed: AnnouncementFeed; finished: boolean }) {
  const s = feedServer(feed);
  const client = createAnnouncementsClient({ fetch: s.fetch, endpoint: "https://e.example/api/me", app: "app" });
  const store = memoryStore(finished ? { [tourKey({ tour: "first-run", person: "acct-1", scope: "app" })]: { status: "completed", version: 1, at: "2026-01-01T00:00:00Z" } } : {});
  return <Inner client={client} store={store} />;
}

function Inner({ client, store }: { client: ReturnType<typeof createAnnouncementsClient>; store: ReturnType<typeof memoryStore> }) {
  const wn = useWhatsNew({ client, person: "acct-1", now: () => NOW, autoOpen: true, toast: false });
  return (
    <WhatsNewContext.Provider value={wn}>
      <TourProvider tours={TOURS} person="acct-1" scope="app" store={store} autoStart="first-run" autoStartDelay={0}>
        <button type="button" data-tour="a">
          A
        </button>
        <Panel />
      </TourProvider>
    </WhatsNewContext.Provider>
  );
}

describe("useAutoOpenWhatsNew (1.2)", () => {
  test("opens for a returning person who finished the first-run tour, new notes first", async () => {
    render(<Host feed={returning()} finished />);
    expect(await screen.findByRole("dialog", { name: "What’s new" })).toBeInTheDocument();
    expect(screen.getByTestId("fresh").textContent).toBe("new-a,new-b");
    act(() => screen.getByRole("button", { name: "Close" }).click());
    expect(screen.queryByRole("dialog", { name: "What’s new" })).toBeNull();
  });

  test("the first-run tour comes first: nothing opens on that page", async () => {
    render(<Host feed={returning()} finished={false} />);
    expect(await screen.findByRole("dialog", { name: "Welcome" })).toBeInTheDocument();
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(screen.queryByRole("dialog", { name: "What’s new" })).toBeNull();
  });

  test("outside a provider it is closed and harmless", () => {
    const { result } = renderHook(() => useAutoOpenWhatsNew());
    expect(result.current.open).toBe(false);
    expect(result.current.fresh).toEqual([]);
    expect(() => result.current.close()).not.toThrow();
  });
});
