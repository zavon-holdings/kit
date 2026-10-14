// Which band of a scale a score is in. The twin of kit/go/bands, held to the
// same vectors (contract/bands).

const TONES = new Set(["good", "ok", "warning", "critical"]);

/** Throws an Error whose message is the vector's error code. */
export function check(scale) {
  const seen = new Set();
  for (const b of scale.bands ?? []) {
    if (!TONES.has(b.tone)) throw new Error("unknown_tone");
    if (seen.has(b.min_value)) throw new Error("duplicate_min_value");
    seen.add(b.min_value);
  }
}

/** The band with the highest min_value at or below value, or null. */
export function bandOf(scale, value) {
  check(scale);
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const sorted = [...(scale.bands ?? [])].sort((a, b) => b.min_value - a.min_value);
  for (const b of sorted) {
    if (value >= b.min_value) return { ...b };
  }
  return null;
}
