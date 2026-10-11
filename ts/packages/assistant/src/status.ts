// What a screen draws for a status: hide what a person cannot have, grey
// what they could have, and show the price of what they can use. Prices
// always come from the status.
import type { AiStatus, AiToolStatus } from "./types.js";

/** The words a price is written in. A host passes its own for another language. */
export interface CreditCopy {
  /** A free tool. */
  free: string;
  /** A number of credits; `amount` is the number already written out. */
  credits: (amount: string, count: number) => string;
  /** The most a metered tool can cost; `price` is the credits written out. */
  upTo: (price: string) => string;
}

export const DEFAULT_CREDIT_COPY: CreditCopy = {
  free: "Free",
  credits: (amount, count) => (count === 1 ? `${amount} credit` : `${amount} credits`),
  upTo: (price) => `Up to ${price}`,
};

/** Says whether AI controls are drawn at all: hidden when not configured, off or blocked. */
export function isShown(status: AiStatus | null | undefined): boolean {
  if (!status) return false;
  return status.state === "no_permission" || status.state === "no_credits" || status.state === "ready";
}

/** Finds one tool in a status, by key. */
export function findTool(status: AiStatus | null | undefined, key: string): AiToolStatus | undefined {
  return status?.tools?.find((t) => t.key === key);
}

/** Why a control is greyed. */
export type AiGreyReason = "missing_permission" | "no_credits";

/** What a control for one tool is: hidden, greyed with a reason, or ready with its tool. */
export type AiToolState =
  | { state: "hidden" }
  | { state: "greyed"; reason: AiGreyReason; tool: AiToolStatus }
  | { state: "ready"; tool: AiToolStatus };

/**
 * The state of the control for one tool. The tool's own `allowed` and
 * `reason` decide between greyed and ready (a free tool can be ready while
 * the status says no_permission for the others); the status's state gives
 * the reason when the tool gives none.
 */
export function toolState(status: AiStatus | null | undefined, key: string): AiToolState {
  if (!status || !isShown(status)) return { state: "hidden" };
  const tool = findTool(status, key);
  if (!tool) return { state: "hidden" };
  if (tool.allowed) return { state: "ready", tool };
  const reason: AiGreyReason =
    tool.reason === "missing_permission" || tool.reason === "no_credits"
      ? tool.reason
      : status.state === "no_credits"
        ? "no_credits"
        : "missing_permission";
  return { state: "greyed", reason, tool };
}

/** Writes a number of whole credits to at most one decimal place. */
function amount(n: number): string {
  const tenths = Math.round(n * 10) / 10;
  return Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1);
}

/** A number of credits as words (one credit, several, a fraction to one decimal place), and the free word for 0. */
export function formatCredits(n: number, copy: Partial<CreditCopy> = {}): string {
  const c = { ...DEFAULT_CREDIT_COPY, ...copy };
  if (!Number.isFinite(n) || n <= 0) return c.free;
  return c.credits(amount(n), Math.round(n * 10) / 10);
}

/** A tool's price label, from its status: its credits, "Up to" its hold when metered, the free word when free. */
export function priceLabel(tool: AiToolStatus, copy: Partial<CreditCopy> = {}): string {
  const c = { ...DEFAULT_CREDIT_COPY, ...copy };
  if (tool.pricing_mode === "free" || !(tool.credits > 0)) return c.free;
  const price = formatCredits(tool.credits, c);
  return tool.pricing_mode === "metered" ? c.upTo(price) : price;
}
