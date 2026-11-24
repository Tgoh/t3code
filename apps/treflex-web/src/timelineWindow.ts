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

export function grow(first: number): number {
  return Math.max(0, first - CHUNK_ROWS);
}

// Floor is the most rows the viewport has needed while stuck; trimming below it would bring the
// sentinel back into view and grow the window again on every added row.
export function trimToTail(length: number, first: number, floor: number): number {
  return length - first > floor + CHUNK_ROWS ? length - floor : first;
}

const END_DISTANCE = 40;

/** Distances are from the end of the timeline, which a bottom-anchored scroller keeps through resizes. */
export function followAfterScroll(previous: number, next: number): "stick" | "detach" | "keep" {
  if (next < END_DISTANCE) return "stick";
  return next > previous ? "detach" : "keep";
}
