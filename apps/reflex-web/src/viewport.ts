// @effect-diagnostics globalTimers:off -- A view-only long-press delay, outside any Effect runtime.
import {
  type Accessor,
  createComputed,
  createContext,
  createSignal,
  on,
  onCleanup,
  useContext,
} from "solid-js";

/**
 * Stock's breakpoints: `SIDEBAR_MOBILE_QUERY` in `apps/web/src/components/ui/sidebar.tsx`,
 * `RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY` in `rightPanelLayout.ts`, and `max-sm` for the composer.
 * The `@media` rules in `styles.css` use the same widths.
 */
export const SIDEBAR_SHEET_QUERY = "(max-width: 767px)";
export const PANEL_SHEET_QUERY = "(max-width: 980px)";
export const PHONE_QUERY = "(max-width: 639px)";

type IMediaList = Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">;

export function createMediaQuery(
  query: string,
  matchMedia: (query: string) => IMediaList = (held) => window.matchMedia(held),
): Accessor<boolean> {
  const list = matchMedia(query);
  const [matches, setMatches] = createSignal(list.matches);
  const update = () => setMatches(list.matches);
  list.addEventListener("change", update);
  onCleanup(() => list.removeEventListener("change", update));
  return matches;
}

// Longer than iOS's keyboard animation, which reports its final size only when it ends, if at all.
const KEYBOARD_SETTLE_MS = 1_000;
// Taller than Safari's collapsing toolbar, so only a keyboard counts.
const KEYBOARD_MIN_HEIGHT = 150;

/**
 * Sizes the app to the visual viewport, which iOS Safari shrinks for the on-screen keyboard while
 * the layout viewport stays full height. Pinch zoom also shrinks it, so a zoomed page is left alone.
 * iOS can deliver the viewport's events late around a focus change, so the size is also polled for
 * a moment then.
 */
export function trackVisualViewport(target: HTMLElement) {
  const viewport = window.visualViewport;
  if (viewport == null) return;
  const update = () => {
    if (Math.abs(viewport.scale - 1) > 0.01) {
      target.style.removeProperty("--viewport-height");
      target.style.removeProperty("--viewport-top");
      delete target.dataset.keyboard;
      return;
    }
    target.style.setProperty("--viewport-height", `${viewport.height}px`);
    target.style.setProperty("--viewport-top", `${viewport.offsetTop}px`);
    if (target.clientHeight - viewport.height > KEYBOARD_MIN_HEIGHT)
      target.dataset.keyboard = "open";
    else delete target.dataset.keyboard;
  };
  let frame = 0;
  const follow = () => {
    cancelAnimationFrame(frame);
    const until = performance.now() + KEYBOARD_SETTLE_MS;
    const step = () => {
      update();
      frame = performance.now() < until ? requestAnimationFrame(step) : 0;
    };
    step();
  };
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  window.addEventListener("scroll", update);
  document.addEventListener("focusin", follow);
  document.addEventListener("focusout", follow);
  onCleanup(() => {
    cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    window.removeEventListener("scroll", update);
    document.removeEventListener("focusin", follow);
    document.removeEventListener("focusout", follow);
  });
}

export function composerCollapses(input: {
  Phone: boolean;
  Focused: boolean;
  Draft: string;
  HasAttachments: boolean;
}): boolean {
  return input.Phone && !input.Focused && !input.Draft.includes("\n") && !input.HasAttachments;
}

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;

/**
 * Opens a context menu on a touch long-press, since iOS Safari fires no `contextmenu`. The row's
 * click handler checks `swallowsClick` so the release doesn't also activate it.
 */
export function longPress(onPress: (x: number, y: number) => void) {
  const held = { timer: undefined as ReturnType<typeof setTimeout> | undefined, x: 0, y: 0 };
  const pressed = { fired: false };
  const cancel = () => {
    clearTimeout(held.timer);
    held.timer = undefined;
  };
  return {
    onPointerDown: (event: PointerEvent) => {
      cancel();
      pressed.fired = false;
      if (event.pointerType !== "touch") return;
      held.x = event.clientX;
      held.y = event.clientY;
      held.timer = setTimeout(() => {
        held.timer = undefined;
        pressed.fired = true;
        onPress(held.x, held.y);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: PointerEvent) => {
      if (Math.hypot(event.clientX - held.x, event.clientY - held.y) > LONG_PRESS_SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    /** True once for the click that ends a long-press. */
    swallowsClick: () => {
      const fired = pressed.fired;
      pressed.fired = false;
      return fired;
    },
  };
}

export interface ISidebarSheet {
  /** The sidebar is an off-canvas sheet rather than a column. */
  sheet: Accessor<boolean>;
  open: Accessor<boolean>;
  setOpen: (open: boolean) => void;
  /** The column is hidden, which only a wide layout allows. */
  collapsed: Accessor<boolean>;
  /** Opens or closes the sheet on a narrow layout, and collapses or restores the column on a wide one. */
  toggle: () => void;
  /** A thread was picked, which closes the sheet even when it was already the selected one. */
  choseThread: () => void;
}

/**
 * Picking or selecting a thread closes the sheet, and leaving the sheet layout forgets that it was
 * open. The column's collapse outlives the sheet layout, as stock's sidebar cookie does.
 */
export function createSidebarSheet(
  sheet: Accessor<boolean>,
  selection: Accessor<unknown>,
  collapse: { initial: boolean; onChange: (collapsed: boolean) => void } = {
    initial: false,
    onChange: () => {},
  },
) {
  const [open, setOpen] = createSignal(false);
  const [collapsed, setCollapsed] = createSignal(collapse.initial);
  createComputed(on(selection, () => setOpen(false), { defer: true }));
  createComputed(() => {
    if (!sheet()) setOpen(false);
  });
  return {
    sheet,
    open: () => sheet() && open(),
    setOpen,
    collapsed: () => !sheet() && collapsed(),
    toggle: () => {
      if (sheet()) return setOpen(!open());
      setCollapsed(!collapsed());
      collapse.onChange(collapsed());
    },
    choseThread: () => setOpen(false),
  } satisfies ISidebarSheet;
}

export const SidebarSheetContext = createContext<ISidebarSheet>({
  sheet: () => false,
  open: () => false,
  setOpen: () => {},
  collapsed: () => false,
  toggle: () => {},
  choseThread: () => {},
});

export const useSidebarSheet = () => useContext(SidebarSheetContext);
