import { describe, expect, test } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TourProvider, useTours } from "./TourProvider.js";
import { memoryStore, tourKey, type TourStepEvent, type TourStore, type TourStoreContext } from "./storage.js";
import { createAnnouncementsClient, localDay, toastCandidate, useWhatsNew, type AnnouncementFeed } from "./announcements.js";
import type { Tour } from "./tour.js";

/**
 * 1.1: the provider reports each step (shown, next, back, completed,
 * skipped) to a store that keeps a history, hands every store the tour's
 * context, and restarts a tour through the store's reset. And What's new:
 * the client, the day's toast, the receipts.
 */

const tour: Tour = {
  id: "first-run",
  version: 2,
  steps: [
    { id: "one", target: "a", title: "First", body: "One." },
    { id: "two", target: "b", title: "Second", body: "Two." },
    { id: "three", target: "c", title: "Third", body: "Three." },
  ],
};

function Page() {
  return (
    <div>
      <button type="button" data-tour="a">A</button>
      <button type="button" data-tour="b">B</button>
      <button type="button" data-tour="c">C</button>
      <Menu />
    </div>
  );
}

function Menu() {
  const { restart, seen } = useTours();
  return (
    <div>
      <button type="button" onClick={() => restart("first-run")}>Restart tour</button>
      <span data-testid="seen">{String(seen("first-run"))}</span>
    </div>
  );
}

/** A memory store that also keeps the events and the contexts it was handed. */
function recordingStore() {
  const inner = memoryStore();
  const events: (TourStepEvent & { tour: string; version: number; person: string })[] = [];
  const contexts: (TourStoreContext | undefined)[] = [];
  const resets: string[] = [];
  const store: TourStore = {
    get: (k, c) => {
      contexts.push(c);
      return inner.get(k);
    },
    set: (k, r, c) => {
      contexts.push(c);
      return inner.set(k, r);
    },
    event: (e, c) => void events.push({ ...e, tour: c.tour, version: c.version, person: c.person }),
    reset: async (k) => {
      resets.push(k);
      await inner.reset!(k, { tour: "", version: 1, person: "" });
    },
  };
  return { store, inner, events, contexts, resets };
}

describe("the provider's step events (1.1)", () => {
  test("shown, next, back and completed, with the tour's context", async () => {
    const user = userEvent.setup();
    const rec = recordingStore();
    render(
      <TourProvider tours={[tour]} person="acct-1" scope="app" store={rec.store} autoStart="first-run" autoStartDelay={0}>
        <Page />
      </TourProvider>,
    );
    await screen.findByRole("dialog", { name: "First" });
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("dialog", { name: "Second" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("dialog", { name: "First" });
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(rec.events.at(-1)?.action).toBe("completed"));
    expect(rec.events.map((e) => `${e.action}:${e.step}`)).toEqual([
      "shown:one",
      "next:one",
      "shown:two",
      "back:two",
      "shown:one",
      "next:one",
      "shown:two",
      "next:two",
      "shown:three",
      "completed:three",
    ]);
    expect(rec.events.every((e) => e.tour === "first-run" && e.version === 2 && e.person === "acct-1")).toBe(true);
    expect(rec.events.every((e) => !Number.isNaN(Date.parse(e.at)))).toBe(true);
    // get and set were told which tour, which version, whose.
    expect(rec.contexts.filter(Boolean).every((c) => c!.tour === "first-run" && c!.version === 2 && c!.person === "acct-1" && c!.scope === "app")).toBe(true);
    expect(await rec.inner.get(tourKey({ scope: "app", person: "acct-1", tour: "first-run" }))).toMatchObject({ status: "completed", version: 2 });
  });

  test("Skip is a skipped event on the step it was pressed", async () => {
    const user = userEvent.setup();
    const rec = recordingStore();
    render(
      <TourProvider tours={[tour]} person="acct-1" store={rec.store} autoStart="first-run" autoStartDelay={0}>
        <Page />
      </TourProvider>,
    );
    await screen.findByRole("dialog", { name: "First" });
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Skip tour" }));
    await waitFor(() => expect(rec.events.at(-1)).toMatchObject({ action: "skipped", step: "two", index: 1 }));
  });

  test("Restart tour forgets the answer through the store, then starts at the first step", async () => {
    const user = userEvent.setup();
    const rec = recordingStore();
    await rec.inner.set(tourKey({ scope: "app", person: "acct-1", tour: "first-run" }), { status: "completed", version: 2, at: "x" });
    render(
      <TourProvider tours={[tour]} person="acct-1" scope="app" store={rec.store} autoStart="first-run" autoStartDelay={0}>
        <Page />
      </TourProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("seen")).toHaveTextContent("true"));
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Restart tour" }));
    expect(await screen.findByRole("dialog", { name: "First" })).toBeInTheDocument();
    expect(rec.resets).toEqual(["app:acct-1:first-run"]);
    expect(await rec.inner.get("app:acct-1:first-run")).toBeNull();
  });

  test("a store without events still runs the tour (a pre-1.1 store)", async () => {
    const user = userEvent.setup();
    const store: TourStore = { get: async () => null, set: async () => {} };
    render(
      <TourProvider tours={[tour]} person="acct-1" store={store} autoStart="first-run" autoStartDelay={0}>
        <Page />
      </TourProvider>,
    );
    await screen.findByRole("dialog", { name: "First" });
    await user.click(screen.getByRole("button", { name: "Restart tour" }));
    expect(await screen.findByRole("dialog", { name: "First" })).toBeInTheDocument();
  });
});

function feedServer(feed: AnnouncementFeed) {
  const calls: { url: string; body?: unknown }[] = [];
  let online = true;
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (!online) throw new TypeError("offline");
    if (!init?.method) return new Response(JSON.stringify(feed), { status: 200 });
    return new Response("{}", { status: 200 });
  };
  return { calls, fetch, setOnline: (v: boolean) => void (online = v) };
}

const item = (key: string, extra: Partial<AnnouncementFeed["items"][number]> = {}) => ({
  key,
  app: "app",
  title: key,
  body: "Body.",
  big: false,
  published_at: "2026-10-01T00:00:00Z",
  ...extra,
});

describe("What's new (1.1)", () => {
  test("the client asks for the app's feed with its main tour, and posts receipts", async () => {
    const s = feedServer({ items: [item("a")], unseen: 1 });
    const c = createAnnouncementsClient({ fetch: s.fetch, endpoint: "https://login.example.org/api/me/", app: "app", mainTour: "first-run" });
    expect((await c.list())!.items.map((i) => i.key)).toEqual(["a"]);
    expect(s.calls[0].url).toBe("https://login.example.org/api/me/announcements?app=app&main=first-run");
    expect(await c.receipt("a", "dismissed")).toBe(true);
    expect(s.calls[1]).toMatchObject({ url: "https://login.example.org/api/me/announcements/a/receipts", body: { app: "app", main: "first-run", action: "dismissed" } });
    s.setOnline(false);
    expect(await c.list()).toBeNull();
    expect(await c.receipt("a", "shown")).toBe(false);
  });

  test("the day's toast: a big item never toasted, at most one a day in any product", () => {
    const now = new Date(2026, 9, 9, 9, 0);
    const feed: AnnouncementFeed = { items: [item("small"), item("big", { big: true }), item("old", { big: true, toasted_at: "x" })], unseen: 3 };
    expect(toastCandidate(feed, now)?.key).toBe("big");
    expect(toastCandidate({ ...feed, last_toasted_at: new Date(2026, 9, 9, 7, 0).toISOString() }, now)).toBeNull();
    expect(toastCandidate({ ...feed, last_toasted_at: new Date(2026, 9, 8, 23, 0).toISOString() }, now)?.key).toBe("big");
    expect(toastCandidate(feed, now, localDay(now))).toBeNull();
    expect(toastCandidate({ items: [item("small")], unseen: 1 }, now)).toBeNull();
    expect(toastCandidate(null, now)).toBeNull();
  });

  test("useWhatsNew: badge, panel, dismiss, Show me and its last step, the toast once", async () => {
    const s = feedServer({ items: [item("big", { big: true, tour_id: "whatsnew-big", docs_path: "/x" }), item("small")], unseen: 2 });
    const client = createAnnouncementsClient({ fetch: s.fetch, endpoint: "https://e.example/api/me", app: "app" });
    const { result } = renderHook(() => useWhatsNew({ client, person: "acct-1", now: () => new Date(2026, 9, 9, 9) }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.unseen).toBe(2);
    await waitFor(() => expect(result.current.toast?.key).toBe("big"));
    expect(s.calls.some((c) => (c.body as { action?: string })?.action === "toasted")).toBe(true);
    expect(window.localStorage.getItem("zavon.whatsnew:toastday:acct-1")).toBe("2026-10-09");

    act(() => result.current.markShown());
    expect(result.current.unseen).toBe(0);
    expect(s.calls.filter((c) => (c.body as { action?: string })?.action === "shown")).toHaveLength(2);

    let tourId: string | null = null;
    act(() => {
      tourId = result.current.showMe("big");
    });
    expect(tourId).toBe("whatsnew-big");
    expect(result.current.toast).toBeNull();
    expect(result.current.showMe("small")).toBeNull();
    act(() => result.current.tourClosed("whatsnew-big", "completed"));
    expect(s.calls.map((c) => (c.body as { action?: string })?.action)).toContain("tour_completed");
    expect(result.current.items.find((i) => i.key === "big")!.completed_tour_at).toBeTruthy();

    act(() => result.current.opened("small"));
    act(() => result.current.dismiss("small"));
    expect(result.current.items.map((i) => i.key)).toEqual(["big"]);
    expect(s.calls.map((c) => (c.body as { action?: string })?.action)).toEqual(expect.arrayContaining(["opened", "dismissed"]));

    // A second page the same day: no toast.
    const again = renderHook(() => useWhatsNew({ client, person: "acct-1", now: () => new Date(2026, 9, 9, 15) }));
    await waitFor(() => expect(again.result.current.loaded).toBe(true));
    expect(again.result.current.toast).toBeNull();
  });

  test("nothing loads before the person is known, or when turned off", async () => {
    const s = feedServer({ items: [item("a")], unseen: 1 });
    const client = createAnnouncementsClient({ fetch: s.fetch, endpoint: "https://e.example/api/me", app: "app" });
    renderHook(() => useWhatsNew({ client, person: null }));
    renderHook(() => useWhatsNew({ client, person: "acct-1", enabled: false }));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(s.calls).toHaveLength(0);
  });
});
