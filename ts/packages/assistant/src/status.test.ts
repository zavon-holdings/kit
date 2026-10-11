import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { formatCredits, isShown, priceLabel, toolState, findTool } from "./status.js";
import {
  AI_ERROR_CODES,
  AI_STATES,
  isAiError,
  isJobFinished,
  requiredCredits,
  requiredPermission,
  type AiError,
  type AiFeedback,
  type AiInvokeRequest,
  type AiInvokeResult,
  type AiJob,
  type AiJobAccepted,
  type AiLedgerLine,
  type AiOrgSettings,
  type AiOrgSummary,
  type AiState,
  type AiStatus,
  type AiToolStatus,
} from "./types.js";
import { contractDir, vector } from "./test/helpers.js";

const ready = vector<AiStatus>("status-ready.json");
const noPermission = vector<AiStatus>("status-no-permission.json");
const notConfigured = vector<AiStatus>("status-not-configured.json");
const off = vector<AiStatus>("status-off.json");

function withState(state: AiState, tools: AiToolStatus[] = ready.tools): AiStatus {
  return { ...ready, state, tools };
}

// A key set per wire type: `satisfies Record<keyof T, 1>` fails the
// typecheck on a missing or an extra key, and the test compares it with the
// vector, so the TypeScript and the contract agree field for field.
const keys = {
  status: { state: 1, layer: 1, balance_tenths: 1, monthly_cap_tenths: 1, monthly_cap: 1, month_used_tenths: 1, notice: 1, tools: 1 } satisfies Record<keyof AiStatus, 1>,
  tool: { key: 1, credits: 1, pricing_mode: 1, allowed: 1, reason: 1 } satisfies Record<keyof AiToolStatus, 1>,
  invokeRequest: { tenant: 1, actor: 1, tool_key: 1, resource: 1, input: 1 } satisfies Record<keyof AiInvokeRequest, 1>,
  invokeResult: { result: 1, credits_charged: 1, balance: 1, usage_event_id: 1 } satisfies Record<keyof AiInvokeResult, 1>,
  job: { id: 1, status: 1, result: 1, error: 1, credits_charged: 1, balance: 1, usage_event_id: 1 } satisfies Record<keyof AiJob, 1>,
  jobAccepted: { job_id: 1, status: 1 } satisfies Record<keyof AiJobAccepted, 1>,
  feedback: { tenant: 1, usage_event_id: 1, accepted: 1, edit_ratio: 1, rating: 1, comment: 1 } satisfies Record<keyof AiFeedback, 1>,
  ledger: { at: 1, delta_tenths: 1, reason: 1, ref: 1, actor: 1 } satisfies Record<keyof AiLedgerLine, 1>,
  orgSummary: {
    tenant: 1,
    state: 1,
    layer: 1,
    features: 1,
    balance_tenths: 1,
    monthly_cap_tenths: 1,
    month_used_tenths: 1,
    popia_notice_accepted_at: 1,
    popia_notice_accepted_by: 1,
    widgets: 1,
    ledger: 1,
  } satisfies Record<keyof AiOrgSummary, 1>,
  orgSettings: { actor: 1, monthly_cap_tenths: 1, accept_popia_notice: 1 } satisfies Record<keyof AiOrgSettings, 1>,
  error: {
    status: 1,
    code: 1,
    error: 1,
    detail: 1,
    layer: 1,
    required: 1,
    balance: 1,
    required_tenths: 1,
    balance_tenths: 1,
    credits_charged: 1,
  } satisfies Record<keyof AiError, 1>,
};

const sorted = (o: object) => Object.keys(o).sort();

describe("the wire types mirror contract/ai", () => {
  test("every status vector has exactly the status and tool fields", () => {
    for (const s of [ready, noPermission, notConfigured, off]) {
      expect(sorted(s)).toEqual(sorted(keys.status));
      expect(AI_STATES).toContain(s.state);
      for (const t of s.tools) expect(sorted(t)).toEqual(sorted(keys.tool));
    }
  });

  test("invoke, jobs, feedback and the organisation summary have exactly their fields", () => {
    expect(sorted(vector("invoke-request.json"))).toEqual(sorted(keys.invokeRequest));
    expect(sorted(vector("invoke-response.json"))).toEqual(sorted(keys.invokeResult));
    expect(sorted(vector("job-done.json"))).toEqual(sorted(keys.job));
    expect(sorted(vector("jobs-accepted.json"))).toEqual(sorted(keys.jobAccepted));
    expect(sorted(vector("feedback.json"))).toEqual(sorted(keys.feedback));
    const summary = vector<AiOrgSummary>("org-summary.json");
    expect(sorted(summary)).toEqual(sorted(keys.orgSummary));
    for (const line of summary.ledger) expect(sorted(line)).toEqual(sorted(keys.ledger));
  });

  test("settings and errors carry only fields the types know (the rest are omitted when empty)", () => {
    for (const k of Object.keys(vector("org-settings.json"))) expect(Object.keys(keys.orgSettings)).toContain(k);
    const errorFiles = readdirSync(join(contractDir, "errors")).filter((f) => f.endsWith(".json"));
    expect(errorFiles.length).toBeGreaterThanOrEqual(5);
    for (const f of errorFiles) {
      const e = vector<AiError>(`errors/${f}`);
      for (const k of Object.keys(e)) expect(Object.keys(keys.error)).toContain(k);
      expect(isAiError(e)).toBe(true);
      expect(AI_ERROR_CODES).toContain(e.code);
    }
  });

  test("required is a permission on missing_permission and whole credits on insufficient_credits", () => {
    const perm = vector<AiError>("errors/missing-permission.json");
    const credits = vector<AiError>("errors/insufficient-credits.json");
    expect(requiredPermission(perm)).toBe(perm.required);
    expect(requiredCredits(perm)).toBe(0);
    expect(requiredCredits(credits)).toBe(credits.required);
    expect(requiredPermission(credits)).toBe("");
    expect(isAiError({ code: 1 })).toBe(false);
    expect(isAiError(null)).toBe(false);
  });

  test("a job is finished when done, failed or cancelled", () => {
    expect(isJobFinished(vector<AiJob>("job-done.json"))).toBe(true);
    expect(isJobFinished({ status: "failed" })).toBe(true);
    expect(isJobFinished({ status: "cancelled" })).toBe(true);
    expect(isJobFinished({ status: "queued" })).toBe(false);
    expect(isJobFinished({ status: "running" })).toBe(false);
  });
});

describe("isShown", () => {
  test("controls show for no_permission, no_credits and ready only", () => {
    const shown: Record<AiState, boolean> = {
      not_configured: false,
      off: false,
      blocked: false,
      no_permission: true,
      no_credits: true,
      ready: true,
    };
    for (const state of AI_STATES) expect(isShown(withState(state))).toBe(shown[state]);
    expect(isShown(null)).toBe(false);
    expect(isShown(undefined)).toBe(false);
    expect(isShown(notConfigured)).toBe(false);
    expect(isShown(off)).toBe(false);
  });
});

describe("toolState", () => {
  test("hidden for not_configured, off and blocked, for no status, and for a tool the status does not list", () => {
    for (const state of ["not_configured", "off", "blocked"] as const) {
      expect(toolState(withState(state), "pages.section.generate")).toEqual({ state: "hidden" });
    }
    expect(toolState(notConfigured, "pages.section.generate")).toEqual({ state: "hidden" });
    expect(toolState(off, "platform.docs.answer")).toEqual({ state: "hidden" });
    expect(toolState(null, "pages.section.generate")).toEqual({ state: "hidden" });
    expect(toolState(ready, "no.such.tool")).toEqual({ state: "hidden" });
  });

  test("ready for an allowed tool in the ready vector", () => {
    const s = toolState(ready, "pages.section.generate");
    expect(s.state).toBe("ready");
    if (s.state === "ready") expect(s.tool).toBe(findTool(ready, "pages.section.generate"));
  });

  test("the no_permission vector: the paid tool is greyed for missing_permission, the free one is ready", () => {
    expect(toolState(noPermission, "pages.section.generate")).toMatchObject({ state: "greyed", reason: "missing_permission" });
    expect(toolState(noPermission, "platform.docs.answer")).toMatchObject({ state: "ready" });
  });

  test("no_credits: the tool's reason, or the status's state when the tool gives none", () => {
    const tool: AiToolStatus = { key: "x.tool", credits: 3, pricing_mode: "fixed", allowed: false, reason: "no_credits" };
    expect(toolState(withState("no_credits", [tool]), "x.tool")).toMatchObject({ state: "greyed", reason: "no_credits" });
    expect(toolState(withState("no_credits", [{ ...tool, reason: "" }]), "x.tool")).toMatchObject({ state: "greyed", reason: "no_credits" });
    expect(toolState(withState("no_permission", [{ ...tool, reason: "" }]), "x.tool")).toMatchObject({ state: "greyed", reason: "missing_permission" });
    // A tool not allowed in a ready status is greyed with its own reason.
    expect(toolState(withState("ready", [{ ...tool, reason: "missing_permission" }]), "x.tool")).toMatchObject({
      state: "greyed",
      reason: "missing_permission",
    });
  });
});

describe("prices come from the status", () => {
  const label = (key: string) => priceLabel(findTool(ready, key) as AiToolStatus);

  test("fixed, metered and free, from the ready vector", () => {
    expect(label("pages.section.generate")).toBe("14 credits");
    expect(label("pages.page.generate")).toBe("Up to 40 credits");
    expect(label("platform.docs.answer")).toBe("Free");
  });

  test("formatCredits writes one, many, tenths and free", () => {
    expect(formatCredits(1)).toBe("1 credit");
    expect(formatCredits(14)).toBe("14 credits");
    expect(formatCredits(2.5)).toBe("2.5 credits");
    expect(formatCredits(0.25)).toBe("0.3 credits");
    expect(formatCredits(0)).toBe("Free");
    expect(formatCredits(Number.NaN)).toBe("Free");
  });

  test("the host's words replace the defaults", () => {
    const copy = { free: "Gratis", credits: (a: string) => `${a} cr`, upTo: (p: string) => `max ${p}` };
    expect(formatCredits(0, copy)).toBe("Gratis");
    expect(priceLabel(findTool(ready, "pages.page.generate") as AiToolStatus, copy)).toBe("max 40 cr");
    expect(priceLabel(findTool(ready, "pages.section.generate") as AiToolStatus, copy)).toBe("14 cr");
    expect(priceLabel({ key: "k", credits: 5, pricing_mode: "free", allowed: true, reason: "" }, copy)).toBe("Gratis");
  });

  test("a price changes when the status changes", () => {
    const tools = ready.tools.map((t) => (t.key === "pages.section.generate" ? { ...t, credits: 7.5 } : t));
    expect(priceLabel(findTool(withState("ready", tools), "pages.section.generate") as AiToolStatus)).toBe("7.5 credits");
  });
});
