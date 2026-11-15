import type { BoardWords } from "./words.js";
import { DEFAULT_WORDS } from "./words.js";

/** The chip at the foot of a lane whose cards run on below its edge — the
 *  lane hides its scrollbar, so this (and the fade) says there is more and
 *  how much. Clicking scrolls the lane on. Sits inside a `relative` lane. */
export function LaneMore({ count, more, onClick, words = DEFAULT_WORDS }: { count: number; more: boolean; onClick: () => void; words?: BoardWords }) {
  if (!more) return null;
  return (
    <button type="button" onClick={onClick} className="zcu-lane-more" data-testid="lane-more">
      <svg className="zcu-lane-more-arrow" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
        <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {count > 0 ? words.more(count) : words.moreFallback}
    </button>
  );
}
