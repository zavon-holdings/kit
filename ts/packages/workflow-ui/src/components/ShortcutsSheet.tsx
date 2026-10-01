"use client";

import { useEffect, useId, useRef } from "react";
import { keyWords, NAVIGATION_KEYS, SHORTCUTS } from "../shortcuts.js";

/**
 * Every keyboard shortcut, from the same table the key handler reads. A
 * modal: focus goes to its close button, Escape closes it, and focus goes
 * back where it was.
 */
export function ShortcutsSheet({ onClose, mac = false }: { onClose: () => void; mac?: boolean }) {
  const id = useId();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => before?.focus?.();
  }, []);
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  return (
    <div className="zwf-modal-backdrop" onClick={onClose}>
      <div
        className="zwf-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
          // Keep Tab inside the sheet.
          if (e.key === "Tab") {
            e.preventDefault();
            close.current?.focus();
          }
        }}
      >
        <div className="zwf-row zwf-modal-head">
          <h2 id={`${id}-title`} className="zwf-heading">
            Keyboard shortcuts
          </h2>
          <button ref={close} type="button" className="zwf-button" onClick={onClose}>
            Close
          </button>
        </div>
        {groups.map((g) => (
          <section key={g} aria-label={g}>
            <h3 className="zwf-subheading">{g}</h3>
            <table className="zwf-table zwf-keys">
              <tbody>
                {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <tr key={s.action}>
                    <th scope="row">
                      {s.keys.map((k, i) => (
                        <span key={k}>
                          {i > 0 && " or "}
                          <kbd>{keyWords(k, mac)}</kbd>
                        </span>
                      ))}
                    </th>
                    <td>{s.does}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        <section aria-label="On the canvas and the list">
          <h3 className="zwf-subheading">On the canvas and the list</h3>
          <table className="zwf-table zwf-keys">
            <tbody>
              {NAVIGATION_KEYS.map((n) => (
                <tr key={n.does}>
                  <th scope="row">
                    {n.keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && " "}
                        <kbd>{keyWords(k, mac)}</kbd>
                      </span>
                    ))}
                  </th>
                  <td>{n.does}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
