import type { RuleMark, RuleTone } from "./rules.js";

/** A mark: a tint, a dot and words — never colour alone. */
export function RuleChip({ mark, size = "sm" }: { mark: RuleMark; size?: "sm" | "xs" }) {
  return (
    <span className="zcu-chip" data-tone={mark.tone} data-size={size} data-rule={mark.key} title={mark.label}>
      <span className="zcu-chip-dot" aria-hidden="true" />
      {mark.label}
    </span>
  );
}

export function RuleChips({ marks, size }: { marks: RuleMark[]; size?: "sm" | "xs" }) {
  if (!marks.length) return null;
  return (
    <span className="zcu-chips">
      {marks.map((m) => (
        <RuleChip key={m.key} mark={m} size={size} />
      ))}
    </span>
  );
}

/** The one line on the record a step's rule shows. */
export function RuleLine({ line, testId = "rule-line" }: { line: { tone: RuleTone; text: string } | null; testId?: string }) {
  if (!line) return null;
  return (
    <p className="zcu-rule-line" data-tone={line.tone} data-testid={testId}>
      <span className="zcu-chip-dot" aria-hidden="true" />
      {line.text}
    </p>
  );
}
