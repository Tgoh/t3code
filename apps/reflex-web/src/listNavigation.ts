/** The step an arrow key takes through a list, or null for any other key. */
export function arrowStep(key: string, horizontal = false): 1 | -1 | null {
  if (key === "ArrowDown" || (horizontal && key === "ArrowRight")) return 1;
  if (key === "ArrowUp" || (horizontal && key === "ArrowLeft")) return -1;
  return null;
}

/**
 * The next highlighted row, wrapping at both ends. From no highlight, a step down starts at the
 * first row and a step up at the last. Null when the list is empty.
 */
export function stepHighlight(current: number | null, count: number, step: 1 | -1): number | null {
  if (count === 0) return null;
  if (current === null || current < 0) return step === 1 ? 0 : count - 1;
  return (current + step + count) % count;
}

/** Moves focus one element along `items` from the focused one, wrapping or stopping at the ends. */
export function focusStep(
  items: readonly HTMLElement[],
  step: 1 | -1,
  ends: "wrap" | "clamp",
): HTMLElement | undefined {
  const index = items.findIndex((item) => item === document.activeElement);
  const target =
    ends === "wrap"
      ? (index + step + items.length) % items.length
      : Math.min(items.length - 1, Math.max(0, index + step));
  const next = items[target];
  next?.focus();
  return next;
}
