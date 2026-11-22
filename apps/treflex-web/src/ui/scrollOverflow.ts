const EDGE_TOLERANCE = 1;

const EDGE_VARS = [
  "--scroll-area-overflow-x-start",
  "--scroll-area-overflow-x-end",
  "--scroll-area-overflow-y-start",
  "--scroll-area-overflow-y-end",
] as const;

let registered = false;

/** As Base UI does, so a viewport's deep subtree doesn't inherit variables that change per frame. */
function registerEdgeVars() {
  if (registered) return;
  registered = true;
  // Safari doesn't honour an explicit `inherit` on a non-inheriting property, so Base UI skips it.
  const webkit =
    /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium/.test(navigator.userAgent);
  if (webkit || typeof CSS === "undefined" || !("registerProperty" in CSS)) return;
  for (const name of EDGE_VARS) {
    try {
      CSS.registerProperty({ name, syntax: "<length>", inherits: false, initialValue: "0px" });
    } catch {
      // Already registered.
    }
  }
}

function normalizeOffset(value: number, max: number): number {
  if (max <= 0) return 0;
  const clamped = Math.min(Math.max(value, 0), max);
  const atStart = clamped <= EDGE_TOLERANCE;
  const atEnd = max - clamped <= EDGE_TOLERANCE;
  if (atStart && atEnd) return clamped <= max - clamped ? 0 : max;
  if (atStart) return 0;
  if (atEnd) return max;
  return clamped;
}

/**
 * Writes what Base UI's ScrollArea viewport does on scroll and resize: the
 * `--scroll-area-overflow-{x,y}-{start,end}` distances, `data-has-overflow-*` and
 * `data-overflow-*-{start,end}`, and a tab stop while it can scroll unless `tabIndex` fixes it.
 * Returns the stop.
 */
export function trackScrollOverflow(
  viewport: HTMLElement,
  options: { tabIndex?: number | undefined } = {},
): () => void {
  registerEdgeVars();
  if (options.tabIndex !== undefined) viewport.tabIndex = options.tabIndex;
  const rtl = getComputedStyle(viewport).direction === "rtl";
  const flag = (name: string, on: boolean) => viewport.toggleAttribute(name, on);
  const measure = () => {
    const { scrollHeight, scrollWidth, clientHeight, clientWidth } = viewport;
    if (scrollHeight === 0 || scrollWidth === 0) return;
    const hiddenY = clientHeight >= scrollHeight;
    const hiddenX = clientWidth >= scrollWidth;
    const maxLeft = Math.max(0, scrollWidth - clientWidth);
    const maxTop = Math.max(0, scrollHeight - clientHeight);
    const left = hiddenX
      ? 0
      : normalizeOffset(rtl ? -viewport.scrollLeft : viewport.scrollLeft, maxLeft);
    const top = hiddenY ? 0 : normalizeOffset(viewport.scrollTop, maxTop);
    const edges = [left, hiddenX ? 0 : maxLeft - left, top, hiddenY ? 0 : maxTop - top];
    EDGE_VARS.forEach((name, index) => viewport.style.setProperty(name, `${edges[index]}px`));
    if (options.tabIndex === undefined) viewport.tabIndex = hiddenX && hiddenY ? -1 : 0;
    flag("data-has-overflow-x", !hiddenX);
    flag("data-has-overflow-y", !hiddenY);
    flag("data-overflow-x-start", edges[0]! > 0);
    flag("data-overflow-x-end", edges[1]! > 0);
    flag("data-overflow-y-start", edges[2]! > 0);
    flag("data-overflow-y-end", edges[3]! > 0);
  };
  const observer = new ResizeObserver(measure);
  observer.observe(viewport);
  viewport.addEventListener("scroll", measure, { passive: true });
  // The content's size moves the overflow without resizing the viewport.
  queueMicrotask(() => {
    for (const child of viewport.children) observer.observe(child);
  });
  return () => {
    observer.disconnect();
    viewport.removeEventListener("scroll", measure);
  };
}
