"use client";

import { useEffect, useId, useRef, useState } from "react";
import { NODE_KINDS } from "../catalogue.js";
import { categoryOf } from "../design.js";
import { useEditor } from "./context.js";
import { Icon } from "./icons.js";

/** The kinds a step can be added as: everything but the start and an end. */
const ADDABLE = NODE_KINDS.filter((k) => k.type !== "start" && k.type !== "end");

/**
 * One menu of the kinds of step, each with its icon and a line on what it
 * does: the "+" between two steps on the path, and the "Add a step" at its
 * end. A kind the host cannot offer is shown greyed with the reason.
 */
export function AddStepMenu({ label, wide = false, onAdd }: { label: string; wide?: boolean; onAdd: (type: string) => void }) {
  const ed = useEditor();
  const id = useId();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  if (ed.readOnly) return null;
  return (
    <div
      ref={box}
      className={wide ? "zwf-add-step zwf-add-step-wide" : "zwf-add-step"}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // The row's own keys (arrows, Enter) are not for the menu.
        e.stopPropagation();
        if (e.key === "Escape" && open) {
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <button
        ref={toggle}
        type="button"
        className={wide ? "zwf-button zwf-add-step-end" : "zwf-add-step-plus"}
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={wide ? undefined : label}
        title={wide ? undefined : label}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="plus" size={wide ? 14 : 12} />
        {wide && label}
      </button>
      {open && (
        <div id={`${id}-menu`} role="group" aria-label="Add a step" className="zwf-add-step-menu">
          {ADDABLE.map((k) => {
            const why = ed.unavailable[k.type];
            return (
              <button
                key={k.type}
                type="button"
                className="zwf-add-step-kind"
                data-category={categoryOf(k.type)}
                aria-disabled={why ? true : undefined}
                aria-describedby={`${id}-d-${k.type}`}
                onClick={() => {
                  if (why) return;
                  setOpen(false);
                  onAdd(k.type);
                }}
              >
                <span className="zwf-add-step-icon" aria-hidden="true">
                  <Icon name={k.type} size={15} />
                </span>
                <span className="zwf-palette-words">
                  <span className="zwf-palette-label">{k.label}</span>
                  <span id={`${id}-d-${k.type}`} className="zwf-palette-blurb">
                    {why || k.blurb}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
