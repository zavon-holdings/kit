"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./icons.js";

export type ConfirmDialogProps = {
  /** The question, as a short heading: "Remove 4 steps?". */
  title: string;
  /** What will happen, in a sentence or two. */
  description?: ReactNode;
  /** The impact, one line each: "Removes Approval, Email and 2 more". */
  impact?: ReactNode[];
  /** The primary button's words: "Remove", "Publish", "Discard changes". */
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" for something that removes or discards; "primary" for go-live. */
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * A confirmation card for a consequential action: what it changes, then a
 * primary and a secondary button. A modal alertdialog: focus starts on the
 * safe choice (Cancel) for anything destructive, Tab stays inside, Escape
 * and the backdrop cancel, and focus returns where it was.
 *
 * Exported for hosts too: publish, go live and discard live in the host's
 * own toolbar, and use the same card.
 */
export function ConfirmDialog({ title, description, impact, confirmLabel, cancelLabel = "Cancel", tone = "danger", onConfirm, onCancel }: ConfirmDialogProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    (tone === "danger" ? cancelRef : confirmRef).current?.focus();
    return () => {
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [tone]);

  return (
    <div
      className="zwf-modal-backdrop zwf-confirm-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={box}
        className="zwf-confirm"
        data-tone={tone}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={description || impact?.length ? `${id}-d` : undefined}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
            return;
          }
          if (e.key !== "Tab" || !box.current) return;
          const items = [...box.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")];
          if (items.length === 0) return;
          const first = items[0];
          const last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <span className="zwf-confirm-icon" aria-hidden="true">
          <Icon name={tone === "danger" ? "alert" : "check"} size={20} />
        </span>
        <div className="zwf-confirm-body">
          <p id={`${id}-t`} className="zwf-confirm-title">
            {title}
          </p>
          {(description || (impact && impact.length > 0)) && (
            <div id={`${id}-d`} className="zwf-confirm-text">
              {description && <p>{description}</p>}
              {impact && impact.length > 0 && (
                <ul className="zwf-confirm-impact">
                  {impact.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="zwf-confirm-actions">
            <button ref={cancelRef} type="button" className="zwf-button" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button ref={confirmRef} type="button" className={`zwf-button ${tone === "danger" ? "zwf-danger-solid" : "zwf-primary"}`} onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
