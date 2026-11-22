// Follows apps/web/src/components/threadSidebarWidth.ts and the `shouldAcceptWidth` check in
// AppSidebarLayout.tsx.
export const SIDEBAR_DEFAULT_WIDTH = 16 * 16;
export const SIDEBAR_MIN_WIDTH = 13 * 16;
export const MAIN_CONTENT_MIN_WIDTH = 40 * 16;

export function sidebarMaxWidth(viewportWidth: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.floor(viewportWidth) - MAIN_CONTENT_MIN_WIDTH);
}

/** The width the sidebar shows at: the stored one or the default, within this viewport's bounds. */
export function shownSidebarWidth(stored: number | null, viewportWidth: number): number {
  const width = stored === null ? SIDEBAR_DEFAULT_WIDTH : Math.max(SIDEBAR_MIN_WIDTH, stored);
  return Math.min(sidebarMaxWidth(viewportWidth), width);
}

/**
 * One drag step. A step that would leave the main content under its minimum is refused, so the
 * width stays where it was; shrinking is always allowed.
 */
export function dragSidebarWidth(input: {
  Current: number;
  Next: number;
  ViewportWidth: number;
  LayoutWidth: number;
}): number {
  const next = Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.min(sidebarMaxWidth(input.ViewportWidth), input.Next),
  );
  return next <= input.Current || input.LayoutWidth - next >= MAIN_CONTENT_MIN_WIDTH
    ? next
    : input.Current;
}
