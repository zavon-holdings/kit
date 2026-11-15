import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * A dialog over the page: a title, a body that scrolls inside itself when it
 * is long, and a foot of actions that stays in view. Escape and the backdrop
 * close it unless `busy` (a move in progress is not abandoned by a stray
 * click). Focus goes to the first field, else the dialog.
 */
export function Modal({
  title,
  onClose,
  busy = false,
  children,
  foot,
  testId,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
  foot?: ReactNode;
  testId?: string;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = box.current;
    const first = el?.querySelector<HTMLElement>("input:not([disabled]), textarea, select, button:not([disabled])");
    (first ?? el)?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy]);
  return (
    <div className="zcu-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div ref={box} className="zcu-modal" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} data-testid={testId}>
        <h2 id={id} className="zcu-modal-title">
          {title}
        </h2>
        <div className="zcu-modal-body">{children}</div>
        {foot && <div className="zcu-modal-foot">{foot}</div>}
      </div>
    </div>
  );
}
