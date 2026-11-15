import { useId, useMemo, useRef, useState } from "react";
import { Modal } from "./Modal.js";
import { moveVerdict, type MoveRules } from "./moves.js";
import type { MoveOutcome, MoveRequest } from "./types.js";
import { DEFAULT_WORDS, type BoardWords } from "./words.js";

export type BulkSelection = { all: true; total: number } | { all: false; ids: string[] };

export type BulkMoveDialogProps = {
  /** The one column the records are in: a bulk move acts on one step at a time. */
  column: { code: string; name: string };
  columns: { code: string; name: string }[];
  selection: BulkSelection;
  rules: MoveRules;
  admin: boolean;
  /** Every record in the column under the board's filters (the server's total, not the loaded cards). */
  listIds: (column: string) => Promise<string[]>;
  move: (req: MoveRequest) => Promise<MoveOutcome[]>;
  /** Records per request, so progress can be shown. */
  chunk?: number;
  onClose: (changed: boolean) => void;
  words?: BoardWords;
};

type Phase = "choose" | "confirm" | "running" | "result";

/**
 * Bulk moves, in one dialog and on one column: choose the step (and a reason
 * when it is back), confirm, watch the progress, read the result — how many
 * moved, and each that did not, with why. Each record goes through the
 * server's single move path, so each is checked and recorded on its own.
 */
export function BulkMoveDialog({ column, columns, selection, rules, admin, listIds, move, chunk = 10, onClose, onDone, words = DEFAULT_WORDS }: BulkMoveDialogProps & { onDone?: (outcomes: MoveOutcome[]) => void }) {
  const codes = useMemo(() => columns.map((c) => c.code), [columns]);
  const at = codes.indexOf(column.code);
  const [phase, setPhase] = useState<Phase>("choose");
  const [to, setTo] = useState(codes[at + 1] ?? codes.find((c) => c !== column.code) ?? "");
  const [reason, setReason] = useState("");
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [done, setDone] = useState(0);
  const [count, setCount] = useState(selection.all ? selection.total : selection.ids.length);
  const [outcomes, setOutcomes] = useState<MoveOutcome[]>([]);
  const [error, setError] = useState("");
  const stop = useRef(false);
  const reasonId = useId();
  const verdict = moveVerdict(codes, rules, { from: column.code, to, admin, reason, confirm_skip: confirmSkip, recent_moves: 0 });
  const nameOf = (code: string) => columns.find((c) => c.code === code)?.name ?? code;
  const backLocked = rules.back_admin_only && !admin;

  const run = async () => {
    setPhase("running");
    setError("");
    stop.current = false;
    let ids: string[];
    try {
      ids = selection.all ? await listIds(column.code) : selection.ids;
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : words.loadFailed);
      setPhase("confirm");
      return;
    }
    setCount(ids.length);
    const all: MoveOutcome[] = [];
    for (let i = 0; i < ids.length && !stop.current; i += chunk) {
      const part = ids.slice(i, i + chunk);
      try {
        all.push(...(await move({ ids: part, from: column.code, to, reason: reason.trim(), confirmSkip })));
      } catch (e) {
        const message = e instanceof Error && e.message ? e.message : words.loadFailed;
        all.push(...part.map((id) => ({ id, ok: false, message })));
      }
      setDone(Math.min(ids.length, i + part.length));
      setOutcomes([...all]);
    }
    setPhase("result");
    onDone?.(all);
  };

  const moved = outcomes.filter((o) => o.ok).length;
  const refused = outcomes.filter((o) => !o.ok);
  const target = nameOf(to);

  return (
    <Modal
      title={words.bulkTitle(column.name)}
      onClose={() => onClose(moved > 0)}
      busy={phase === "running"}
      testId="bulk-dialog"
      foot={
        phase === "choose" ? (
          <>
            <button type="button" className="zcu-btn" data-variant="quiet" onClick={() => onClose(false)}>
              {words.cancel}
            </button>
            <button type="button" className="zcu-btn" data-variant="primary" disabled={!verdict.ok} onClick={() => setPhase("confirm")} data-testid="bulk-next">
              {words.moveSelected(count)}
            </button>
          </>
        ) : phase === "confirm" ? (
          <>
            <button type="button" className="zcu-btn" data-variant="quiet" onClick={() => setPhase("choose")}>
              {words.cancel}
            </button>
            <button type="button" className="zcu-btn" data-variant="primary" onClick={() => void run()} data-testid="bulk-confirm">
              {words.bulkConfirm(count, target)}
            </button>
          </>
        ) : phase === "running" ? (
          <button type="button" className="zcu-btn" data-variant="quiet" onClick={() => (stop.current = true)}>
            {words.cancel}
          </button>
        ) : (
          <button type="button" className="zcu-btn" data-variant="primary" onClick={() => onClose(moved > 0)} data-testid="bulk-close">
            {words.close}
          </button>
        )
      }
    >
      {phase === "choose" && (
        <>
          <fieldset className="zcu-field">
            <legend className="zcu-label">{words.moveTo}</legend>
            <div className="zcu-options" role="radiogroup">
              {columns.map((c, i) => {
                const current = c.code === column.code;
                const earlier = i < at;
                const disabled = current || (earlier && backLocked);
                return (
                  <label key={c.code} className="zcu-option" data-disabled={disabled || undefined} title={earlier && backLocked ? words.adminOnlyBack : undefined}>
                    <input type="radio" name="zcu-bulk-to" value={c.code} checked={to === c.code} disabled={disabled} onChange={() => setTo(c.code)} />
                    <span className="zcu-option-name">{c.name}</span>
                    <span className="zcu-option-tag">
                      {current ? words.currentStage : i === at + 1 ? words.nextStage : earlier ? words.earlierStage : words.laterStage}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {verdict.direction === "back" && (
            <div className="zcu-field">
              <label className="zcu-label" htmlFor={reasonId}>
                {words.reason}
              </label>
              <textarea id={reasonId} className="zcu-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="bulk-reason" />
              <p className="zcu-hint">{words.reasonHint}</p>
            </div>
          )}
          {verdict.skipped.length > 0 && rules.skip_needs_confirm && (
            <label className="zcu-check">
              <input type="checkbox" checked={confirmSkip} onChange={(e) => setConfirmSkip(e.target.checked)} data-testid="bulk-confirm-skip" />
              {words.confirmSkip(verdict.skipped.map(nameOf))}
            </label>
          )}
        </>
      )}
      {phase === "confirm" && (
        <>
          <p className="zcu-modal-lede" data-testid="bulk-summary">
            {words.bulkConfirm(count, target)}
          </p>
          {error && (
            <p className="zcu-notice" data-tone="danger" role="alert">
              {error}
            </p>
          )}
        </>
      )}
      {(phase === "running" || phase === "result") && (
        <div className="zcu-progress-wrap">
          <p className="zcu-modal-lede" data-testid="bulk-progress" aria-live="polite">
            {phase === "running" ? words.bulkProgress(done, count) : words.bulkResult(moved, refused.length)}
          </p>
          <div className="zcu-progress" role="progressbar" aria-valuemin={0} aria-valuemax={count} aria-valuenow={done}>
            <span style={{ width: `${count ? Math.round((done / count) * 100) : 100}%` }} />
          </div>
          {phase === "result" && refused.length > 0 && (
            <ul className="zcu-refused" data-testid="bulk-refused">
              {refused.map((o) => (
                <li key={o.id}>
                  <strong>{o.title || o.id.slice(0, 8)}</strong> {o.message || words.refusals[o.code ?? ""] || o.code}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
