// The wire of an AI gateway's property routes, field for field as kit's
// go/aiclient has it and as contract/ai holds it.
//
// Units: fields named *_tenths are tenths of a credit, as integers. credits,
// credits_charged, balance and required (on insufficient_credits) are whole
// credits, which may be fractional.
//
// The gateway holds the prices and the permissions. A screen reads both from
// a status; it never carries a price of its own.

/** States a status carries, in the order the gateway checks them. */
export const AI_STATES = ["not_configured", "off", "blocked", "no_permission", "no_credits", "ready"] as const;
export type AiState = (typeof AI_STATES)[number];

/** Pricing modes of a tool. */
export const AI_PRICING_MODES = ["fixed", "metered", "free"] as const;
export type AiPricingMode = (typeof AI_PRICING_MODES)[number];

/** Why a tool is not allowed. "" when it is. */
export type AiToolReason = "" | "missing_permission" | "no_credits";

/** Job statuses. */
export const AI_JOB_STATUSES = ["queued", "running", "done", "failed", "cancelled"] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

/** Error codes the gateway answers. */
export const AI_ERROR_CODES = [
  "invalid_body",
  "invalid_input",
  "idempotency_key_required",
  "idempotency_key_reused",
  "not_found",
  "ai_not_configured",
  "ai_off",
  "ai_unavailable",
  "ai_blocked",
  "acting_refused",
  "missing_permission",
  "rate_limited",
  "daily_limit",
  "ai_cap_reached",
  "insufficient_credits",
  "ai_refused",
  "ai_provider_error",
  "ai_output_invalid",
  "ai_output_refused",
  "ai_timeout",
  "forbidden",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/** The switch that is off: env, platform, product, org, org_product, block_tenant or block_actor. "" otherwise. */
export type AiLayer = "" | "env" | "platform" | "product" | "org" | "org_product" | "block_tenant" | "block_actor";

/** A notice a status can carry. "" for none. */
export type AiNotice = "" | "cap_50" | "cap_80" | "cap_100" | "low_balance";

/** The person a request is for. Acting (somebody acting as another person) is refused. */
export interface AiActor {
  email: string;
  sub: string;
  acting: boolean;
}

/** The body of POST /api/ai/invoke and POST /api/ai/jobs. No price field and no permission field. */
export interface AiInvokeRequest<I = unknown> {
  tenant: string;
  actor: AiActor;
  tool_key: string;
  resource: string;
  input: I;
}

/** A tool's answer and what it cost. */
export interface AiInvokeResult<R = unknown> {
  result: R;
  credits_charged: number;
  balance: number;
  usage_event_id: string;
}

/** One tool as a screen shows it. */
export interface AiToolStatus {
  key: string;
  /** The price in whole credits: the fixed price, the hold (the maximum) for a metered tool, 0 for a free one. */
  credits: number;
  pricing_mode: AiPricingMode;
  allowed: boolean;
  reason: AiToolReason;
}

/** GET /api/ai/status. */
export interface AiStatus {
  state: AiState;
  layer: AiLayer;
  balance_tenths: number;
  monthly_cap_tenths: number;
  /** The same cap in whole credits; 0 is no cap. */
  monthly_cap: number;
  month_used_tenths: number;
  notice: AiNotice;
  tools: AiToolStatus[];
}

/** POST /api/ai/jobs. */
export interface AiJobAccepted {
  job_id: string;
  status: AiJobStatus;
}

/** GET /api/ai/jobs/{id}. */
export interface AiJob<R = unknown> {
  id: string;
  status: AiJobStatus;
  result: R;
  error: string;
  credits_charged: number;
  balance: number;
  usage_event_id: string;
}

/** POST /api/ai/feedback. Only tenant and usage_event_id are required. */
export interface AiFeedback {
  tenant: string;
  usage_event_id: string;
  accepted?: boolean;
  edit_ratio?: number;
  /** 1 for thumbs up, -1 for thumbs down. */
  rating?: number;
  comment?: string;
}

/** One line of an organisation's AI credit ledger. */
export interface AiLedgerLine {
  at: string;
  delta_tenths: number;
  reason: string;
  ref: string;
  actor: string;
}

/** GET /api/ai/org/{tenant}/summary: one organisation's AI settings and numbers. */
export interface AiOrgSummary {
  tenant: string;
  state: AiState;
  layer: AiLayer;
  features: Record<string, boolean>;
  balance_tenths: number;
  monthly_cap_tenths: number;
  month_used_tenths: number;
  popia_notice_accepted_at: string;
  popia_notice_accepted_by: string;
  widgets: Record<string, unknown>;
  ledger: AiLedgerLine[];
}

/** PUT /api/ai/org/{tenant}/settings. Absent fields are left as they are. */
export interface AiOrgSettings {
  actor: AiActor;
  monthly_cap_tenths?: number;
  accept_popia_notice?: boolean;
}

/** An answer that was not a success. */
export interface AiError {
  /** The HTTP status. Not on the wire: a host's client may set it. */
  status?: number;
  code: AiErrorCode | (string & {});
  /** The message. */
  error: string;
  detail?: unknown;
  /** The switch that is off, on ai_off. */
  layer?: AiLayer;
  /** A permission string on missing_permission; whole credits on insufficient_credits. */
  required?: string | number;
  balance?: number;
  required_tenths?: number;
  balance_tenths?: number;
  credits_charged?: number;
}

/** platform.docs.answer: one source of an answer. */
export interface AiCitation {
  title: string;
  url: string;
}

/** platform.docs.answer: the result. A host may add the usage event id for feedback. */
export interface AiDocsAnswer {
  answer: string;
  citations: AiCitation[];
  usage_event_id?: string;
}

/** Says whether a job will change no further. */
export function isJobFinished(job: Pick<AiJob, "status">): boolean {
  return job.status === "done" || job.status === "failed" || job.status === "cancelled";
}

/** Says whether a value is an error answer from the gateway (it has a code and a message). */
export function isAiError(value: unknown): value is AiError {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.code === "string" && typeof v.error === "string";
}

/** The permission a missing_permission names, or "". */
export function requiredPermission(err: AiError): string {
  return typeof err.required === "string" ? err.required : "";
}

/** The whole credits an insufficient_credits needs, or 0. */
export function requiredCredits(err: AiError): number {
  return typeof err.required === "number" ? err.required : 0;
}
