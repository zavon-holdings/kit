// A button for one AI tool. It follows the status:
//   not configured, off or blocked, or no such tool: nothing at all;
//   no permission or no credits (or the tool not allowed): a disabled button
//     with an info tip that gives the reason;
//   ready: an enabled button with the tool's price from the status.
// The host passes every word; the price comes only from the status.
import { useId } from "react";
import { InfoTip, type InfoTipCopy } from "./InfoTip.js";
import { DEFAULT_CREDIT_COPY, priceLabel, toolState, type AiGreyReason, type CreditCopy } from "./status.js";
import type { AiStatus } from "./types.js";

export interface AiActionCopy {
  /** The button's words, for example "Write a draft". */
  label: string;
  /** The info tip when the button is ready. */
  infoTip?: string;
  /** The info tip when the button is greyed, per reason. */
  reasons?: Partial<Record<AiGreyReason, string>>;
  /** The button's words while it runs. */
  busy?: string;
  /** The words of the price. */
  credits?: Partial<CreditCopy>;
  /** The info tip's button and link. */
  tip?: Partial<InfoTipCopy>;
}

export const DEFAULT_AI_INFO_TIP = "AI writes a suggestion for you. The result is a draft. You check it before you save.";

export const DEFAULT_AI_REASONS: Record<AiGreyReason, string> = {
  missing_permission: "You do not have permission to use AI assistance. An administrator can give you this permission.",
  no_credits: "There are not enough AI credits for this. An administrator can add credits.",
};

export const DEFAULT_AI_BUSY = "Working";

export interface AiActionProps {
  /** The status from useAiStatus. Null or undefined renders nothing. */
  status: AiStatus | null | undefined;
  /** The tool this button runs. */
  toolKey: string;
  onRun: () => void;
  copy: AiActionCopy;
  /** The tool is running: the button is disabled and says so. */
  busy?: boolean;
  /** A docs page for the info tip, opened in a new tab. */
  docsUrl?: string;
  className?: string;
  "data-tour"?: string;
}

export function AiAction({ status, toolKey, onRun, copy, busy = false, docsUrl, className, "data-tour": dataTour }: AiActionProps) {
  const id = useId();
  const tipId = `zai-action-${id}-tip`;
  const s = toolState(status, toolKey);
  if (s.state === "hidden") return null;

  const greyed = s.state === "greyed";
  const tipText = greyed
    ? (copy.reasons?.[s.reason] ?? DEFAULT_AI_REASONS[s.reason])
    : (copy.infoTip ?? DEFAULT_AI_INFO_TIP);
  const price = priceLabel(s.tool, { ...DEFAULT_CREDIT_COPY, ...copy.credits });

  return (
    <span
      className={["zai-action", greyed ? "zai-action--greyed" : "zai-action--ready", className ?? ""].filter(Boolean).join(" ")}
      data-tour={dataTour}
    >
      <button
        type="button"
        className="zai-action__button"
        disabled={greyed || busy}
        aria-busy={busy || undefined}
        aria-describedby={tipId}
        onClick={greyed || busy ? undefined : onRun}
      >
        <span className="zai-action__label">{busy ? (copy.busy ?? DEFAULT_AI_BUSY) : copy.label}</span>
        {greyed ? null : (
          <>
            {" "}
            <span className="zai-action__price">{price}</span>
          </>
        )}
      </button>
      <InfoTip id={tipId} docsUrl={docsUrl} copy={copy.tip}>
        {tipText}
      </InfoTip>
    </span>
  );
}
