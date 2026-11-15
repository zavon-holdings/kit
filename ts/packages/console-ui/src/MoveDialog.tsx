import { useId, useMemo, useState } from "react";
import { Modal } from "./Modal.js";
import { moveVerdict, type MoveRules } from "./moves.js";
import type { MoveOutcome, MoveRequest } from "./types.js";
import { DEFAULT_WORDS, type BoardWords } from "./words.js";

export type MoveDialogProps = {
  record: { id: string; title: string; stage: string; recentMoves?: number };
  columns: { code: string; name: string }[];
  rules: MoveRules;
  admin: boolean;
  /** The step to start on (a drop on a later lane); else the next step. */
  initialTo?: string;
  move: (req: MoveRequest) => Promise<MoveOutcome[]>;
  onDone: (outcome: MoveOutcome) => void;
  onClose: () => void;
  words?: BoardWords;
};

/**
 * The one way a record moves by hand besides a forward drag: pick the step,
 * give a reason when it goes back (and be an admin, unless the rules say
 * otherwise), confirm the steps a forward move skips. A record that has
 * moved often is warned about, never stopped. The server checks the same
 * rule again; its refusal is shown here, in the dialog.
 */
export function MoveDialog({ record, columns, rules, admin, initialTo, move, onDone, onClose, words = DEFAULT_WORDS }: MoveDialogProps) {
  const codes = useMemo(() => columns.map((c) => c.code), [columns]);
  const at = codes.indexOf(record.stage);
  const fallbackTo = codes[at + 1] ?? codes.find((c) => c !== record.stage) ?? "";
  const [to, setTo] = useState(initialTo && initialTo !== record.stage ? initialTo : fallbackTo);
  const [reason, setReason] = useState("");
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reasonId = useId();
  const verdict = moveVerdict(codes, rules, {
    from: record.stage,
    to,
    admin,
    reason,
    confirm_skip: confirmSkip,
    recent_moves: record.recentMoves ?? 0,
  });
  const nameOf = (code: string) => columns.find((c) => c.code === code)?.name ?? code;
  const back = verdict.direction === "back";
  const backLocked = rules.back_admin_only && !admin;

  const submit = async () => {
    if (!verdict.ok || busy) return;
    setBusy(true);
    setError("");
    try {
      const [outcome] = await move({ ids: [record.id], from: record.stage, to, reason: reason.trim(), confirmSkip });
      if (outcome?.ok) onDone(outcome);
      else setError(outcome?.message || words.refusals[outcome?.code ?? ""] || words.loadFailed);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : words.loadFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={words.moveTitle}
      onClose={onClose}
      busy={busy}
      testId="move-dialog"
      foot={
        <>
          <button type="button" className="zcu-btn" data-variant="quiet" onClick={onClose} disabled={busy}>
            {words.cancel}
          </button>
          <button type="button" className="zcu-btn" data-variant="primary" onClick={() => void submit()} disabled={!verdict.ok || busy} data-testid="move-submit">
            {busy ? `${words.move}…` : words.move}
          </button>
        </>
      }
    >
      <p className="zcu-modal-lede">{record.title}</p>
      <fieldset className="zcu-field">
        <legend className="zcu-label">{words.moveTo}</legend>
        <div className="zcu-options" role="radiogroup">
          {columns.map((c, i) => {
            const current = c.code === record.stage;
            const earlier = at >= 0 && i < at;
            const tag = current ? words.currentStage : i === at + 1 ? words.nextStage : earlier ? words.earlierStage : words.laterStage;
            const disabled = current || (earlier && backLocked);
            return (
              <label key={c.code} className="zcu-option" data-disabled={disabled || undefined} title={earlier && backLocked ? words.adminOnlyBack : undefined}>
                <input type="radio" name="zcu-move-to" value={c.code} checked={to === c.code} disabled={disabled} onChange={() => setTo(c.code)} />
                <span className="zcu-option-name">{c.name}</span>
                <span className="zcu-option-tag">{tag}</span>
              </label>
            );
          })}
        </div>
        {backLocked && at > 0 && <p className="zcu-hint">{words.adminOnlyBack}</p>}
      </fieldset>
      {back && (
        <div className="zcu-field">
          <label className="zcu-label" htmlFor={reasonId}>
            {words.reason}
          </label>
          <textarea
            id={reasonId}
            className="zcu-input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required={rules.back_needs_reason}
            data-testid="move-reason"
          />
          <p className="zcu-hint">{words.reasonHint}</p>
        </div>
      )}
      {verdict.skipped.length > 0 && rules.skip_needs_confirm && (
        <label className="zcu-check" data-testid="move-confirm-skip">
          <input type="checkbox" checked={confirmSkip} onChange={(e) => setConfirmSkip(e.target.checked)} />
          {words.confirmSkip(verdict.skipped.map(nameOf))}
        </label>
      )}
      {verdict.warnings.includes("frequent_moves") && (
        <p className="zcu-notice" data-tone="warn" data-testid="move-frequent">
          {words.frequentWarning(record.recentMoves ?? 0, rules.frequent_window_hours)}
        </p>
      )}
      {error && (
        <p className="zcu-notice" data-tone="danger" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
