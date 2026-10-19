import { bandOf, type Band, type Scale, type Tone } from "@zavon/bands";

/**
 * A score scale's bands as an organisation edits them (workflow-port §2.7):
 * "80 and above is Strong", each band a starting score, a label, a tone and,
 * when the record needs a person's eye, a recommendation that flags it. The
 * rules are core's (`NormaliseScale`), checked here so the screen can say
 * what is wrong before it asks; core checks them again.
 */

export const TONES: { value: Tone; label: string }[] = [
  { value: "good", label: "Good" },
  { value: "ok", label: "Fine" },
  { value: "warning", label: "Warning" },
  { value: "critical", label: "Critical" },
];

export const MAX_BANDS = 20;

export type ScaleProblem = { band?: number; field?: "min_value" | "label" | "recommendation" | "key" | "scale_label"; message: string };

/** What is wrong with a scale, each against the band (by index) it is about. */
export function scaleProblems(scale: Scale): ScaleProblem[] {
  const out: ScaleProblem[] = [];
  if (!/^[a-z0-9_]{1,40}$/.test(scale.key)) out.push({ field: "key", message: "A key is lower-case letters, digits and underscores." });
  const label = scale.label.trim();
  if (label === "" || label.length > 80) out.push({ field: "scale_label", message: "A scale's name is 1 to 80 characters." });
  if (scale.bands.length > MAX_BANDS) out.push({ message: `At most ${MAX_BANDS} bands.` });
  const seen = new Map<number, number>();
  scale.bands.forEach((b, i) => {
    if (!Number.isFinite(b.min_value)) out.push({ band: i, field: "min_value", message: "A band starts at a number." });
    else if (seen.has(b.min_value)) out.push({ band: i, field: "min_value", message: `Two bands start at ${b.min_value}.` });
    else seen.set(b.min_value, i);
    const l = b.label.trim();
    if (l === "" || l.length > 60) out.push({ band: i, field: "label", message: "A band's label is 1 to 60 characters." });
    if (b.recommendation.trim().length > 160) out.push({ band: i, field: "recommendation", message: "A recommendation is at most 160 characters." });
  });
  return out;
}

/** The bands highest first, as core stores and shows them. */
export function sortedBands(bands: Band[]): Band[] {
  // A band still being typed (no number yet) stays at the bottom.
  const n = (v: number) => (Number.isFinite(v) ? v : -Infinity);
  return [...bands].sort((a, b) => n(b.min_value) - n(a.min_value));
}

/** The band a score falls in, or null — below every band, or a scale that does not check. */
export function previewBand(scale: Scale, value: number): Band | null {
  try {
    return bandOf(scale, value);
  } catch {
    return null;
  }
}

/** "80% and above", "70% to under 80%": what each band covers, in the order given. */
export function bandRanges(bands: Band[], unit: string): string[] {
  const u = unit === "percent" ? "%" : "";
  return bands.map((b) => {
    if (!Number.isFinite(b.min_value)) return "";
    const above = bands.map((x) => x.min_value).filter((v) => Number.isFinite(v) && v > b.min_value);
    return above.length === 0 ? `${b.min_value}${u} and above` : `${b.min_value}${u} to under ${Math.min(...above)}${u}`;
  });
}

/** A new band below the lowest, so adding one never collides. */
export function nextBand(bands: Band[]): Band {
  const lowest = bands.length ? Math.min(...bands.map((b) => b.min_value)) : 80;
  return { min_value: bands.length ? Math.max(0, lowest - 10) : lowest, label: "", tone: "ok", recommendation: "" };
}
