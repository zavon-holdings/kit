// @zavon/assistant: AI assistance controls for React.
//
// The wire types mirror kit's go/aiclient and contract/ai. A screen reads a
// status through the host (`useAiStatus`), and every control follows it:
// hidden when AI is not configured, off or blocked; greyed with the reason
// when a person has no permission or there are no credits; ready with the
// tool's price from the status. The package holds no address and names no
// product: the host passes its own `load`, `ask` and `onApply`, and every
// visible string through `copy`.
export * from "./types.js";
export * from "./status.js";
export { useAiStatus, type UseAiStatusOptions, type UseAiStatusResult } from "./useAiStatus.js";
export { InfoTip, DEFAULT_INFO_TIP_COPY, type InfoTipProps, type InfoTipCopy } from "./InfoTip.js";
export {
  AiAction,
  DEFAULT_AI_INFO_TIP,
  DEFAULT_AI_REASONS,
  DEFAULT_AI_BUSY,
  type AiActionProps,
  type AiActionCopy,
} from "./AiAction.js";
export {
  AssistantSheet,
  DEFAULT_SHEET_COPY,
  NARROW_QUERY,
  type AssistantSheetProps,
  type AssistantSheetCopy,
} from "./AssistantSheet.js";
export {
  ProposalDiff,
  DEFAULT_PROPOSAL_DIFF_COPY,
  defaultItemText,
  type ProposalDiffProps,
  type ProposalDiffCopy,
} from "./ProposalDiff.js";
export * from "./diff.js";
export {
  FeedbackThumbs,
  DEFAULT_FEEDBACK_COPY,
  FEEDBACK_COMMENT_MAX,
  type FeedbackThumbsProps,
  type FeedbackThumbsCopy,
  type FeedbackChoice,
  type FeedbackRating,
} from "./FeedbackThumbs.js";
