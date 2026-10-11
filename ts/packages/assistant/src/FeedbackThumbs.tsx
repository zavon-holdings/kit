// Thumbs up and down for one AI result, with an optional short comment.
// A choice is sent once: pressing the same thumb again sends nothing, and a
// different thumb sends the new choice (the gateway keeps the last one). The
// comment is sent with the choice it belongs to, once.
import { useId, useState } from "react";

export const FEEDBACK_COMMENT_MAX = 500;

export type FeedbackRating = 1 | -1;

export interface FeedbackChoice {
  rating: FeedbackRating;
  comment?: string;
}

export interface FeedbackThumbsCopy {
  /** The group's name. */
  label: string;
  up: string;
  down: string;
  commentLabel: string;
  send: string;
  /** Said when the choice is sent. */
  thanks: string;
  /** Said when the comment is sent. */
  commentSent: string;
  /** Said when sending fails. */
  failed: string;
}

export const DEFAULT_FEEDBACK_COPY: FeedbackThumbsCopy = {
  label: "Rate this result",
  up: "Good result",
  down: "Bad result",
  commentLabel: "Comment (optional)",
  send: "Send comment",
  thanks: "Thank you. Your rating is sent.",
  commentSent: "Thank you. Your comment is sent.",
  failed: "Your feedback did not send. Try again.",
};

export interface FeedbackThumbsProps {
  /** Sends the choice through the host. */
  onSend: (choice: FeedbackChoice) => void | Promise<void>;
  copy?: Partial<FeedbackThumbsCopy>;
  className?: string;
}

export function FeedbackThumbs({ onSend, copy, className }: FeedbackThumbsProps) {
  const c = { ...DEFAULT_FEEDBACK_COPY, ...copy };
  const id = useId();
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [comment, setComment] = useState("");
  const [commentSentFor, setCommentSentFor] = useState<FeedbackRating | null>(null);
  const [message, setMessage] = useState("");

  const send = async (choice: FeedbackChoice, ok: string) => {
    try {
      await onSend(choice);
      setMessage(ok);
      return true;
    } catch {
      setMessage(c.failed);
      return false;
    }
  };

  const choose = (r: FeedbackRating) => {
    if (r === rating) return;
    setRating(r);
    setCommentSentFor(null);
    void send({ rating: r }, c.thanks);
  };

  const sendComment = async () => {
    const text = comment.trim().slice(0, FEEDBACK_COMMENT_MAX);
    if (rating === null || !text || commentSentFor === rating) return;
    setCommentSentFor(rating);
    const ok = await send({ rating, comment: text }, c.commentSent);
    if (!ok) setCommentSentFor(null);
  };

  return (
    <div className={["zai-thumbs", className ?? ""].filter(Boolean).join(" ")} role="group" aria-label={c.label}>
      <div className="zai-thumbs__buttons">
        <button type="button" className="zai-thumbs__button" aria-pressed={rating === 1} aria-label={c.up} onClick={() => choose(1)}>
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
            <path d="M6 9v8H3V9h3Zm2 8V9l3.5-6c1.2 0 2 .9 1.8 2.1L12.8 8H17a1.5 1.5 0 0 1 1.5 1.8l-1.3 6A1.5 1.5 0 0 1 15.7 17H8Z" fill="currentColor" />
          </svg>
        </button>
        <button type="button" className="zai-thumbs__button" aria-pressed={rating === -1} aria-label={c.down} onClick={() => choose(-1)}>
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
            <path d="M14 11V3h3v8h-3Zm-2-8v8l-3.5 6c-1.2 0-2-.9-1.8-2.1l.5-2.9H3a1.5 1.5 0 0 1-1.5-1.8l1.3-6A1.5 1.5 0 0 1 4.3 3H12Z" fill="currentColor" />
          </svg>
        </button>
      </div>
      {rating !== null ? (
        <div className="zai-thumbs__comment">
          <label htmlFor={`${id}-comment`} className="zai-thumbs__label">
            {c.commentLabel}
          </label>
          <textarea
            id={`${id}-comment`}
            className="zai-thumbs__input"
            rows={2}
            maxLength={FEEDBACK_COMMENT_MAX}
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, FEEDBACK_COMMENT_MAX))}
          />
          <button
            type="button"
            className="zai-button zai-button--quiet"
            disabled={!comment.trim() || commentSentFor === rating}
            onClick={() => void sendComment()}
          >
            {c.send}
          </button>
        </div>
      ) : null}
      <p className="zai-thumbs__status" role="status">
        {message}
      </p>
    </div>
  );
}
