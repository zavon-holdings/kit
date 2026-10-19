import { useState } from "react";
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import type { Scale } from "@zavon/bands";
import { ScoreBandsEditor } from "./ScoreBandsEditor.js";
import { bandRanges, scaleProblems, sortedBands } from "../scoreScale.js";

// The band editor (item 70): bands highest first, the rules core applies
// said where they apply, and a preview of where a score lands.

const interview: Scale = {
  key: "interview", label: "Interview", unit: "percent",
  bands: [
    { min_value: 0, label: "Weak", tone: "critical", recommendation: "" },
    { min_value: 80, label: "Strong", tone: "good", recommendation: "" },
    { min_value: 70, label: "Borderline", tone: "warning", recommendation: "Review by hand" },
  ],
};

function Harness({ initial, onSave }: { initial: Scale; onSave?: (s: Scale) => void }) {
  const [scale, setScale] = useState({ ...initial, bands: sortedBands(initial.bands) });
  return <ScoreBandsEditor scale={scale} onChange={setScale} onSave={onSave} />;
}

describe("score bands", () => {
  test("the rules core applies", () => {
    expect(scaleProblems(interview)).toEqual([]);
    const bad = scaleProblems({ ...interview, key: "Interview Scale", bands: [...interview.bands, { min_value: 70, label: "", tone: "ok", recommendation: "" }] });
    expect(bad.map((p) => p.message)).toEqual([
      "A key is lower-case letters, digits and underscores.",
      "Two bands start at 70.",
      "A band's label is 1 to 60 characters.",
    ]);
    expect(bandRanges(interview.bands, "percent")).toEqual(["0% to under 70%", "80% and above", "70% to under 80%"]);
  });

  test("bands show highest first, a score's band is previewed, and a bad scale cannot be saved", async () => {
    const user = userEvent.setup();
    const saved: Scale[] = [];
    render(<Harness initial={interview} onSave={(s) => { saved.push(s); }} />);
    expect((screen.getByLabelText("Band 1 label") as HTMLInputElement).value).toBe("Strong");
    expect((screen.getByLabelText("Band 3 label") as HTMLInputElement).value).toBe("Weak");
    expect(screen.getByText("75% is Borderline: Review by hand")).toBeTruthy();

    await user.clear(screen.getByLabelText("Band 2 starts at"));
    await user.type(screen.getByLabelText("Band 2 starts at"), "80");
    expect(screen.getAllByText("Two bands start at 80.").length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);

    await user.clear(screen.getByLabelText("Band 2 starts at"));
    await user.type(screen.getByLabelText("Band 2 starts at"), "90");
    // Still the row being typed in; put in order once it is left.
    expect((screen.getByLabelText("Band 2 label") as HTMLInputElement).value).toBe("Borderline");
    await user.tab();
    expect((screen.getByLabelText("Band 1 label") as HTMLInputElement).value).toBe("Borderline");
    await user.clear(screen.getByLabelText("Band 1 starts at"));
    await user.type(screen.getByLabelText("Band 1 starts at"), "65");
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saved).toHaveLength(1);
    expect(saved[0].bands.map((b) => b.min_value)).toEqual([80, 65, 0]);
    expect(await violations()).toEqual([]);
  });

  test("a band is added below the lowest and removed by its own button", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...interview, bands: [{ min_value: 50, label: "Pass", tone: "good", recommendation: "" }] }} />);
    await user.click(screen.getByRole("button", { name: "Add a band" }));
    expect((screen.getByLabelText("Band 2 starts at") as HTMLInputElement).value).toBe("40");
    await user.click(screen.getByRole("button", { name: "Remove band 1" }));
    expect(screen.queryByLabelText("Band 2 starts at")).toBeNull();
  });
});

async function violations(): Promise<string[]> {
  const out = await axe.run(document.body, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false }, "page-has-heading-one": { enabled: false }, "landmark-one-main": { enabled: false } },
  });
  return out.violations.map((v) => `${v.id}: ${v.help}`);
}
