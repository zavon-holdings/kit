import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { PAGE_SIZE } from "./pages.js";
import { RuleChips } from "./RuleChips.js";
import { cardMarks } from "./rules.js";
import type { BoardCardData, ColumnPage } from "./types.js";
import { useFillHeight } from "./useFillHeight.js";
import { wordsWith, type BoardWords } from "./words.js";

export type BoardListProps = {
  /** A page of the board's records across its steps, from a cursor ("" is the first). */
  load: (cursor: string) => Promise<ColumnPage>;
  columns: { code: string; name: string }[];
  /** Changes when the filters do: the list starts again from its first page. */
  resetKey: string;
  renderTitle?: (card: BoardCardData, title: ReactNode) => ReactNode;
  words?: Partial<BoardWords>;
  fill?: boolean;
};

/**
 * The board as a list: every step's records together, ten a page with the
 * true total, the newest under the board's own order. The rows scroll inside
 * the list, whose header row and pager stay in view.
 */
export function BoardList({ load, columns, resetKey, renderTitle, words: over, fill = false }: BoardListProps) {
  const words = useMemo(() => wordsWith(over), [over]);
  // The cursors of the pages already seen, so Previous goes back exactly.
  const [cursors, setCursors] = useState<string[]>([""]);
  const [page, setPage] = useState<ColumnPage | null>(null);
  const [failed, setFailed] = useState(false);
  const fit = useFillHeight<HTMLDivElement>(16, 240, true);
  const at = cursors.length - 1;

  const fetchPage = useCallback(
    async (cursor: string) => {
      setFailed(false);
      try {
        setPage(await load(cursor));
      } catch {
        setFailed(true);
      }
    },
    [load],
  );

  useEffect(() => {
    setCursors([""]);
    void fetchPage("");
  }, [resetKey, fetchPage]);

  const name = (code: string) => columns.find((c) => c.code === code)?.name ?? code;
  const from = page && page.total ? at * PAGE_SIZE + 1 : 0;
  const to = page ? at * PAGE_SIZE + page.cards.length : 0;

  return (
    <div ref={fill ? fit.ref : undefined} className="zcu-list" style={fill && fit.height ? { height: fit.height } : undefined} data-testid="board-list">
      <div className="zcu-list-scroll" data-scroll-region>
        <table className="zcu-table">
          <thead>
            <tr>
              <th>{words.listColumns.record}</th>
              <th>{words.listColumns.stage}</th>
              <th>{words.listColumns.marks}</th>
            </tr>
          </thead>
          <tbody>
            {page?.cards.map((card) => {
              const title = <span className="zcu-card-title-text">{card.title}</span>;
              return (
                <tr key={card.id} data-testid="list-row">
                  <td>
                    <span className="zcu-list-title">{renderTitle ? renderTitle(card, title) : title}</span>
                    {card.subtitle && <span className="zcu-card-sub">{card.subtitle}</span>}
                  </td>
                  <td data-col="stage">{name(card.stage)}</td>
                  <td data-col="marks">
                    <RuleChips marks={cardMarks(card, words)} size="xs" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {page && page.cards.length === 0 && <p className="zcu-lane-empty">{words.empty}</p>}
        {!page && !failed && <p className="zcu-lane-loading">{words.loading}…</p>}
        {failed && (
          <p className="zcu-lane-loading">
            {words.loadFailed}{" "}
            <button type="button" className="zcu-link" onClick={() => void fetchPage(cursors[at])}>
              {words.tryAgain}
            </button>
          </p>
        )}
      </div>
      <div className="zcu-pager" data-testid="list-pager">
        <span>{page ? words.pager(from, to, page.total) : ""}</span>
        <div className="zcu-pager-buttons">
          <button
            type="button"
            className="zcu-btn"
            data-variant="quiet"
            data-size="xs"
            disabled={at === 0}
            onClick={() => {
              const back = cursors.slice(0, -1);
              setCursors(back);
              void fetchPage(back[back.length - 1]);
            }}
          >
            {words.previous}
          </button>
          <button
            type="button"
            className="zcu-btn"
            data-variant="quiet"
            data-size="xs"
            disabled={!page?.next}
            onClick={() => {
              if (!page?.next) return;
              setCursors([...cursors, page.next]);
              void fetchPage(page.next);
            }}
          >
            {words.next}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Board or List: a segmented toggle. The choice lives in the URL (`v=list`). */
export function ViewToggle({ view, onChange, words: over }: { view: "board" | "list"; onChange: (v: "board" | "list") => void; words?: Partial<BoardWords> }) {
  const words = wordsWith(over);
  return (
    <div className="zcu-toggle" role="group" aria-label={`${words.board} / ${words.list}`}>
      {(["board", "list"] as const).map((v) => (
        <button key={v} type="button" aria-pressed={view === v} className="zcu-toggle-btn" onClick={() => onChange(v)}>
          {v === "board" ? words.board : words.list}
        </button>
      ))}
    </div>
  );
}
