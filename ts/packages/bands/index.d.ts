export type Tone = "good" | "ok" | "warning" | "critical";

export interface Band {
  min_value: number;
  label: string;
  tone: Tone;
  recommendation: string;
}

export interface Scale {
  key: string;
  label: string;
  unit: string;
  bands: Band[];
}

/** Throws an Error whose message is "unknown_tone" or "duplicate_min_value". */
export function check(scale: Scale): void;

/** The band with the highest min_value at or below value; null below every band. */
export function bandOf(scale: Scale, value: number): Band | null;
