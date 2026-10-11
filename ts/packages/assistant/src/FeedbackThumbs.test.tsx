import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FEEDBACK_COMMENT_MAX, FeedbackThumbs } from "./FeedbackThumbs.js";
import { violations } from "./test/helpers.js";

describe("FeedbackThumbs", () => {
  test("a choice is pressed and sent once", async () => {
    const onSend = vi.fn();
    render(<FeedbackThumbs onSend={onSend} />);
    const up = screen.getByRole("button", { name: "Good result" });
    const down = screen.getByRole("button", { name: "Bad result" });
    expect(up).toHaveAttribute("aria-pressed", "false");
    expect(down).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(up);
    await userEvent.click(up);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith({ rating: 1 });
    expect(up).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("Thank you. Your rating is sent.")).toBeInTheDocument();

    // A different choice is a new choice: sent once more.
    await userEvent.click(down);
    await userEvent.click(down);
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend).toHaveBeenLastCalledWith({ rating: -1 });
    expect(down).toHaveAttribute("aria-pressed", "true");
    expect(up).toHaveAttribute("aria-pressed", "false");
    expect(await violations()).toEqual([]);
  });

  test("an optional comment goes with the choice, once, and at most 500 characters", async () => {
    const onSend = vi.fn();
    render(<FeedbackThumbs onSend={onSend} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Bad result" }));
    const box = screen.getByRole("textbox", { name: "Comment (optional)" });
    expect(box).toHaveAttribute("maxLength", String(FEEDBACK_COMMENT_MAX));
    fireEvent.change(box, { target: { value: "x".repeat(700) } });
    const send = screen.getByRole("button", { name: "Send comment" });
    await userEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(2);
    const last = onSend.mock.calls[1][0];
    expect(last.rating).toBe(-1);
    expect(last.comment).toHaveLength(FEEDBACK_COMMENT_MAX);
    expect(send).toBeDisabled();
    await userEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  test("a failed send says so", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("down"));
    render(<FeedbackThumbs onSend={onSend} copy={{ failed: "Not sent." }} />);
    await userEvent.click(screen.getByRole("button", { name: "Good result" }));
    expect(await screen.findByText("Not sent.")).toBeInTheDocument();
  });
});
