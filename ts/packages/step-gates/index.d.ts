/** A step as the rule reads it. */
export type GateStage = {
  code?: string;
  name?: string;
  /** Position in the flow; a higher number is further on. */
  order: number;
  /** True for a step that closes the item without success (declined, withdrawn). */
  closing?: boolean;
  /** Field keys that must be filled before an item leaves this step forward. */
  required?: string[];
};

/** One field a step may require: from a form, the record itself, or a field the step keeps. */
export type CatalogueField = {
  key: string;
  label: string;
  type?: string;
  /** Where the value comes from, in words: "Form: Application", "Kept on the item". */
  source?: string;
  options?: string[];
};

export declare const FIELDS_REQUIRED: "stage_fields_required";
export declare function isFilled(value: unknown): boolean;
export declare function missingFields(
  from: GateStage | null | undefined,
  to: GateStage | null | undefined,
  filled: Set<string> | string[] | ((key: string) => boolean),
  catalogue?: string[],
): string[];
export declare function joinLabels(labels: string[]): string;
export declare function requirementSentence(stage: string, labels: string[]): string;
export declare function blockedMessage(stage: string, labels: string[]): string;

export type FieldsRequired = { stage: string; fields: string[]; labels: Record<string, string>; message: string };
export declare function parseFieldsRequired(status: number, body: unknown): FieldsRequired | null;

export type SnoozeUnit = "days" | "weeks" | "months";
export type SnoozeRequest = { count?: number; unit?: SnoozeUnit | string; until?: string };
export declare const SNOOZE_UNITS: SnoozeUnit[];
export declare const MAX_AHEAD_DAYS: number;
export declare const SNOOZE_PRESETS: { key: string; label: string; count: number; unit: SnoozeUnit }[];
export declare class SnoozeError extends Error {
  code: "empty" | "both_forms" | "unit" | "count" | "unreadable" | "past" | "too_far";
}
export declare function resolveSnooze(req: SnoozeRequest, now?: Date): Date;
export declare function isSnoozed(until: string | null | undefined, now?: Date): boolean;
export declare function snoozeLabel(until: string | null | undefined, now?: Date, locale?: string): string;

export type SnoozedFilter = "" | "hide" | "only";
export declare const SNOOZED_FILTERS: SnoozedFilter[];
export declare function filterSnoozed<T>(
  items: T[],
  filter?: SnoozedFilter,
  opts?: { now?: Date; stageOf?: (item: T) => string | null | undefined; untilOf?: (item: T) => string | null | undefined },
): { items: T[]; total: number; counts: Record<string, number>; snoozedCount: number };
export declare function loadShowSnoozed(key: string, storage?: Pick<Storage, "getItem">): boolean;
export declare function saveShowSnoozed(key: string, value: boolean, storage?: Pick<Storage, "setItem">): void;
export declare function snoozedToggleLabel(show: boolean, count: number): string;
