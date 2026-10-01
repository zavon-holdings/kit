/**
 * Test scenarios: a named sample, the answers given at its stops, and what
 * the walk must come to. Saved beside a definition and run as a regression
 * check whenever the graph changes, so "this sample still ends approved" is
 * a fact somebody wrote down rather than something they remember to check.
 *
 * `checkScenario` is the rule; a service that gates saves on scenarios is
 * expected to apply the same one.
 */
import type { Sample, SimulateResult } from "./types.js";

export type ScenarioExpect = {
  /** The run ends with this outcome. */
  outcome?: string;
  /** The run ends (true) or stops for an answer (false). */
  ended?: boolean;
  /** The walk stops for an answer at this step. */
  stops_at?: string;
  /** Nodes the path passes, and nodes it must not. */
  path_includes?: string[];
  path_excludes?: string[];
};

export type Scenario = {
  name: string;
  sample: Sample;
  decisions: Record<string, string>;
  outputs?: Record<string, Record<string, unknown>>;
  expect: ScenarioExpect;
  updated_at?: string;
};

export type ScenarioResult = { name: string; pass: boolean; why: string; result?: SimulateResult };

/** Whether a walk came out as the scenario says; `why` names the first thing that did not. */
export function checkScenario(expect: ScenarioExpect, result: SimulateResult): { pass: boolean; why: string } {
  const fails: string[] = [];
  if (expect.ended !== undefined) {
    if (expect.ended && !result.ended) fails.push(result.stopped ? `it stopped at ${result.stopped.code} instead of ending` : "it did not end");
    if (!expect.ended && result.ended) fails.push(`it ended (${result.ended.outcome}) instead of stopping`);
  }
  if (expect.outcome !== undefined) {
    if (!result.ended) fails.push(`it did not end, so it has no outcome; ${expect.outcome} was expected`);
    else if (result.ended.outcome !== expect.outcome) fails.push(`it ended ${result.ended.outcome}, not ${expect.outcome}`);
  }
  if (expect.stops_at !== undefined) {
    if (!result.stopped) fails.push(`it never stopped at ${expect.stops_at}`);
    else if (result.stopped.code !== expect.stops_at && result.stopped.node !== expect.stops_at) fails.push(`it stopped at ${result.stopped.code}, not ${expect.stops_at}`);
  }
  const path = new Set(result.path ?? []);
  for (const id of expect.path_includes ?? []) if (!path.has(id)) fails.push(`it never passed ${id}`);
  for (const id of expect.path_excludes ?? []) if (path.has(id)) fails.push(`it passed ${id}, which it must not`);
  return fails.length ? { pass: false, why: fails[0] } : { pass: true, why: "as expected" };
}

/** What a scenario saved from a walk expects: the outcome it ended with, or where it stopped. */
export function expectFrom(result: SimulateResult): ScenarioExpect {
  if (result.ended) return { ended: true, outcome: result.ended.outcome };
  if (result.stopped) return { ended: false, stops_at: result.stopped.code };
  return {};
}

/** The expectation in words. */
export function describeExpect(e: ScenarioExpect): string {
  const parts: string[] = [];
  if (e.outcome) parts.push(`ends ${e.outcome}`);
  else if (e.ended === true) parts.push("ends");
  if (e.stops_at) parts.push(`stops at ${e.stops_at}`);
  else if (e.ended === false) parts.push("stops for an answer");
  if (e.path_includes?.length) parts.push(`passes ${e.path_includes.join(", ")}`);
  if (e.path_excludes?.length) parts.push(`never passes ${e.path_excludes.join(", ")}`);
  return parts.length ? parts.join("; ") : "anything (nothing expected yet)";
}

/** A scenario name: words a person can read, unique among the others. */
export function scenarioNameProblem(name: string, others: string[]): string | null {
  const n = name.trim();
  if (!n) return "Give the scenario a name.";
  if (n.length > 80) return "Keep the name under 80 characters.";
  if (!/^[\p{L}\p{N} _.,'()-]+$/u.test(n)) return "Use letters, digits, spaces and simple punctuation.";
  if (others.some((o) => o.toLowerCase() === n.toLowerCase())) return `There is already a scenario called ${n}.`;
  return null;
}
