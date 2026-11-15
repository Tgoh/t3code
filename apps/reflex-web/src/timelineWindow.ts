export const INITIAL_ROWS = 60;
export const CHUNK_ROWS = 30;

export function initialFirst(length: number): number {
  return Math.max(0, length - INITIAL_ROWS);
}

// A window that reaches the top keeps reaching it, so a history page lands mounted.
export function firstAfterChange(
  previous: readonly string[],
  next: readonly string[],
  first: number,
): number {
  if (previous.length === 0) return initialFirst(next.length);
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
