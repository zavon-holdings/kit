// A side sheet for AI assistance: a question box for answers from the docs,
// the answer with its sources, feedback, and optionally a proposal that is
// applied only after a confirm step. A modal dialog: focus moves in when it
// opens, Tab stays inside, Escape and the close button close it, and focus
// goes back where it was. At 640px and below it fills the screen.
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FeedbackThumbs, type FeedbackChoice, type FeedbackThumbsCopy } from "./FeedbackThumbs.js";
import type { AiDocsAnswer } from "./types.js";

export const NARROW_QUERY = "(max-width: 640px)";

export interface AssistantSheetCopy {
  title: string;
  close: string;
  questionLabel: string;
  ask: string;
  asking: string;
  answerTitle: string;
  sources: string;
  newTab: string;
  /** Said when the answer does not load. */
  askFailed: string;
  proposalTitle: string;
  /** Said under a proposal. */
  draftNote: string;
  apply: string;
  discard: string;
  /** The confirm step's text. */
  confirmText: string;
  confirm: string;
  cancel: string;
  applying: string;
  applied: string;
  applyFailed: string;
  feedback?: Partial<FeedbackThumbsCopy>;
}

export const DEFAULT_SHEET_COPY: AssistantSheetCopy = {
  title: "Assistant",
  close: "Close",
  questionLabel: "Question",
  ask: "Ask",
  asking: "Finding an answer.",
  answerTitle: "Answer",
  sources: "Sources",
  newTab: "(opens in a new tab)",
  askFailed: "No answer is available now. Try again later.",
  proposalTitle: "Proposal",
  draftNote: "The result is a draft. You check it before you save.",
  apply: "Apply",
  discard: "Discard",
  confirmText: "Apply the proposal to the editor. You can change it or undo it before you save.",
  confirm: "Confirm",
  cancel: "Cancel",
  applying: "Applying.",
  applied: "The proposal is applied. Check it, then save.",
  applyFailed: "The proposal did not apply. Try again.",
};

export interface AssistantSheetProps {
  open: boolean;
  onClose: () => void;
  /** Answers a question from the docs through the host. Without it there is no question box. */
  ask?: (question: string) => Promise<AiDocsAnswer>;
  /** Sends feedback on an answer. Without it there are no thumbs. */
  onFeedback?: (choice: FeedbackChoice, answer: AiDocsAnswer) => void | Promise<void>;
  /** What the assistant proposes, drawn by the host (a ProposalDiff, for example). */
  proposal?: ReactNode;
  /** Applies the proposal. Called only after the person confirms. */
  onApply?: () => void | Promise<void>;
  /** Drops the proposal. */
  onDiscard?: () => void;
  /** Sends feedback on the proposal. */
  onProposalFeedback?: (choice: FeedbackChoice) => void | Promise<void>;
  copy?: Partial<AssistantSheetCopy>;
  /** More content, after the proposal. */
  children?: ReactNode;
  className?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useNarrow(): boolean {
  const query = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(NARROW_QUERY) : null);
  const [narrow, setNarrow] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const mq = query();
    if (!mq) return;
    setNarrow(mq.matches);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return narrow;
}

export function AssistantSheet(props: AssistantSheetProps) {
  if (!props.open || typeof document === "undefined") return null;
  return createPortal(<Sheet {...props} />, document.body);
}

function Sheet({ onClose, ask, onFeedback, proposal, onApply, onDiscard, onProposalFeedback, copy, children, className }: AssistantSheetProps) {
  const c = { ...DEFAULT_SHEET_COPY, ...copy };
  const id = useId();
  const titleId = `zai-sheet-${id}-title`;
  const narrow = useNarrow();
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const applyButton = useRef<HTMLButtonElement>(null);

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AiDocsAnswer | null>(null);
  const [askError, setAskError] = useState(false);
  const askSeq = useRef(0);

  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState("");

  // Opening: remember where focus was and move it in; closing: put it back.
  useEffect(() => {
    const back = document.activeElement;
    (input.current ?? panel.current)?.focus();
    return () => {
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, []);

  useEffect(() => {
    if (confirming) confirmButton.current?.focus();
  }, [confirming]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!ask || !q || asking) return;
    const mine = ++askSeq.current;
    setAsking(true);
    setAskError(false);
    setAnswer(null);
    try {
      const got = await ask(q);
      if (mine !== askSeq.current) return;
      setAnswer({ answer: got?.answer ?? "", citations: Array.isArray(got?.citations) ? got.citations : [], usage_event_id: got?.usage_event_id });
    } catch {
      if (mine === askSeq.current) setAskError(true);
    } finally {
      if (mine === askSeq.current) setAsking(false);
    }
  };

  const confirmApply = async () => {
    if (!onApply || applying) return;
    setApplying(true);
    setApplyMessage(c.applying);
    try {
      await onApply();
      setApplyMessage(c.applied);
      setConfirming(false);
    } catch {
      setApplyMessage(c.applyFailed);
    } finally {
      setApplying(false);
    }
  };

  const cancelConfirm = () => {
    setConfirming(false);
    // Wait for the Apply button to come back before focusing it.
    setTimeout(() => applyButton.current?.focus(), 0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (confirming) cancelConfirm();
      else onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest("[hidden]"));
    if (items.length === 0) {
      e.preventDefault();
      panel.current.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const paragraphs = answer ? answer.answer.split(/\n{2,}/).filter((p) => p.trim()) : [];

  return (
    <div className={["zai-sheet", narrow ? "zai-sheet--full" : "zai-sheet--side", className ?? ""].filter(Boolean).join(" ")}>
      <div className="zai-sheet__scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        className="zai-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="zai-sheet__head">
          <h2 id={titleId} className="zai-sheet__title">
            {c.title}
          </h2>
          <button type="button" className="zai-sheet__close" aria-label={c.close} onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="zai-sheet__body">
          {ask ? (
            <section className="zai-sheet__section" aria-labelledby={`${titleId}-q`}>
              <form className="zai-sheet__ask" onSubmit={submit}>
                <label id={`${titleId}-q`} htmlFor={`${titleId}-input`} className="zai-sheet__label">
                  {c.questionLabel}
                </label>
                <textarea
                  ref={input}
                  id={`${titleId}-input`}
                  className="zai-sheet__input"
                  rows={2}
                  maxLength={2000}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit?.();
                    }
                  }}
                />
                <button type="submit" className="zai-button zai-button--primary" disabled={asking || !question.trim()}>
                  {c.ask}
                </button>
              </form>
              <p className="zai-sheet__status" role="status">
                {asking ? c.asking : askError ? c.askFailed : ""}
              </p>
              {answer ? (
                <div className="zai-sheet__answer">
                  <h3 className="zai-sheet__subtitle">{c.answerTitle}</h3>
                  {paragraphs.map((p, i) => (
                    <p key={i} className="zai-sheet__text">
                      {p}
                    </p>
                  ))}
                  {answer.citations.length > 0 ? (
                    <>
                      <h4 className="zai-sheet__sources-title">{c.sources}</h4>
                      <ul className="zai-sheet__sources">
                        {answer.citations.map((cite, i) => (
                          <li key={`${cite.url}-${i}`}>
                            <a href={cite.url} target="_blank" rel="noopener noreferrer" className="zai-sheet__source">
                              {cite.title || cite.url}
                              <span className="zai-sr"> {c.newTab}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {onFeedback ? <FeedbackThumbs copy={c.feedback} onSend={(choice) => onFeedback(choice, answer)} /> : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {proposal ? (
            <section className="zai-sheet__section zai-sheet__proposal" aria-labelledby={`${titleId}-p`}>
              <h3 id={`${titleId}-p`} className="zai-sheet__subtitle">
                {c.proposalTitle}
              </h3>
              <div className="zai-sheet__proposal-body">{proposal}</div>
              <p className="zai-sheet__note">{c.draftNote}</p>
              {onApply ? (
                confirming ? (
                  <div className="zai-sheet__confirm" role="group" aria-labelledby={`${titleId}-confirm`}>
                    <p id={`${titleId}-confirm`} className="zai-sheet__confirm-text">
                      {c.confirmText}
                    </p>
                    <div className="zai-sheet__actions">
                      <button ref={confirmButton} type="button" className="zai-button zai-button--primary" disabled={applying} onClick={() => void confirmApply()}>
                        {c.confirm}
                      </button>
                      <button type="button" className="zai-button" disabled={applying} onClick={cancelConfirm}>
                        {c.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="zai-sheet__actions">
                    <button
                      ref={applyButton}
                      type="button"
                      className="zai-button zai-button--primary"
                      onClick={() => {
                        setApplyMessage("");
                        setConfirming(true);
                      }}
                    >
                      {c.apply}
                    </button>
                    {onDiscard ? (
                      <button type="button" className="zai-button" onClick={onDiscard}>
                        {c.discard}
                      </button>
                    ) : null}
                  </div>
                )
              ) : null}
              <p className="zai-sheet__status" role="status">
                {applyMessage}
              </p>
              {onProposalFeedback ? <FeedbackThumbs copy={c.feedback} onSend={onProposalFeedback} /> : null}
            </section>
          ) : null}

          {children}
        </div>
      </div>
    </div>
  );
}
