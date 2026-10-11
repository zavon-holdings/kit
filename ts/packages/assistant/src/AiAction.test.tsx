import { describe, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiAction, DEFAULT_AI_REASONS } from "./AiAction.js";
import { InfoTip } from "./InfoTip.js";
import { useAiStatus } from "./useAiStatus.js";
import type { AiState, AiStatus, AiToolStatus } from "./types.js";
import { vector, violations } from "./test/helpers.js";

const ready = vector<AiStatus>("status-ready.json");
const noPermission = vector<AiStatus>("status-no-permission.json");
const copy = { label: "Write a section" };

function withState(state: AiState, tools: AiToolStatus[] = ready.tools): AiStatus {
  return { ...ready, state, tools };
}

describe("AiAction", () => {
  test.each(["not_configured", "off", "blocked"] as const)("renders nothing when the state is %s", (state) => {
    const { container } = render(<AiAction status={withState(state)} toolKey="pages.section.generate" onRun={() => {}} copy={copy} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("renders nothing for the not configured and off vectors, no status, and a tool the status does not list", () => {
    for (const status of [vector<AiStatus>("status-not-configured.json"), vector<AiStatus>("status-off.json"), null, undefined]) {
      const { container, unmount } = render(<AiAction status={status} toolKey="pages.section.generate" onRun={() => {}} copy={copy} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
    const { container } = render(<AiAction status={ready} toolKey="no.such.tool" onRun={() => {}} copy={copy} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("ready: an enabled button with the price from the status, and an info tip that says the result is a draft", async () => {
    const onRun = vi.fn();
    render(<AiAction status={ready} toolKey="pages.section.generate" onRun={onRun} copy={copy} data-tour="ai-section" />);
    const button = screen.getByRole("button", { name: "Write a section 14 credits" });
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleDescription(/The result is a draft\. You check it before you save\./);
    expect(document.querySelector('[data-tour="ai-section"]')).toContainElement(button);
    await userEvent.click(button);
    expect(onRun).toHaveBeenCalledTimes(1);

    const info = screen.getByRole("button", { name: "More information" });
    expect(info).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(info);
    expect(info).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("status")).toHaveTextContent("The result is a draft. You check it before you save.");
    expect(await violations()).toEqual([]);
  });

  test("ready: metered shows the hold and free says so", () => {
    render(
      <>
        <AiAction status={ready} toolKey="pages.page.generate" onRun={() => {}} copy={{ label: "Write a page" }} />
        <AiAction status={ready} toolKey="platform.docs.answer" onRun={() => {}} copy={{ label: "Ask" }} />
      </>,
    );
    expect(screen.getByRole("button", { name: "Write a page Up to 40 credits" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Ask Free" })).toBeEnabled();
  });

  test("ready follows a new status: the price is never the component's own", () => {
    const tools = ready.tools.map((t) => (t.key === "pages.section.generate" ? { ...t, credits: 2.5 } : t));
    render(<AiAction status={withState("ready", tools)} toolKey="pages.section.generate" onRun={() => {}} copy={copy} />);
    expect(screen.getByRole("button", { name: "Write a section 2.5 credits" })).toBeEnabled();
  });

  test("greyed for missing permission: disabled, no price, and the info tip gives the reason", async () => {
    const onRun = vi.fn();
    render(<AiAction status={noPermission} toolKey="pages.section.generate" onRun={onRun} copy={copy} />);
    const button = screen.getByRole("button", { name: "Write a section" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(DEFAULT_AI_REASONS.missing_permission);
    await userEvent.click(button);
    expect(onRun).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "More information" }));
    expect(screen.getByRole("status")).toHaveTextContent(DEFAULT_AI_REASONS.missing_permission);
    expect(await violations()).toEqual([]);
  });

  test("greyed for no credits, with the host's words", async () => {
    const tools: AiToolStatus[] = [{ key: "x.tool", credits: 3, pricing_mode: "fixed", allowed: false, reason: "no_credits" }];
    render(
      <AiAction
        status={withState("no_credits", tools)}
        toolKey="x.tool"
        onRun={() => {}}
        copy={{ label: "Improve", reasons: { no_credits: "Your organisation has no credits left." }, tip: { label: "Why is this off" } }}
        docsUrl="https://docs.example.org/ai"
      />,
    );
    expect(screen.getByRole("button", { name: "Improve" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Why is this off" }));
    expect(screen.getByRole("status")).toHaveTextContent("Your organisation has no credits left.");
    const link = screen.getByRole("link", { name: /Read more/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(await violations()).toEqual([]);
  });

  test("greyed when the tool is not allowed in a ready status", () => {
    const tools: AiToolStatus[] = [{ key: "x.tool", credits: 3, pricing_mode: "fixed", allowed: false, reason: "missing_permission" }];
    render(<AiAction status={withState("ready", tools)} toolKey="x.tool" onRun={() => {}} copy={copy} />);
    expect(screen.getByRole("button", { name: "Write a section" })).toBeDisabled();
  });

  test("busy: disabled and says so", () => {
    render(<AiAction status={ready} toolKey="pages.section.generate" onRun={() => {}} copy={{ ...copy, busy: "Writing" }} busy />);
    const button = screen.getByRole("button", { name: /Writing/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});

describe("InfoTip", () => {
  test("Escape and a press elsewhere close it", async () => {
    render(
      <>
        <InfoTip>Short text.</InfoTip>
        <button type="button">Elsewhere</button>
      </>,
    );
    const info = screen.getByRole("button", { name: "More information" });
    await userEvent.click(info);
    expect(screen.getByRole("status")).toHaveTextContent("Short text.");
    await userEvent.keyboard("{Escape}");
    expect(info).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(info).toHaveFocus();
    await userEvent.click(info);
    await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(info).toHaveAttribute("aria-expanded", "false");
  });
});

describe("useAiStatus", () => {
  function Probe({ load, refreshMs }: { load: () => Promise<AiStatus>; refreshMs?: number }) {
    const { status, loading, error, refresh } = useAiStatus({ load, refreshMs });
    return (
      <div>
        <p data-testid="state">{loading ? "loading" : error ? "failed" : (status?.state ?? "none")}</p>
        <AiAction status={status} toolKey="pages.section.generate" onRun={() => {}} copy={copy} />
        <button type="button" onClick={() => void refresh()}>
          Reload
        </button>
      </div>
    );
  }

  test("loads through the host and draws the controls", async () => {
    const load = vi.fn().mockResolvedValue(ready);
    render(<Probe load={load} />);
    expect(screen.getByTestId("state")).toHaveTextContent("loading");
    expect(await screen.findByRole("button", { name: "Write a section 14 credits" })).toBeEnabled();
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("a failed load hides AI and never throws into render", async () => {
    const load = vi.fn().mockRejectedValue(new Error("down"));
    render(<Probe load={load} />);
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("failed"));
    expect(screen.queryByRole("button", { name: /Write a section/ })).toBeNull();
  });

  test("a malformed answer counts as a failure", async () => {
    const load = vi.fn().mockResolvedValue({ nope: true } as unknown as AiStatus);
    render(<Probe load={load} />);
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("failed"));
  });

  test("refresh loads again, and refreshMs loads on a timer", async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn().mockResolvedValueOnce(ready).mockResolvedValue(noPermission);
      render(<Probe load={load} refreshMs={1000} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByTestId("state")).toHaveTextContent("ready");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(load).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("state")).toHaveTextContent("no_permission");
      expect(screen.getByRole("button", { name: "Write a section" })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
