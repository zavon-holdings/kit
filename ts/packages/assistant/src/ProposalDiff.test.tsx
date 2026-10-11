import { describe, expect, test } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ProposalDiff } from "./ProposalDiff.js";
import { countChanges, diffFields, diffItems } from "./diff.js";
import { vector, violations } from "./test/helpers.js";

type Block = { type: string; data: Record<string, unknown> };

const p = (text: string): Block => ({ type: "text", data: { text } });
const h = (text: string): Block => ({ type: "heading", data: { eyebrow: "Visit", text } });

describe("diffItems", () => {
  test("keeps equal items, pairs a removal and an addition in one place as a change", () => {
    const d = diffItems([h("Hours"), p("Old text"), p("Kept")], [h("Hours"), p("New text"), p("Kept"), p("More")]);
    expect(d.map((x) => x.kind)).toEqual(["unchanged", "changed", "unchanged", "added"]);
    expect(d[1].before).toEqual(p("Old text"));
    expect(d[1].after).toEqual(p("New text"));
  });

  test("a removal with nothing in its place is removed", () => {
    const d = diffItems(["a", "b", "c"], ["a", "c"]);
    expect(d.map((x) => x.kind)).toEqual(["unchanged", "removed", "unchanged"]);
  });

  test("by key: changed, unchanged, added and removed in place", () => {
    const before = [{ ref: "1", t: "a" }, { ref: "2", t: "b" }, { ref: "3", t: "c" }];
    const after = [{ ref: "1", t: "a" }, { ref: "3", t: "C" }, { ref: "4", t: "d" }];
    const d = diffItems(before, after, (x) => x.ref);
    expect(d.map((x) => `${x.kind}:${x.key}`)).toEqual(["unchanged:1", "removed:2", "changed:3", "added:4"]);
    expect(countChanges(d)).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 1 });
  });

  test("diffFields: changed, unchanged, added and removed", () => {
    const d = diffFields({ title: "A", description: "Same", alt: "x" }, { title: "B", description: "Same", tags: "new" });
    expect(d).toEqual([
      { kind: "changed", field: "title", before: "A", after: "B" },
      { kind: "unchanged", field: "description", before: "Same", after: "Same" },
      { kind: "removed", field: "alt", before: "x" },
      { kind: "added", field: "tags", after: "new" },
    ]);
  });
});

describe("ProposalDiff", () => {
  test("marks blocks added, removed and changed with words, in a list", async () => {
    // The section tool's contract result, proposed after one old block.
    const result = vector<{ result: { blocks: Block[] } }>("tools/pages.section.generate.json").result;
    const before = [h("Opening hours"), p("Closed on Sundays."), p("Call us.")];
    const after = [result.blocks[0], result.blocks[1]];
    render(<ProposalDiff before={before} after={after} />);
    const list = screen.getByRole("list", { name: "Proposed changes" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-kind"))).toEqual(["unchanged", "changed", "removed"]);
    expect(items[1]).toHaveTextContent("Changed");
    expect(items[1]).toHaveTextContent("BeforeClosed on Sundays.");
    expect(items[1]).toHaveTextContent(`After${result.blocks[1].data.text as string}`);
    expect(items[1].querySelector("del")).toHaveTextContent("Closed on Sundays.");
    expect(items[1].querySelector("ins")).toHaveTextContent(result.blocks[1].data.text as string);
    expect(items[2]).toHaveTextContent("RemovedCall us.");
    expect(screen.getByText("0 added, 1 changed, 1 removed")).toBeInTheDocument();
    expect(await violations()).toEqual([]);
  });

  test("plain fields with labels, an added item, and unchanged items left out on request", async () => {
    render(
      <ProposalDiff
        before={{ title: "Volunteer", description: "Old" }}
        after={{ title: "Volunteer", description: "Give a few hours a month.", alt: "A team at work" }}
        fieldLabels={{ title: "Title", description: "Description", alt: "Image text" }}
        hideUnchanged
      />,
    );
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("ChangedDescription");
    expect(items[1]).toHaveTextContent("AddedImage textA team at work");
    expect(await violations()).toEqual([]);
  });

  test("the host draws items and names the marks", () => {
    render(
      <ProposalDiff
        before={[]}
        after={[p("Hello")]}
        renderItem={(b) => <em>{String((b as Block).data.text)}!</em>}
        copy={{ added: "New", summary: (c) => `${c.added} new` }}
      />,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent("NewHello!");
    expect(screen.getByText("1 new")).toBeInTheDocument();
  });

  test("says when nothing changes", () => {
    render(<ProposalDiff before={["a"]} after={["a"]} hideUnchanged />);
    expect(screen.getByText("No changes.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
