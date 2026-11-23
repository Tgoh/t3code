export const INITIAL_ROWS = 60;
export const CHUNK_ROWS = 30;

export function initialFirst(length: number): number {
  return Math.max(0, length - INITIAL_ROWS);
}

/** `anchor` is the row a returning reader was at, which the window opens far enough up to hold. */
export function firstAfterChange(
  previous: readonly string[],
  next: readonly string[],
  first: number,
  anchor: string | null = null,
): number {
  if (previous.length === 0) {
    const at = anchor === null ? -1 : next.indexOf(anchor);
    return at < 0 ? initialFirst(next.length) : Math.min(at, initialFirst(next.length));
  }
  if (first === 0) return 0;
  const top = previous[first];
  if (top !== undefined) {
    if (next[first] === top) return first;
    const moved = next.indexOf(top);
    if (moved >= 0) return moved;
  }
  return Math.max(0, Math.min(first, next.length - 1));
}

export function keepsWindow(
  previous: readonly string[],
  previousFirst: number,
  next: readonly string[],
  first: number,
): boolean {
  const kept = previous.length - previousFirst;
  if (next.length - first < kept) return false;
  for (let offset = 0; offset < kept; offset += 1) {
    if (previous[previousFirst + offset] !== next[first + offset]) return false;
  }
  return true;
}

export function grow(first: number): number {
  return Math.max(0, first - CHUNK_ROWS);
}

// Floor is the most rows the viewport has needed while stuck; trimming below it would bring the
// sentinel back into view and grow the window again on every added row.
export function trimToTail(length: number, first: number, floor: number): number {
  return length - first > floor + CHUNK_ROWS ? length - floor : first;
}

export interface IScrollPosition {
  Top: number;
  Height: number;
  ClientHeight: number;
}

const END_DISTANCE = 40;

/**
 * What a scroll event means for following the end. The browser lowers `scrollTop` by itself when
 * content or the viewport shrinks, so a move up detaches only when the user is touching or dragging
 * the scroller, or when no size change explains it.
 */
export function followAfterScroll(
  previous: IScrollPosition,
  next: IScrollPosition,
  userInput: boolean,
): "stick" | "detach" | "keep" {
  if (next.Height - next.Top - next.ClientHeight < END_DISTANCE) return "stick";
  if (next.Top >= previous.Top) return "keep";
  const resized = next.Height !== previous.Height || next.ClientHeight !== previous.ClientHeight;
  return userInput || !resized ? "detach" : "keep";
}
