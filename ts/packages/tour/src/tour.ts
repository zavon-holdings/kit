// Tours as data.
//
// A tour is an id and a list of steps. A step points at one element of the
// host's page by a `data-tour` value — never an arbitrary CSS selector — so a
// host can check, from its own source, that every step still has something to
// point at (`targetsOf`), and a renamed button fails a test rather than a
// customer's first visit.

export type Placement = "auto" | "top" | "bottom" | "left" | "right";

export type TourStep = {
  /** Unique within the tour. */
  id: string;
  /**
   * The `data-tour` value of the element this step lights up. Omit it for a
   * step that points at nothing (a welcome or a closing note): it is drawn
   * in the middle of the screen over the dimmed page.
   */
  target?: string;
  title: string;
  body: string;
  /** Further reading for this step: absolute, or a path joined to the host's `docsBase`. */
  docsUrl?: string;
  /** The link's words for this step; the labels' `learn` otherwise. */
  learnLabel?: string;
  placement?: Placement;
};

export type Tour = {
  id: string;
  /**
   * Raise it when the tour changes enough to show again to people who have
   * seen it: a stored record of an older version counts as not seen.
   */
  version?: number;
  steps: TourStep[];
};

/** `data-tour` values: lower case, digits, `-`, `.` and `:`. */
export const TARGET_PATTERN = /^[a-z0-9][a-z0-9.:-]*$/;

/** The selector for a step's target. */
export function selectorFor(target: string): string {
  return `[data-tour="${target.replace(/["\\]/g, "\\$&")}"]`;
}

/** Every target a tour (or several) names, once each, in order. */
export function targetsOf(tours: Tour | Tour[]): string[] {
  const out: string[] = [];
  for (const t of Array.isArray(tours) ? tours : [tours]) {
    for (const s of t.steps) if (s.target && !out.includes(s.target)) out.push(s.target);
  }
  return out;
}

/** Every docs link a tour (or several) names, once each, in order. */
export function docsUrlsOf(tours: Tour | Tour[]): string[] {
  const out: string[] = [];
  for (const t of Array.isArray(tours) ? tours : [tours]) {
    for (const s of t.steps) if (s.docsUrl && !out.includes(s.docsUrl)) out.push(s.docsUrl);
  }
  return out;
}

/**
 * A step's docs link made absolute against `base`. An absolute link is kept;
 * a path is joined with exactly one slash; no base leaves the path as it is.
 */
export function resolveDocsUrl(url: string, base?: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || !base) return url;
  return `${base.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
}

/** What is wrong with a tour, as sentences; empty when nothing is. */
export function validateTour(tour: Tour): string[] {
  const problems: string[] = [];
  if (!tour.id || !TARGET_PATTERN.test(tour.id)) problems.push(`tour id "${tour.id}" must match ${TARGET_PATTERN}`);
  if (tour.steps.length === 0) problems.push(`tour ${tour.id} has no steps`);
  const ids = new Set<string>();
  for (const [i, s] of tour.steps.entries()) {
    const at = `tour ${tour.id} step ${i + 1}`;
    if (!s.id) problems.push(`${at} has no id`);
    else if (ids.has(s.id)) problems.push(`${at}: id "${s.id}" is used twice`);
    ids.add(s.id);
    if (s.target !== undefined && !TARGET_PATTERN.test(s.target)) problems.push(`${at}: target "${s.target}" must match ${TARGET_PATTERN}`);
    if (!s.title.trim()) problems.push(`${at} has no title`);
    if (!s.body.trim()) problems.push(`${at} has no body`);
    if (s.docsUrl !== undefined && !/^(https:\/\/|\/)[^\s]*$/.test(s.docsUrl)) problems.push(`${at}: docsUrl "${s.docsUrl}" must be https:// or a path`);
  }
  return problems;
}
