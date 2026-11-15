import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BulkMoveDialog, type BulkSelection } from "./BulkMoveDialog.js";
import { LaneMore } from "./LaneMore.js";
import { MoveDialog } from "./MoveDialog.js";
import { dropVerdict, type DropVerdict, type MoveRules } from "./moves.js";
import { RuleChips } from "./RuleChips.js";
import { cardMarks, columnChips } from "./rules.js";
import type { BoardCardData, BoardColumnData, ColumnPage, MoveOutcome, MoveRequest } from "./types.js";
import { useFillHeight } from "./useFillHeight.js";
import { useLaneOverflow } from "./useLaneOverflow.js";
import { wordsWith, type BoardWords } from "./words.js";

export type BoardProps = {
  /** Every lane's first page and true total, from one request. */
  columns: BoardColumnData[];
  /** A lane's next page, from the cursor its last page gave. */
  loadMore: (column: string, cursor: string) => Promise<ColumnPage>;
  rules: MoveRules;
  /** The person may move records back (when the rules keep that to admins). */
  admin: boolean;
  /** Moves records through the server's single move path. */
  move: (req: MoveRequest) => Promise<MoveOutcome[]>;
  /** Every record in one lane under the filters, for "Select All". */
  listIds: (column: string) => Promise<string[]>;
  /** After records moved: the host fetches the board again. */
  onChanged?: () => void;
  /** Says a result or a refusal (the host's toast); the board has none of its own. */
  onNotice?: (message: string, tone: "ok" | "warn" | "danger") => void;
  /** The card's title, wrapped in the host's link to the record. */
  renderTitle?: (card: BoardCardData, title: ReactNode) => ReactNode;
  words?: Partial<BoardWords>;
  /** Size the board to the window from where it starts (the page never scrolls). Off when the host's layout gives it a height. */
  fill?: boolean;
};

type Selecting = { column: string; ids: Set<string>; all: boolean };
type Dragging = { id: string; from: string };

/**
 * A workflow's board: one lane per step, cards are records. Each lane holds
 * ten and loads the next ten as it is scrolled to its foot; its header keeps
 * the server's true total. Lanes have no scrollbar — the edge with more
 * fades and an "N more" chip says how many are below — and an empty lane
 * still reads as a lane (a tint, an outline, a ruled header).
 *
 * Moving: a card dragged forward one step lands; past a step it asks to
 * confirm the skip; backwards is never by drag, only through Move. A bulk
 * move works on one lane at a time.
 */
export function Board(props: BoardProps) {
  const { columns, rules, admin, move, listIds, onChanged, onNotice, renderTitle, fill = false } = props;
  const words = useMemo(() => wordsWith(props.words), [props.words]);
  const codes = useMemo(() => columns.map((c) => c.code), [columns]);
  const names = useMemo(() => columns.map((c) => ({ code: c.code, name: c.name })), [columns]);
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [selecting, setSelecting] = useState<Selecting | null>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [moving, setMoving] = useState<{ card: BoardCardData; to?: string } | null>(null);
  const [bulk, setBulk] = useState<{ column: BoardColumnData; selection: BulkSelection } | null>(null);
  const [status, setStatus] = useState("");
  const fit = useFillHeight<HTMLDivElement>(16, 240, true);

  // A new answer from the host is the board as it now is.
  useEffect(() => {
    setRemoved(new Set());
    setSelecting(null);
  }, [columns]);

  const say = useCallback(
    (message: string, tone: "ok" | "warn" | "danger") => {
      setStatus(message);
      onNotice?.(message, tone);
    },
    [onNotice],
  );

  const settle = useCallback(
    (outcomes: MoveOutcome[]) => {
      const ok = outcomes.filter((o) => o.ok).map((o) => o.id);
      if (ok.length) {
        setRemoved((cur) => new Set([...cur, ...ok]));
        onChanged?.();
      }
    },
    [onChanged],
  );

  const dropOn = async (to: string) => {
    const d = dragging;
    setDragging(null);
    if (!d) return;
    const v = dropVerdict(codes, rules, d.from, to, admin);
    const card = columns.find((c) => c.code === d.from)?.cards.find((c) => c.id === d.id);
    if (v.state === "no") {
      if (v.refusal !== "same_stage") say(words.refusals[v.refusal] ?? words.backByDrag, "warn");
      return;
    }
    // A skip is confirmed, and a record that has moved often is warned about,
    // in the Move dialog — the drop opens it on the lane it was dropped on.
    const frequent = rules.frequent_moves > 0 && (card?.recentMoves ?? 0) >= rules.frequent_moves;
    if (v.state === "confirm" || frequent) {
      if (card) setMoving({ card, to });
      return;
    }
    try {
      const out = await move({ ids: [d.id], from: d.from, to, reason: "", confirmSkip: false });
      const o = out[0];
      if (o?.ok) {
        settle(out);
        say(`${card?.title ?? words.record} → ${names.find((n) => n.code === to)?.name ?? to}`, "ok");
      } else say(o?.message || words.refusals[o?.code ?? ""] || words.loadFailed, "danger");
    } catch (e) {
      say(e instanceof Error && e.message ? e.message : words.loadFailed, "danger");
    }
  };

  return (
    <div
      ref={fill ? fit.ref : undefined}
      className="zcu-board"
      style={fill && fit.height ? { height: fit.height } : undefined}
      data-testid="board"
      data-scroll-x
    >
      {columns.map((col) => (
        <Lane
          key={col.code}
          col={col}
          words={words}
          removed={removed}
          loadMore={props.loadMore}
          renderTitle={renderTitle}
          drop={dragging ? dropVerdict(codes, rules, dragging.from, col.code, admin) : null}
          onDropHere={() => void dropOn(col.code)}
          onDragStart={(card) => setDragging({ id: card.id, from: col.code })}
          onDragEnd={() => setDragging(null)}
          onMove={(card) => setMoving({ card })}
          selecting={selecting?.column === col.code ? selecting : null}
          canSelect={!selecting}
          onSelecting={(s) => setSelecting(s)}
          onBulk={(selection) => setBulk({ column: col, selection })}
        />
      ))}
      <p className="zcu-sr" aria-live="polite">
        {status}
      </p>
      {moving && (
        <MoveDialog
          record={{ id: moving.card.id, title: moving.card.title, stage: moving.card.stage, recentMoves: moving.card.recentMoves }}
          columns={names}
          rules={rules}
          admin={admin}
          initialTo={moving.to}
          move={move}
          words={words}
          onClose={() => setMoving(null)}
          onDone={(o) => {
            setMoving(null);
            settle([o]);
            say(words.bulkResult(1, 0), "ok");
          }}
        />
      )}
      {bulk && (
        <BulkMoveDialog
          column={{ code: bulk.column.code, name: bulk.column.name }}
          columns={names}
          selection={bulk.selection}
          rules={rules}
          admin={admin}
          listIds={listIds}
          move={move}
          words={words}
          onDone={(outcomes) => {
            const moved = outcomes.filter((o) => o.ok).length;
            say(words.bulkResult(moved, outcomes.length - moved), moved === outcomes.length ? "ok" : "warn");
          }}
          onClose={(changed) => {
            setBulk(null);
            setSelecting(null);
            if (changed) onChanged?.();
          }}
        />
      )}
    </div>
  );
}

function Lane({
  col,
  words,
  removed,
  loadMore,
  renderTitle,
  drop,
  onDropHere,
  onDragStart,
  onDragEnd,
  onMove,
  selecting,
  canSelect,
  onSelecting,
  onBulk,
}: {
  col: BoardColumnData;
  words: BoardWords;
  removed: Set<string>;
  loadMore: BoardProps["loadMore"];
  renderTitle?: BoardProps["renderTitle"];
  drop: DropVerdict | null;
  onDropHere: () => void;
  onDragStart: (card: BoardCardData) => void;
  onDragEnd: () => void;
  onMove: (card: BoardCardData) => void;
  selecting: Selecting | null;
  canSelect: boolean;
  onSelecting: (s: Selecting | null) => void;
  onBulk: (selection: BulkSelection) => void;
}) {
  const [extra, setExtra] = useState<BoardCardData[]>([]);
  const [next, setNext] = useState<string | null | undefined>(col.next);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const [over, setOver] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const loading = useRef(false);

  useEffect(() => {
    setExtra([]);
    setNext(col.next);
    setState("idle");
  }, [col]);

  const gone = col.cards.concat(extra).filter((c) => removed.has(c.id)).length;
  const cards = useMemo(() => {
    const seen = new Set<string>();
    return col.cards.concat(extra).filter((c) => !removed.has(c.id) && !seen.has(c.id) && seen.add(c.id));
  }, [col.cards, extra, removed]);
  const total = Math.max(0, col.total - gone);
  const lane = useLaneOverflow(total);

  const more = useCallback(async () => {
    if (!next || loading.current) return;
    loading.current = true;
    setState("loading");
    try {
      const page = await loadMore(col.code, next);
      setExtra((cur) => cur.concat(page.cards));
      setNext(page.next ?? null);
      setState("idle");
    } catch {
      setState("failed");
    } finally {
      loading.current = false;
    }
  }, [col.code, loadMore, next]);

  // The next ten load when the lane is scrolled near its foot, or at once
  // when the first page does not fill it (nothing to scroll).
  // Scrolled near the foot: the next ten. Not on its own while the lane
  // already overflows — ten a lane until someone scrolls (rule 12).
  const check = useCallback(
    (scrolled: boolean) => {
      const el = scroller.current;
      if (!el || !el.clientHeight || state !== "idle" || !next) return;
      const left = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (scrolled ? left < 160 : left <= 1) void more();
    },
    [more, next, state],
  );
  useEffect(() => {
    check(false);
  }, [check, cards.length]);

  // Stable: a ref callback that changed every render would be called with
  // null and the element again each time, and the overflow hook's state
  // with it — a render loop.
  const laneRef = lane.ref;
  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      scroller.current = el;
      laneRef(el);
    },
    [laneRef],
  );

  const chips = columnChips(col.flags, words);
  const selectedCount = selecting ? (selecting.all ? total : selecting.ids.size) : 0;
  const toggle = (id: string) => {
    if (!selecting) return;
    const ids = new Set(selecting.ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    onSelecting({ ...selecting, ids, all: false });
  };

  return (
    <section
      className="zcu-lane"
      aria-label={`${col.name}, ${total}`}
      data-testid={`lane-${col.code}`}
      data-drop={drop?.state}
      data-drop-over={(drop && over) || undefined}
      title={drop?.state === "no" && drop.refusal !== "same_stage" ? words.refusals[drop.refusal] : undefined}
      onDragOver={(e) => {
        if (drop && drop.state !== "no") {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDropHere();
      }}
    >
      <header className="zcu-lane-head">
        <div className="zcu-lane-title">
          <p className="zcu-lane-name" title={col.name}>
            {col.name} <span className="zcu-lane-total" data-testid="lane-total">· {total.toLocaleString("en-ZA")}</span>
          </p>
          {col.owner && <p className="zcu-lane-sub">{col.owner}</p>}
          {chips.length > 0 && <RuleChips marks={chips} size="xs" />}
        </div>
        {total > 0 && canSelect && !selecting && (
          <button type="button" className="zcu-btn" data-variant="quiet" data-size="xs" onClick={() => onSelecting({ column: col.code, ids: new Set(), all: false })}>
            {words.select}
          </button>
        )}
      </header>
      {drop?.state === "no" && drop.refusal !== "same_stage" && <p className="zcu-lane-note">{words.refusals[drop.refusal]}</p>}
      <div ref={attach} {...lane.props} className="zcu-lane-scroll" data-scroll-region onScroll={() => check(true)} data-testid="lane-scroll">
        {cards.length === 0 && state !== "loading" ? (
          <p className="zcu-lane-empty">{words.empty}</p>
        ) : (
          <ul className="zcu-cards">
            {cards.map((card) => (
              <li key={card.id} data-lane-item>
                <Card
                  card={card}
                  words={words}
                  renderTitle={renderTitle}
                  selecting={!!selecting}
                  selected={!!selecting && (selecting.all || selecting.ids.has(card.id))}
                  onToggle={() => toggle(card.id)}
                  onDragStart={() => onDragStart(card)}
                  onDragEnd={onDragEnd}
                  onMove={() => onMove(card)}
                />
              </li>
            ))}
          </ul>
        )}
        {state === "loading" && <p className="zcu-lane-loading">{words.loading}…</p>}
        {state === "failed" && (
          <p className="zcu-lane-loading">
            {words.loadFailed}{" "}
            <button type="button" className="zcu-link" onClick={() => void more()}>
              {words.tryAgain}
            </button>
          </p>
        )}
      </div>
      {!selecting && <LaneMore count={lane.below} more={lane.more} onClick={lane.scrollOn} words={words} />}
      {selecting && (
        <div className="zcu-lane-bulk" data-testid="lane-bulk">
          <span className="zcu-lane-bulk-count">{words.selected(selectedCount)}</span>
          <div className="zcu-lane-bulk-actions">
            {!selecting.all && total > 0 && (
              <button type="button" className="zcu-btn" data-variant="quiet" data-size="xs" onClick={() => onSelecting({ ...selecting, all: true })}>
                {words.selectAll(total)}
              </button>
            )}
            <button
              type="button"
              className="zcu-btn"
              data-variant="primary"
              data-size="xs"
              disabled={selectedCount === 0}
              onClick={() => onBulk(selecting.all ? { all: true, total } : { all: false, ids: [...selecting.ids] })}
            >
              {words.move}
            </button>
            <button type="button" className="zcu-btn" data-variant="quiet" data-size="xs" onClick={() => onSelecting(null)}>
              {words.cancel}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Card({
  card,
  words,
  renderTitle,
  selecting,
  selected,
  onToggle,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  card: BoardCardData;
  words: BoardWords;
  renderTitle?: BoardProps["renderTitle"];
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: () => void;
}) {
  const marks = cardMarks(card, words);
  const title = <span className="zcu-card-title-text">{card.title}</span>;
  return (
    <article
      className="zcu-card"
      data-selected={selected || undefined}
      draggable={!selecting}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      data-testid="board-card"
      data-card={card.id}
    >
      <div className="zcu-card-row">
        {selecting && <input type="checkbox" className="zcu-card-check" checked={selected} onChange={onToggle} aria-label={card.title} />}
        <p className="zcu-card-title" title={card.title}>
          {renderTitle ? renderTitle(card, title) : title}
        </p>
        {!selecting && (
          <button type="button" className="zcu-card-move" onClick={onMove} aria-label={`${words.move} ${card.title}`} data-testid="card-move">
            {words.move}
          </button>
        )}
      </div>
      {card.subtitle && (
        <p className="zcu-card-sub" title={card.subtitle}>
          {card.subtitle}
        </p>
      )}
      {marks.length > 0 && <RuleChips marks={marks} />}
      {card.meta && <p className="zcu-card-meta">{card.meta}</p>}
    </article>
  );
}
