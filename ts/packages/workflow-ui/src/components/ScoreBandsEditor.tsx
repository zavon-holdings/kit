"use client";

import { useId, useState } from "react";
import type { Band, Scale, Tone } from "@zavon/bands";
import { bandRanges, MAX_BANDS, nextBand, previewBand, scaleProblems, sortedBands, TONES } from "../scoreScale.js";
import { Heading } from "./Heading.js";

export type ScoreBandsEditorProps = {
  scale: Scale;
  onChange?: (next: Scale) => void;
  /** Saves the scale; the host calls core (PUT /api/workflows/score-scales/{key}). */
  onSave?: (scale: Scale) => void | Promise<void>;
  /** A new scale names its key; an existing one shows it read-only. */
  isNew?: boolean;
  readOnly?: boolean;
  /** Heading level; the section's heading is one level below the host's. */
  headingLevel?: number;
  /** What the host says went wrong saving, shown above the button. */
  error?: string;
};

/**
 * The band editor (item 70): a score scale's bands, highest first, each a
 * starting score, a label, a tone and an optional recommendation that flags
 * the record; a preview that says which band a score lands in; and the
 * rules core will apply, said beside the field they are about.
 */
export function ScoreBandsEditor(props: ScoreBandsEditorProps) {
  const { scale, onChange, onSave, isNew, readOnly, headingLevel = 2, error } = props;
  const uid = useId();
  const [tryScore, setTryScore] = useState("75");
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const problems = scaleProblems(scale);
  const shown = touched ? problems : [];
  const about = (band: number | undefined, field: string) => shown.find((p) => p.band === band && p.field === field)?.message;
  const set = (next: Partial<Scale>) => {
    setTouched(true);
    onChange?.({ ...scale, ...next });
  };
  // Shown as given (the host hands them over highest first), and put back
  // in order when a starting score is left: re-sorting while somebody types
  // would move the row out from under them.
  const bands = scale.bands;
  const setBand = (i: number, b: Partial<Band>) => set({ bands: bands.map((x, j) => (j === i ? { ...x, ...b } : x)) });
  const ranges = bandRanges(bands, scale.unit);
  const score = Number(tryScore);
  const landed = tryScore.trim() !== "" && Number.isFinite(score) ? previewBand(scale, score) : null;
  const unit = scale.unit === "percent" ? "%" : " points";

  return (
    <section className="zwf-bands" aria-labelledby={`${uid}-h`}>
      <Heading level={headingLevel} id={`${uid}-h`}>
        Score bands
      </Heading>
      <div className="zwf-fields">
        <label className="zwf-field">
          <span>Name</span>
          <input value={scale.label} readOnly={readOnly} maxLength={80} aria-invalid={!!about(undefined, "scale_label")}
            onChange={(e) => set({ label: e.target.value })} />
          {about(undefined, "scale_label") && <span className="zwf-field-error">{about(undefined, "scale_label")}</span>}
        </label>
        <label className="zwf-field">
          <span>Key</span>
          <input value={scale.key} readOnly={readOnly || !isNew} maxLength={40} aria-invalid={!!about(undefined, "key")}
            onChange={(e) => set({ key: e.target.value.toLowerCase() })} />
          {about(undefined, "key") && <span className="zwf-field-error">{about(undefined, "key")}</span>}
        </label>
        <label className="zwf-field">
          <span>Unit</span>
          <select value={scale.unit} disabled={readOnly} onChange={(e) => set({ unit: e.target.value })}>
            <option value="percent">Percent</option>
            <option value="points">Points</option>
          </select>
        </label>
      </div>

      <table className="zwf-bands-table">
        <caption className="zwf-visually-hidden">Bands, highest first</caption>
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">Label</th>
            <th scope="col">Tone</th>
            <th scope="col">Recommendation</th>
            <th scope="col"><span className="zwf-visually-hidden">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {bands.length === 0 && (
            <tr>
              <td colSpan={5} className="zwf-help">No bands.</td>
            </tr>
          )}
          {bands.map((b, i) => (
            <tr key={i}>
              <td>
                <input type="number" step="any" aria-label={`Band ${i + 1} starts at`} value={Number.isFinite(b.min_value) ? b.min_value : ""}
                  readOnly={readOnly} aria-invalid={!!about(i, "min_value")}
                  onChange={(e) => setBand(i, { min_value: e.target.value === "" ? NaN : Number(e.target.value) })}
                  onBlur={() => onChange?.({ ...scale, bands: sortedBands(scale.bands) })} />
                {ranges[i] && <span className="zwf-help">{ranges[i]}</span>}
                {about(i, "min_value") && <span className="zwf-field-error">{about(i, "min_value")}</span>}
              </td>
              <td>
                <input aria-label={`Band ${i + 1} label`} value={b.label} maxLength={60} readOnly={readOnly} aria-invalid={!!about(i, "label")}
                  onChange={(e) => setBand(i, { label: e.target.value })} />
                {about(i, "label") && <span className="zwf-field-error">{about(i, "label")}</span>}
              </td>
              <td>
                <select aria-label={`Band ${i + 1} tone`} value={b.tone} disabled={readOnly} onChange={(e) => setBand(i, { tone: e.target.value as Tone })}>
                  {TONES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </td>
              <td>
                <input aria-label={`Band ${i + 1} recommendation`} value={b.recommendation} maxLength={160} readOnly={readOnly}
                  placeholder="None: not flagged" onChange={(e) => setBand(i, { recommendation: e.target.value })} />
                {about(i, "recommendation") && <span className="zwf-field-error">{about(i, "recommendation")}</span>}
              </td>
              <td>
                {!readOnly && (
                  <button type="button" className="zwf-button" aria-label={`Remove band ${i + 1}`}
                    onClick={() => set({ bands: bands.filter((_, j) => j !== i) })}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <button type="button" className="zwf-button" disabled={bands.length >= MAX_BANDS}
          onClick={() => set({ bands: [...bands, nextBand(bands)] })}>
          Add a band
        </button>
      )}
      <p className="zwf-help">A band with a recommendation flags the record for a person to look at.</p>

      <div className="zwf-bands-try">
        <label className="zwf-field">
          <span>Try a score</span>
          <input type="number" step="any" value={tryScore} onChange={(e) => setTryScore(e.target.value)} />
        </label>
        <p aria-live="polite">
          {tryScore.trim() === "" ? "" : landed
            ? `${tryScore}${unit} is ${landed.label}${landed.recommendation ? `: ${landed.recommendation}` : "."}`
            : `${tryScore}${unit} is below every band.`}
        </p>
      </div>

      {onSave && !readOnly && (
        <div className="zwf-bands-actions">
          {error && <p className="zwf-field-error" role="alert">{error}</p>}
          {touched && problems.length > 0 && <p className="zwf-field-error">Fix {problems.length === 1 ? "the problem" : `the ${problems.length} problems`} above to save.</p>}
          <button type="button" className="zwf-button zwf-primary" disabled={saving || problems.length > 0}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({ ...scale, bands: sortedBands(scale.bands) });
              } finally {
                setSaving(false);
              }
            }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </section>
  );
}
