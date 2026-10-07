import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { Spotlight, type CloseReason } from "./Spotlight.js";
import { TourProvider, useTours } from "./TourProvider.js";
import { memoryStore, tourKey } from "./storage.js";
import type { Tour } from "./tour.js";

const tour: Tour = {
  id: "first-run",
  steps: [
    { id: "new", target: "new-item", title: "Create your first item", body: "Everything starts here.", docsUrl: "/guide/create", learnLabel: "Find out how" },
    { id: "gone", target: "not-on-this-page", title: "Hidden", body: "This target is missing." },
    { id: "list", target: "list", title: "Your list", body: "Items land here.", docsUrl: "/guide/list" },
    { id: "help", target: "help", title: "Help", body: "Take the tour again from here." },
  ],
};

function Page() {
  return (
    <div>
      <button type="button" data-tour="new-item">
        New item
      </button>
      <ul data-tour="list">
        <li>One</li>
      </ul>
      <button type="button" data-tour="help">
        Help
      </button>
      <button type="button">Elsewhere</button>
    </div>
  );
}

async function violations(): Promise<string[]> {
  const out = await axe.run(document.body, {
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: false },
      "page-has-heading-one": { enabled: false },
      "landmark-one-main": { enabled: false },
    },
  });
  return out.violations.map((v) => `${v.id}: ${v.help}`);
}

function Controlled({ onClose = () => {} }: { onClose?: (r: CloseReason, s: number) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Page />
      <Spotlight
        tour={tour}
        open={open}
        docsBase="https://docs.example.org/docs"
        onClose={(r, s) => {
          setOpen(false);
          onClose(r, s);
        }}
      />
    </>
  );
}

describe("Spotlight", () => {
  test("a named modal dialog with the step's copy, count and docs link in a new tab", async () => {
    render(<Controlled />);
    const dialog = await screen.findByRole("dialog", { name: "Create your first item" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Everything starts here.");
    // The missing step is not counted: three steps can show.
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Find out how/ });
    expect(link).toHaveAttribute("href", "https://docs.example.org/docs/guide/create");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link).toHaveTextContent("(opens in a new tab)");
    expect(document.activeElement).toBe(dialog);
    expect(document.querySelector(".ztour__hole")).not.toBeNull();
    expect(await violations()).toEqual([]);
  });

  test("next skips a step whose target is missing; back returns; done completes", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onClose={onClose} />);
    await screen.findByRole("dialog", { name: "Create your first item" });
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Your list" })).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "Create your first item" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Help" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip tour" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledWith("completed", 3);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("Escape, Skip and the close button all end it, from any step", async () => {
    const user = userEvent.setup();
    for (const how of ["escape", "skip", "close"] as const) {
      const onClose = vi.fn();
      const { unmount } = render(<Controlled onClose={onClose} />);
      await screen.findByRole("dialog");
      if (how === "escape") await user.keyboard("{Escape}");
      if (how === "skip") await user.click(screen.getByRole("button", { name: "Skip tour" }));
      if (how === "close") await user.click(screen.getByRole("button", { name: "Close tour" }));
      expect(onClose).toHaveBeenCalledWith("dismissed", 0);
      expect(screen.queryByRole("dialog")).toBeNull();
      unmount();
    }
  });

  test("arrow keys step; Tab stays inside the tooltip", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await screen.findByRole("dialog", { name: "Create your first item" });
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("dialog", { name: "Your list" })).toBeInTheDocument();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("dialog", { name: "Create your first item" })).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  test("focus returns to where it was", async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Page />
          <button type="button" onClick={() => setOpen(true)}>
            Take the tour
          </button>
          <Spotlight tour={tour} open={open} onClose={() => setOpen(false)} />
        </>
      );
    }
    render(<Host />);
    const launcher = screen.getByRole("button", { name: "Take the tour" });
    await user.click(launcher);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(launcher);
  });

  test("clicking the dimmed page does not move or end the tour", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Controlled onClose={onClose} />);
    await screen.findByRole("dialog", { name: "Create your first item" });
    await user.click(document.querySelector(".ztour__scrim") as Element);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Create your first item" })).toBeInTheDocument();
  });

  test("a target that is on the page but not drawn (a closed phone menu) is skipped", async () => {
    render(
      <>
        <div style={{ display: "none" }}>
          <button type="button" data-tour="rail-item">Hidden</button>
        </div>
        <button type="button" data-tour="rail-item">Shown elsewhere</button>
        <span hidden data-tour="hidden-only">x</span>
        <Spotlight
          tour={{
            id: "x",
            steps: [
              { id: "a", target: "hidden-only", title: "Never", body: "B" },
              { id: "b", target: "rail-item", title: "The drawn one", body: "B" },
            ],
          }}
          open
          onClose={() => {}}
        />
      </>,
    );
    expect(await screen.findByRole("dialog", { name: "The drawn one" })).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 1")).toBeInTheDocument();
  });

  test("a step with no target is drawn in the middle, with no cut-out", async () => {
    render(<Spotlight tour={{ id: "hello", steps: [{ id: "a", title: "Welcome", body: "Hello." }] }} open onClose={() => {}} />);
    await screen.findByRole("dialog", { name: "Welcome" });
    expect(document.querySelector(".ztour--center")).not.toBeNull();
    expect(document.querySelector(".ztour__hole")).toBeNull();
  });

  test("nothing to point at: closes as unavailable after waiting", async () => {
    const onClose = vi.fn();
    render(<Spotlight tour={{ id: "x", steps: [{ id: "a", target: "absent", title: "T", body: "B" }] }} open onClose={onClose} waitFor={200} />);
    await waitFor(() => expect(onClose).toHaveBeenCalledWith("unavailable", 0));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a target that arrives late is waited for", async () => {
    function Late() {
      const [shown, setShown] = useState(false);
      setTimeout(() => setShown(true), 100);
      return shown ? <button type="button" data-tour="late">Late</button> : null;
    }
    render(
      <>
        <Late />
        <Spotlight tour={{ id: "x", steps: [{ id: "a", target: "late", title: "Arrived", body: "B" }] }} open onClose={() => {}} />
      </>,
    );
    expect(await screen.findByRole("dialog", { name: "Arrived" }, { timeout: 2000 })).toBeInTheDocument();
  });

  test("narrow screens get a sheet; reduced motion gets no transitions", async () => {
    const media = (globalThis as Record<string, unknown>).__media as { reduce: boolean; narrow: boolean };
    media.reduce = true;
    media.narrow = true;
    try {
      render(<Controlled />);
      await screen.findByRole("dialog");
      const root = document.querySelector(".ztour") as HTMLElement;
      expect(root.className).toContain("ztour--sheet");
      expect(root.className).toContain("ztour--still");
    } finally {
      media.reduce = false;
      media.narrow = false;
    }
  });
});

describe("TourProvider", () => {
  function HelpMenu() {
    const { start, seen } = useTours();
    return (
      <div>
        <button type="button" onClick={() => start("first-run")}>
          Take the tour
        </button>
        <span data-testid="seen">{String(seen("first-run"))}</span>
      </div>
    );
  }

  test("starts by itself on a first visit, records the answer, and not again", async () => {
    const user = userEvent.setup();
    const store = memoryStore();
    const { unmount } = render(
      <TourProvider tours={[tour]} person="p1" scope="app" store={store} autoStart="first-run" autoStartDelay={0}>
        <Page />
        <HelpMenu />
      </TourProvider>,
    );
    await screen.findByRole("dialog", { name: "Create your first item" });
    await user.click(screen.getByRole("button", { name: "Skip tour" }));
    await waitFor(async () => expect(await store.get(tourKey({ scope: "app", person: "p1", tour: "first-run" }))).toMatchObject({ status: "dismissed", version: 1, step: 0 }));
    unmount();

    render(
      <TourProvider tours={[tour]} person="p1" scope="app" store={store} autoStart="first-run" autoStartDelay={0}>
        <Page />
        <HelpMenu />
      </TourProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("seen")).toHaveTextContent("true"));
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.queryByRole("dialog")).toBeNull();
    // The Help menu starts it again whenever asked.
    await user.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(await screen.findByRole("dialog", { name: "Create your first item" })).toBeInTheDocument();
  });

  test("waits for the person: nothing starts while sign-in is still deciding", async () => {
    const store = memoryStore();
    const { rerender } = render(
      <TourProvider tours={[tour]} person={null} store={store} autoStart="first-run" autoStartDelay={0}>
        <Page />
      </TourProvider>,
    );
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(
      <TourProvider tours={[tour]} person="p2" store={store} autoStart="first-run" autoStartDelay={0}>
        <Page />
      </TourProvider>,
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  test("a new version of the tour shows again", async () => {
    const store = memoryStore({ "app:p1:first-run": { status: "completed", version: 1, at: "x" } });
    render(
      <TourProvider tours={[{ ...tour, version: 2 }]} person="p1" scope="app" store={store} autoStart="first-run" autoStartDelay={0}>
        <Page />
      </TourProvider>,
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  test("useTours outside a provider is inert", () => {
    function Lonely() {
      const { start, tours } = useTours();
      return <span>{String(start("x"))}:{tours.length}</span>;
    }
    render(<Lonely />);
    expect(screen.getByText("false:0")).toBeInTheDocument();
  });
});
