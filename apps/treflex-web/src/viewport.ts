// @effect-diagnostics globalTimers:off -- A view-only long-press delay, outside any Effect runtime.
import type { ClientSettings } from "@t3tools/contracts/settings";
import { isEditable } from "./keybindings";
import {
  type Accessor,
  createContext,
  createRenderEffect,
  createSignal,
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
/** A phone in landscape, which is wider than `PHONE_QUERY` but has even less height to spare. */
export const SHORT_TOUCH_QUERY = "(pointer: coarse) and (max-height: 500px)";

/**
 * Holds a freshly mounted panel in its `data-starting-style:` style until its first frame has
 * painted, then lets it transition in. `@starting-style` starts the transition before that frame,
 * so a slow mount (the terminal in WebKit) paints it already finished.
 */
export function enterPanel(element: HTMLElement) {
  queueMicrotask(() => {
    if (!element.closest(".panel-motion")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    element.dataset.startingStyle = "";
    requestAnimationFrame(() => requestAnimationFrame(() => delete element.dataset.startingStyle));
  });
}

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
 * While typing on a touch screen, or until a keyboard seen open closes, also compares with the
 * tallest viewport seen at that width, since a layout viewport that shrinks with the keyboard hides
 * it from `layoutHeight`. Focus passes through `<body>` between fields with the keyboard still up.
 * Otherwise a window made shorter, on a desktop or in split screen, would count as a keyboard.
 */
export function createKeyboardDetector(typingOnTouch: () => boolean) {
  const tallest = new Map<number, number>();
  let open = false;
  return (visual: { width: number; height: number }, layoutHeight: number): boolean => {
    const width = Math.round(visual.width);
    const full =
      open || typingOnTouch() ? Math.max(layoutHeight, tallest.get(width) ?? 0) : layoutHeight;
    open = full - visual.height > KEYBOARD_MIN_HEIGHT;
    if (!open) tallest.set(width, Math.max(full, visual.height));
    return open;
  };
}

/**
 * Pinch zoom shrinks the visual viewport too, so a zoomed page is left alone.
 * iOS can deliver the viewport's events late around a focus change or a rotation, so the size is
 * also polled for a moment then.
 */
export function trackVisualViewport(target: HTMLElement) {
  const viewport = window.visualViewport;
  if (viewport == null) return;
  const touch = window.matchMedia(COARSE_POINTER_QUERY);
  const keyboardOpen = createKeyboardDetector(
    () => touch.matches && isEditable(document.activeElement),
  );
  const update = () => {
    if (Math.abs(viewport.scale - 1) > 0.01) {
      target.style.removeProperty("--viewport-height");
      target.style.removeProperty("--viewport-top");
      delete target.dataset.keyboard;
      return;
    }
    target.style.setProperty("--viewport-height", `${viewport.height}px`);
    if (keyboardOpen(viewport, target.clientHeight)) {
      target.dataset.keyboard = "open";
      target.style.setProperty("--viewport-top", `${viewport.offsetTop}px`);
      return;
    }
    delete target.dataset.keyboard;
    // A rotating iOS home-screen app can leave the document scrolled by the status bar's height,
    // which with no keyboard up is never a scroll the app wants.
    target.style.setProperty("--viewport-top", "0px");
    if (window.scrollY !== 0) window.scrollTo(0, 0);
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
  window.addEventListener("resize", follow);
  window.addEventListener("orientationchange", follow);
  document.addEventListener("focusin", follow);
  document.addEventListener("focusout", follow);
  onCleanup(() => {
    cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    window.removeEventListener("scroll", update);
    window.removeEventListener("resize", follow);
    window.removeEventListener("orientationchange", follow);
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

/**
 * Runs the latest callback it's given on the next frame. The composer's collapse waits a frame, as
 * stock's `scheduleComposerCollapseCheck` does, so a tap that blurred the prompt still clicks the
 * control it landed on before the composer collapses under it.
 */
export function nextFrame(): (run: () => void) => void {
  const pending = { frame: 0 };
  onCleanup(() => cancelAnimationFrame(pending.frame));
  return (run) => {
    cancelAnimationFrame(pending.frame);
    pending.frame = requestAnimationFrame(run);
  };
}

export const COARSE_POINTER_QUERY = "(pointer: coarse)";

// Follows composerRequiresModifier in apps/web/src/composer-logic.ts.
export function composerRequiresModifier(
  sendShortcut: ClientSettings["sendShortcut"],
  prompt: string,
): boolean {
  return (
    sendShortcut === "mod-enter" ||
    (sendShortcut === "mod-enter-multiline" && /[\r\n]/.test(prompt))
  );
}

/**
 * On a touch screen Enter adds a line and only the send button or a modifier sends. When the Send
 * shortcut asks for a modifier, plain Enter adds a line, and Shift with the modifier is the
 * alternate send during a turn, as stock's `shortcutForContext` moves it there.
 */
export function enterSends(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "isComposing" | "metaKey" | "ctrlKey">,
  coarsePointer: boolean,
  requiresModifier = false,
  running = false,
): boolean {
  if (event.key !== "Enter" || event.isComposing) return false;
  const modifier = event.metaKey || event.ctrlKey;
  if (requiresModifier) return modifier && (!event.shiftKey || running);
  if (event.shiftKey) return false;
  return !coarsePointer || modifier;
}

export function enterIsAlternate(
  event: Pick<KeyboardEvent, "shiftKey" | "metaKey" | "ctrlKey">,
  requiresModifier: boolean,
  mac: boolean,
): boolean {
  const mod = mac ? event.metaKey : event.ctrlKey;
  return mod && event.shiftKey === requiresModifier;
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
  createRenderEffect(
    selection,
    () => {
      setOpen(false);
    },
    { defer: true },
  );
  // Deferred: `open` starts false, and a render effect's first run writes in its creator's scope.
  createRenderEffect(
    sheet,
    (isSheet) => {
      if (!isSheet) setOpen(false);
    },
    { defer: true },
  );
  return {
    sheet,
    open: () => sheet() && open(),
    setOpen,
    collapsed: () => !sheet() && collapsed(),
    toggle: () => {
      if (sheet()) return setOpen(!open());
      const next = !collapsed();
      setCollapsed(next);
      collapse.onChange(next);
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
