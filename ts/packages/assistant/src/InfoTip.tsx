// A small info icon that shows a short text when pressed, and an optional
// link to the docs in a new tab. A toggletip: the button says whether the
// text is shown, the text goes into a live region when it opens (so it is
// announced), and Escape or a press elsewhere closes it. A hidden copy of the
// text stays in the page under `id`, so another control can point at it
// with aria-describedby.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface InfoTipCopy {
  /** The icon button's accessible name. */
  label: string;
  /** The words of a docs link. */
  docsLink: string;
  /** Said after a link that opens a new tab. */
  newTab: string;
}

export const DEFAULT_INFO_TIP_COPY: InfoTipCopy = {
  label: "More information",
  docsLink: "Read more",
  newTab: "(opens in a new tab)",
};

export interface InfoTipProps {
  /** The text. */
  children: ReactNode;
  /** The id of the text, for aria-describedby elsewhere. One is made when absent. */
  id?: string;
  /** A docs page, opened in a new tab. */
  docsUrl?: string;
  copy?: Partial<InfoTipCopy>;
  className?: string;
}

export function InfoTip({ children, id, docsUrl, copy, className }: InfoTipProps) {
  const c = { ...DEFAULT_INFO_TIP_COPY, ...copy };
  const made = useId();
  const textId = id ?? `zai-tip-${made}`;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  return (
    <span
      ref={root}
      className={["zai-tip", open ? "zai-tip--open" : "", className ?? ""].filter(Boolean).join(" ")}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="zai-tip__button"
        aria-label={c.label}
        aria-expanded={open}
        aria-controls={`${textId}-box`}
        onClick={() => setOpen((o) => !o)}
      >
        <svg className="zai-tip__icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="4.75" r="1" fill="currentColor" />
          <path d="M8 7v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <span id={textId} className="zai-tip__text" hidden>
        {children}
      </span>
      <span id={`${textId}-box`} className="zai-tip__box" role="status">
        {open ? (
          <>
            {children}
            {docsUrl ? (
              <>
                {" "}
                <a className="zai-tip__link" href={docsUrl} target="_blank" rel="noopener noreferrer">
                  {c.docsLink}
                  <span className="zai-sr"> {c.newTab}</span>
                </a>
              </>
            ) : null}
          </>
        ) : null}
      </span>
    </span>
  );
}
