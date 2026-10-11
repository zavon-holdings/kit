import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantSheet, type AssistantSheetProps } from "./AssistantSheet.js";
import { ProposalDiff } from "./ProposalDiff.js";
import type { AiDocsAnswer } from "./types.js";
import { setNarrow, vector, violations } from "./test/helpers.js";

// The docs answer from the contract, as the host's ask would return it.
const docsAnswer = vector<{ result: AiDocsAnswer }>("tools/platform.docs.answer.json").result;

function Host(props: Partial<AssistantSheetProps>) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open assistant
      </button>
      <AssistantSheet open={open} onClose={() => setOpen(false)} {...props} />
    </div>
  );
}

async function openSheet() {
  await userEvent.click(screen.getByRole("button", { name: "Open assistant" }));
  return screen.getByRole("dialog", { name: "Assistant" });
}

describe("AssistantSheet", () => {
  test("opens as a named modal dialog with focus in the question box; Escape closes it and focus returns", async () => {
    render(<Host ask={async () => docsAnswer} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    const dialog = await openSheet();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("textbox", { name: "Question" })).toHaveFocus();
    expect(await violations()).toEqual([]);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Open assistant" })).toHaveFocus();
  });

  test("the close button closes it and focus returns", async () => {
    render(<Host ask={async () => docsAnswer} />);
    await openSheet();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Open assistant" })).toHaveFocus();
  });

  test("Tab stays inside the sheet", async () => {
    render(<Host ask={async () => docsAnswer} />);
    const dialog = await openSheet();
    for (let i = 0; i < 6; i++) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await userEvent.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  test("asks through the host and shows the answer with its sources opening in a new tab", async () => {
    const ask = vi.fn().mockResolvedValue(docsAnswer);
    render(<Host ask={ask} />);
    const dialog = await openSheet();
    await userEvent.type(screen.getByRole("textbox", { name: "Question" }), "How do I add a page?");
    await userEvent.click(within(dialog).getByRole("button", { name: "Ask" }));
    expect(ask).toHaveBeenCalledWith("How do I add a page?");
    expect(await within(dialog).findByText(docsAnswer.answer)).toBeInTheDocument();
    const link = within(dialog).getByRole("link", { name: new RegExp(docsAnswer.citations[0].title) });
    expect(link).toHaveAttribute("href", docsAnswer.citations[0].url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("(opens in a new tab)");
    expect(await violations()).toEqual([]);
  });

  test("Enter asks; a failed answer says so", async () => {
    const ask = vi.fn().mockRejectedValue(new Error("down"));
    render(<Host ask={ask} />);
    const dialog = await openSheet();
    await userEvent.type(screen.getByRole("textbox", { name: "Question" }), "Where are my reports{Enter}");
    expect(ask).toHaveBeenCalledWith("Where are my reports");
    expect(await within(dialog).findByText("No answer is available now. Try again later.")).toBeInTheDocument();
  });

  test("feedback thumbs under an answer send through the host with the answer", async () => {
    const onFeedback = vi.fn();
    const ask = vi.fn().mockResolvedValue({ ...docsAnswer, usage_event_id: "ev-1" });
    render(<Host ask={ask} onFeedback={onFeedback} />);
    const dialog = await openSheet();
    await userEvent.type(screen.getByRole("textbox", { name: "Question" }), "Help{Enter}");
    await within(dialog).findByText(docsAnswer.answer);
    await userEvent.click(within(dialog).getByRole("button", { name: "Good result" }));
    expect(onFeedback).toHaveBeenCalledTimes(1);
    expect(onFeedback.mock.calls[0][0]).toEqual({ rating: 1 });
    expect(onFeedback.mock.calls[0][1]).toMatchObject({ usage_event_id: "ev-1" });
  });

  test("Apply asks for confirmation; onApply runs only after Confirm", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(
      <Host
        proposal={<ProposalDiff before={["Old heading"]} after={["New heading"]} />}
        onApply={onApply}
        onDiscard={() => {}}
      />,
    );
    const dialog = await openSheet();
    expect(within(dialog).getByText("The result is a draft. You check it before you save.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(onApply).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole("button", { name: "Confirm" });
    expect(confirm).toHaveFocus();
    expect(await violations()).toEqual([]);

    // Cancel goes back without applying; Escape in the confirm step cancels it, not the sheet.
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onApply).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(await within(dialog).findByText("The proposal is applied. Check it, then save.")).toBeInTheDocument();
  });

  test("a failed apply says so and keeps the confirm step", async () => {
    const onApply = vi.fn().mockRejectedValue(new Error("no"));
    render(<Host proposal={<p>Proposal text</p>} onApply={onApply} />);
    const dialog = await openSheet();
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(await within(dialog).findByText("The proposal did not apply. Try again.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  test("a narrow screen gets the full-screen sheet; a wide one the side sheet", async () => {
    setNarrow(true);
    const { unmount } = render(<Host ask={async () => docsAnswer} />);
    await openSheet();
    expect(document.querySelector(".zai-sheet")).toHaveClass("zai-sheet--full");
    unmount();
    setNarrow(false);
    render(<Host ask={async () => docsAnswer} />);
    await openSheet();
    expect(document.querySelector(".zai-sheet")).toHaveClass("zai-sheet--side");
  });

  test("the host's words replace every default", async () => {
    render(
      <Host
        ask={async () => docsAnswer}
        copy={{ title: "Help", close: "Close help", questionLabel: "Your question", ask: "Send" }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open assistant" }));
    const dialog = screen.getByRole("dialog", { name: "Help" });
    expect(within(dialog).getByRole("button", { name: "Close help" })).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Your question" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Send" })).toBeInTheDocument();
  });
});
