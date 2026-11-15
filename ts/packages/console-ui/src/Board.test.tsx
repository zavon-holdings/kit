import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Board } from "./Board.js";
import { BulkMoveDialog } from "./BulkMoveDialog.js";
import { LaneMore } from "./LaneMore.js";
import { MoveDialog } from "./MoveDialog.js";
import type { MoveRules } from "./moves.js";
import type { BoardCardData, BoardColumnData, MoveOutcome, MoveRequest } from "./types.js";
import { useLaneOverflow } from "./useLaneOverflow.js";

const rules: MoveRules = { back_needs_reason: true, back_admin_only: true, skip_needs_confirm: true, frequent_moves: 3, frequent_window_hours: 24 };
const names = [
  { code: "received", name: "Received" },
  { code: "review", name: "Review" },
  { code: "interview", name: "Interview" },
];
const card = (id: string, stage = "received", extra: Partial<BoardCardData> = {}): BoardCardData => ({ id, title: `Person ${id}`, stage, ...extra });
const okMove = (req: MoveRequest): Promise<MoveOutcome[]> => Promise.resolve(req.ids.map((id) => ({ id, ok: true })));

// jsdom does no layout: give an element a geometry.
function geometry(el: HTMLElement, box: Record<string, number>) {
  for (const [k, v] of Object.entries(box)) Object.defineProperty(el, k, { configurable: true, value: v });
}

describe("a lane without a scrollbar", () => {
  function Lane({ total }: { total: number }) {
    const lane = useLaneOverflow(total);
    return (
      <section>
        <div data-testid="lane" ref={lane.ref} {...lane.props}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} data-lane-item data-testid={`card${i}`} />
          ))}
        </div>
        <LaneMore count={lane.below} more={lane.more} onClick={lane.scrollOn} />
      </section>
    );
  }

  it("fades the edge that has more and counts the cards below, loaded or not", () => {
    render(<Lane total={10} />);
    const lane = screen.getByTestId("lane");
    geometry(lane, { clientHeight: 200, scrollHeight: 400, scrollTop: 0 });
    [0, 1, 2, 3].forEach((i) => geometry(screen.getByTestId(`card${i}`), { offsetTop: i * 100, offsetHeight: 90 }));
    act(() => void fireEvent.scroll(lane));
    expect(screen.getByRole("button", { name: "8 more" })).toBeInTheDocument();
    expect(lane).toHaveAttribute("data-more-below");
    expect(lane).not.toHaveAttribute("data-more-above");
    let by = 0;
    lane.scrollBy = ((o: ScrollToOptions) => void (by = o.top ?? 0)) as typeof lane.scrollBy;
    fireEvent.click(screen.getByRole("button", { name: "8 more" }));
    expect(by).toBe(160);
    geometry(lane, { scrollTop: 200 });
    act(() => void fireEvent.scroll(lane));
    expect(lane).toHaveAttribute("data-more-above");
    expect(screen.queryByRole("button", { name: /more/ })).not.toBeInTheDocument();
  });
});

describe("the board", () => {
  const columns = (): BoardColumnData[] => [
    { code: "received", name: "Received", total: 12, cards: Array.from({ length: 10 }, (_, i) => card(`r${i}`)), next: "cursor-1", flags: { overdue: 2 } },
    { code: "review", name: "Review", total: 0, cards: [] },
    { code: "interview", name: "Interview", total: 1, cards: [card("i0", "interview")] },
  ];

  it("shows each lane's true total, an empty lane as a lane, and the column's rule chip", () => {
    render(<Board columns={columns()} loadMore={vi.fn()} rules={rules} admin={false} move={okMove} listIds={vi.fn()} />);
    expect(within(screen.getByTestId("lane-received")).getByTestId("lane-total")).toHaveTextContent("· 12");
    expect(within(screen.getByTestId("lane-review")).getByText("No Records")).toBeInTheDocument();
    expect(within(screen.getByTestId("lane-received")).getByText("2 Overdue")).toBeInTheDocument();
  });

  it("loads a lane's next ten with its own cursor when it is scrolled to its foot", async () => {
    const loadMore = vi.fn().mockResolvedValue({ cards: [card("r10"), card("r11")], next: null, total: 12 });
    render(<Board columns={columns()} loadMore={loadMore} rules={rules} admin={false} move={okMove} listIds={vi.fn()} />);
    const scroller = within(screen.getByTestId("lane-received")).getByTestId("lane-scroll");
    geometry(scroller, { scrollHeight: 1000, clientHeight: 400, scrollTop: 500 });
    fireEvent.scroll(scroller);
    await waitFor(() => expect(loadMore).toHaveBeenCalledWith("received", "cursor-1"));
    expect(loadMore).toHaveBeenCalledTimes(1);
    await screen.findByText("Person r11");
  });

  it("refuses a drag backwards and lands a drag one step forward", async () => {
    const move = vi.fn(okMove);
    const onChanged = vi.fn();
    render(<Board columns={columns()} loadMore={vi.fn()} rules={rules} admin={true} move={move} listIds={vi.fn()} onChanged={onChanged} />);
    const back = within(screen.getByTestId("lane-interview")).getByText("Person i0").closest("article")!;
    fireEvent.dragStart(back, { dataTransfer: { setData() {}, effectAllowed: "" } });
    expect(screen.getByTestId("lane-received")).toHaveAttribute("data-drop", "no");
    fireEvent.drop(screen.getByTestId("lane-received"));
    expect(move).not.toHaveBeenCalled();

    const fwd = within(screen.getByTestId("lane-received")).getByText("Person r0").closest("article")!;
    fireEvent.dragStart(fwd, { dataTransfer: { setData() {}, effectAllowed: "" } });
    expect(screen.getByTestId("lane-review")).toHaveAttribute("data-drop", "ok");
    expect(screen.getByTestId("lane-interview")).toHaveAttribute("data-drop", "confirm");
    fireEvent.drop(screen.getByTestId("lane-review"));
    await waitFor(() => expect(move).toHaveBeenCalledWith({ ids: ["r0"], from: "received", to: "review", reason: "", confirmSkip: false }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.queryByText("Person r0")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("lane-received")).getByTestId("lane-total")).toHaveTextContent("· 11");
  });

  it("opens the Move dialog to confirm a drag that skips a step", async () => {
    const move = vi.fn(okMove);
    render(<Board columns={columns()} loadMore={vi.fn()} rules={rules} admin={false} move={move} listIds={vi.fn()} />);
    const fwd = within(screen.getByTestId("lane-received")).getByText("Person r0").closest("article")!;
    fireEvent.dragStart(fwd, { dataTransfer: { setData() {}, effectAllowed: "" } });
    fireEvent.drop(screen.getByTestId("lane-interview"));
    const dialog = await screen.findByTestId("move-dialog");
    expect(move).not.toHaveBeenCalled();
    expect(within(dialog).getByTestId("move-submit")).toBeDisabled();
    await userEvent.click(within(dialog).getByText("Skip Review"));
    await userEvent.click(within(dialog).getByTestId("move-submit"));
    await waitFor(() => expect(move).toHaveBeenCalledWith({ ids: ["r0"], from: "received", to: "interview", reason: "", confirmSkip: true }));
  });

  it("selects within one lane at a time and offers Select All on the server's total", async () => {
    render(<Board columns={columns()} loadMore={vi.fn()} rules={rules} admin={false} move={okMove} listIds={vi.fn()} />);
    await userEvent.click(within(screen.getByTestId("lane-received")).getByRole("button", { name: "Select" }));
    // Only one lane selects at a time.
    expect(within(screen.getByTestId("lane-interview")).queryByRole("button", { name: "Select" })).not.toBeInTheDocument();
    const bar = screen.getByTestId("lane-bulk");
    await userEvent.click(within(bar).getByRole("button", { name: "Select All 12" }));
    expect(within(bar).getByText("12 Selected")).toBeInTheDocument();
  });
});

describe("the Move dialog", () => {
  it("keeps moving back to admins, and asks them for a reason", async () => {
    const move = vi.fn(okMove);
    const { unmount } = render(
      <MoveDialog record={{ id: "x", title: "Person x", stage: "interview" }} columns={names} rules={rules} admin={false} move={move} onDone={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("radio", { name: /Received/ })).toBeDisabled();
    expect(screen.getByText("Only an admin can move a record back.")).toBeInTheDocument();
    unmount();

    const onDone = vi.fn();
    render(<MoveDialog record={{ id: "x", title: "Person x", stage: "interview" }} columns={names} rules={rules} admin={true} move={move} onDone={onDone} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: /Review/ }));
    expect(screen.getByTestId("move-submit")).toBeDisabled();
    await userEvent.type(screen.getByTestId("move-reason"), "Missed a document");
    await userEvent.click(screen.getByTestId("move-submit"));
    await waitFor(() => expect(move).toHaveBeenCalledWith({ ids: ["x"], from: "interview", to: "review", reason: "Missed a document", confirmSkip: false }));
    expect(onDone).toHaveBeenCalled();
  });

  it("warns about a record that has moved often, and shows the server's refusal", async () => {
    const move = vi.fn().mockResolvedValue([{ id: "x", ok: false, code: "run_locked", message: "A move is booked for this record." }]);
    render(
      <MoveDialog record={{ id: "x", title: "Person x", stage: "received", recentMoves: 4 }} columns={names} rules={rules} admin={false} move={move} onDone={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByTestId("move-frequent")).toHaveTextContent("moved 4 times in the past 24 hours");
    await userEvent.click(screen.getByTestId("move-submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent("A move is booked for this record.");
  });
});

describe("a bulk move", () => {
  it("is select, confirm, progress, result — on the server's total, in chunks", async () => {
    const ids = Array.from({ length: 23 }, (_, i) => `r${i}`);
    const listIds = vi.fn().mockResolvedValue(ids);
    const move = vi.fn((req: MoveRequest) => Promise.resolve(req.ids.map((id) => ({ id, ok: id !== "r7", code: id === "r7" ? "run_locked" : undefined, title: `Person ${id}` }))));
    const onClose = vi.fn();
    render(
      <BulkMoveDialog
        column={{ code: "received", name: "Received" }}
        columns={names}
        selection={{ all: true, total: 23 }}
        rules={rules}
        admin={false}
        listIds={listIds}
        move={move}
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByTestId("bulk-next"));
    expect(screen.getByTestId("bulk-summary")).toHaveTextContent("Move 23 to Review");
    await userEvent.click(screen.getByTestId("bulk-confirm"));
    await waitFor(() => expect(screen.getByTestId("bulk-progress")).toHaveTextContent("22 Moved, 1 Not Moved"));
    expect(listIds).toHaveBeenCalledWith("received");
    expect(move).toHaveBeenCalledTimes(3);
    expect(move.mock.calls.every(([r]) => r.from === "received" && r.to === "review")).toBe(true);
    expect(screen.getByTestId("bulk-refused")).toHaveTextContent("Person r7");
    await userEvent.click(screen.getByTestId("bulk-close"));
    expect(onClose).toHaveBeenCalledWith(true);
  });
});
