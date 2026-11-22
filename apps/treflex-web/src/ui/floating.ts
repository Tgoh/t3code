// @effect-diagnostics globalTimers:off -- View-only focus timing, outside any Effect runtime.
import {
  autoUpdate,
  computePosition,
  flip,
  limitShift,
  type Middleware,
  offset,
  type Placement,
  shift,
  size,
  type VirtualElement,
} from "@floating-ui/dom";
import { createComputed, on, onCleanup, onMount } from "solid-js";

import { type ICloseReason, useOverlays } from "../overlays";
import { usePresence } from "./Presence";

export type ISide = "top" | "bottom" | "left" | "right" | "inline-end" | "inline-start";
export type IAlign = "start" | "center" | "end";
type ICollision = "flip" | "shift" | "none";

export interface IPlacement {
  side: ISide;
  align: IAlign;
  sideOffset: number;
  alignOffset?: number | undefined;
  collisionPadding?: number | undefined;
  collisionAvoidance?:
    | {
        side?: ICollision;
        align?: ICollision;
        fallbackAxisSide?: "none" | "end";
      }
    | undefined;
}

/** A popup's anchor: an element, or a point such as a context menu's. */
export type IAnchor = Element | { X: number; Y: number };

const COLLISION_PADDING = 5;

const physical = (side: ISide) =>
  side === "inline-end" ? "right" : side === "inline-start" ? "left" : side;

const reference = (anchor: IAnchor): Element | VirtualElement =>
  anchor instanceof Element
    ? anchor
    : { getBoundingClientRect: () => new DOMRect(anchor.X, anchor.Y, 0, 0) };

function middleware(placement: IPlacement): Middleware[] {
  const side = physical(placement.side);
  const padding = placement.collisionPadding ?? COLLISION_PADDING;
  const sideMode = placement.collisionAvoidance?.side ?? "flip";
  const alignMode = placement.collisionAvoidance?.align ?? "flip";
  const alignOffset = placement.alignOffset ?? 0;
  const shiftDisabled = alignMode === "none" && sideMode !== "shift";
  // A one-pixel bias towards the requested side, on flip() alone.
  const pad = padding + 1;
  const flipper =
    sideMode === "none"
      ? null
      : flip({
          padding: {
            top: pad + (side === "bottom" ? 1 : 0),
            right: pad + (side === "left" ? 1 : 0),
            bottom: pad + (side === "top" ? 1 : 0),
            left: pad + (side === "right" ? 1 : 0),
          },
          mainAxis: sideMode === "flip",
          crossAxis: alignMode === "flip" ? "alignment" : false,
          fallbackAxisSideDirection: placement.collisionAvoidance?.fallbackAxisSide ?? "end",
        });
  const shifter = shiftDisabled
    ? null
    : shift({
        padding,
        mainAxis: alignMode !== "none",
        crossAxis: sideMode === "shift",
        limiter: limitShift(),
      });
  const shiftFirst = sideMode === "shift" || alignMode === "shift" || placement.align === "center";
  return [
    offset({ mainAxis: placement.sideOffset, crossAxis: alignOffset, alignmentAxis: alignOffset }),
    ...(shiftFirst ? [shifter, flipper] : [flipper, shifter]).filter(
      (entry): entry is Middleware => entry !== null,
    ),
    size({
      padding,
      apply({ elements, availableWidth, availableHeight, rects }) {
        const style = elements.floating.style;
        style.setProperty("--available-width", `${availableWidth}px`);
        style.setProperty("--available-height", `${availableHeight}px`);
        style.setProperty("--anchor-width", `${rects.reference.width}px`);
        style.setProperty("--anchor-height", `${rects.reference.height}px`);
      },
    }),
  ];
}

/**
 * Places a fixed positioner against its anchor and writes what Base UI's positioner does:
 * `data-side`, `data-align` (on it and its popup), `--transform-origin` and the available and
 * anchor sizes.
 */
export async function place(
  positioner: HTMLElement,
  anchor: IAnchor,
  placement: IPlacement,
): Promise<void> {
  const side = physical(placement.side);
  const requested: Placement = placement.align === "center" ? side : `${side}-${placement.align}`;
  const target = reference(anchor);
  const result = await computePosition(target, positioner, {
    strategy: "fixed",
    placement: requested,
    middleware: middleware(placement),
  });
  const [placedSide, placedAlign] = result.placement.split("-") as [
    "top" | "bottom" | "left" | "right",
    "start" | "end" | undefined,
  ];
  const vertical = placedSide === "top" || placedSide === "bottom";
  const shiftX = result.middlewareData.shift?.x ?? 0;
  const shiftY = result.middlewareData.shift?.y ?? 0;
  const box = target.getBoundingClientRect();
  let cross: string;
  if (placedAlign !== undefined && Math.abs(vertical ? shiftX : shiftY) <= 1) {
    cross = placedAlign === "start" ? "0%" : "100%";
  } else {
    cross = vertical
      ? `${Math.max(0, Math.min(box.x + box.width / 2 - result.x, positioner.offsetWidth))}px`
      : `${Math.max(0, Math.min(box.y + box.height / 2 - result.y, positioner.offsetHeight))}px`;
  }
  let along =
    placedSide === "top" || placedSide === "left"
      ? `calc(100% + ${placement.sideOffset}px)`
      : `${-placement.sideOffset}px`;
  if (
    placement.collisionAvoidance?.side === "shift" &&
    vertical &&
    Math.abs(shiftY) > placement.sideOffset
  ) {
    along = `${box.y + box.height / 2 - result.y}px`;
  }
  positioner.style.left = `${result.x}px`;
  positioner.style.top = `${result.y}px`;
  positioner.style.setProperty(
    "--transform-origin",
    vertical ? `${cross} ${along}` : `${along} ${cross}`,
  );
  for (const element of [positioner, positioner.firstElementChild]) {
    if (!(element instanceof HTMLElement)) continue;
    element.dataset.side = placedSide;
    element.dataset.align = placedAlign ?? "center";
  }
}

/**
 * Keeps a positioner on its anchor while it moves, scrolls or resizes, until the returned stop.
 * `onLost` runs when an element anchor leaves the document.
 */
export function follow(
  positioner: HTMLElement,
  anchor: IAnchor,
  placement: () => IPlacement,
  onLost: () => void,
  onPlaced?: () => void,
): () => void {
  const target = reference(anchor);
  return autoUpdate(target, positioner, () => {
    if (anchor instanceof Element && !anchor.isConnected) {
      onLost();
      return;
    }
    void place(positioner, anchor, placement()).then(onPlaced);
  });
}

/** Base UI's modal backdrop: it covers the page except the trigger, so presses there still land. */
export function backdropStyle(trigger: HTMLElement | null | undefined) {
  const box = trigger?.getBoundingClientRect();
  return {
    position: "fixed",
    inset: "0px",
    "user-select": "none",
    "-webkit-user-select": "none",
    "clip-path":
      box === undefined
        ? undefined
        : `polygon(0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,${box.left}px ${box.top}px,${box.left}px ${box.bottom}px,${box.right}px ${box.bottom}px,${box.right}px ${box.top}px,${box.left}px ${box.top}px)`,
  } as const;
}

const POSITIONER_SELECTOR = "[data-floating-positioner]";

/** Whether the node is inside any menu or popover positioner. */
export const inFloating = (node: Node | null) =>
  node instanceof Element && node.closest(POSITIONER_SELECTOR) !== null;

const returnTargets = new WeakMap<Element, () => HTMLElement | null>();

/** Where focus goes when the menu or popover holding the node closes: its trigger or opener. */
export function floatingReturnTarget(node: Node | null): HTMLElement | null {
  const positioner = node instanceof Element ? node.closest(POSITIONER_SELECTOR) : null;
  return positioner === null ? null : (returnTargets.get(positioner)?.() ?? null);
}

const TABBABLE =
  'button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

export const tabbables = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (element) =>
      element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest("[inert]"),
  );

let nextId = 0;

const elementId = (element: HTMLElement, prefix: string) => {
  if (element.id === "") element.id = `${prefix}-${++nextId}`;
  return element.id;
};

/**
 * What a menu or popover does around its surface, as Base UI's do: it sits on the overlay stack
 * while open, follows its anchor until it starts to exit and then holds still and inert, writes
 * the open state onto its trigger, and gives focus back once it closes.
 */
export function createPopup(options: {
  anchor: IAnchor;
  placement: () => IPlacement;
  onClose: (reason: ICloseReason) => void;
  /**
   * The element that opened it, which gets `data-popup-open`, `data-pressed`, `aria-expanded` and
   * `aria-controls`, and focus back. Without one, focus goes back to what had it on open.
   */
  trigger?: HTMLElement | null;
  /** A submenu: its trigger opens it by hover, so it isn't marked pressed. */
  nested?: boolean;
  /**
   * A context menu, as stock's `contextMenuFallback.ts`: a right-click outside it closes it and
   * suppresses the browser's menu, while the new target's own context menu still opens.
   */
  contextMenu?: boolean;
  /**
   * Places the positioner itself on open, in place of following the anchor, and says whether it
   * did; when it returns false the popup follows its anchor as usual.
   */
  position?: (positioner: HTMLElement) => boolean;
  /** Places focus on open, and again when it reopens mid-exit. */
  initialFocus: () => void;
}) {
  const presence = usePresence();
  const overlays = useOverlays();
  let positioner: HTMLElement | undefined;
  let backdrop: HTMLElement | undefined;
  let popupElement: HTMLElement | undefined;
  let stop = () => {};
  let release = () => {};
  let stopContextMenu = () => {};
  let open = false;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const trigger = options.trigger ?? null;
  const returnTo = () => trigger ?? opener;
  const startFollowing = () => {
    if (positioner === undefined || options.position?.(positioner) === true) return;
    stop = follow(positioner, options.anchor, options.placement, () => options.onClose("outside"));
  };
  const watchContextMenu = () => {
    if (options.contextMenu !== true) return;
    const onContextMenu = (event: MouseEvent) => {
      if (event.target instanceof Node && positioner?.contains(event.target)) return;
      event.preventDefault();
      options.onClose("outside");
    };
    // Armed a frame after opening, as stock's is, so the right-click that opened it can't close it.
    const frame = requestAnimationFrame(() =>
      document.addEventListener("contextmenu", onContextMenu, true),
    );
    stopContextMenu = () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("contextmenu", onContextMenu, true);
    };
  };
  const setInert = (inert: boolean) => {
    for (const element of [positioner, backdrop]) {
      if (element === undefined) continue;
      if (inert) element.setAttribute("inert", "");
      else element.removeAttribute("inert");
    }
  };
  /**
   * Moves focus back unless it already went somewhere else. A nested popup, and any popup once
   * focus has settled, only takes it back from itself: its parent's rows keep focus while the
   * pointer moves over them, and a later popup may hold it by then. `<body>` counts only once
   * settled: mid-blur it is `<body>` on its way somewhere else.
   */
  const restoreFocus = (settled = false) => {
    const active = document.activeElement;
    const target = returnTo();
    if (target === null || !target.isConnected) return;
    const held =
      options.nested === true || settled
        ? positioner?.contains(active) === true
        : inFloating(active);
    if (held || (settled && (active === null || active === document.body))) {
      target.focus({ preventScroll: true });
    }
  };
  const setTriggerOpen = () => {
    if (trigger === null) return;
    trigger.setAttribute("data-popup-open", "");
    if (options.nested !== true) trigger.setAttribute("data-pressed", "");
    trigger.setAttribute("aria-expanded", "true");
    if (popupElement !== undefined) {
      trigger.setAttribute("aria-controls", elementId(popupElement, "popup"));
    }
  };
  const show = (mounted: boolean) => {
    if (open) return;
    open = true;
    release = overlays.push({
      close: (reason) => options.onClose(reason),
      contains: (node) => positioner?.contains(node) === true || trigger?.contains(node) === true,
      backdrop: (node) => backdrop?.contains(node) === true,
    });
    if (!mounted) return;
    setInert(false);
    setTriggerOpen();
    startFollowing();
    watchContextMenu();
    options.initialFocus();
  };
  const hide = () => {
    if (!open) return;
    open = false;
    release();
    stop();
    stopContextMenu();
    setInert(true);
    trigger?.removeAttribute("data-popup-open");
    trigger?.removeAttribute("data-pressed");
    trigger?.removeAttribute("aria-controls");
    trigger?.setAttribute("aria-expanded", "false");
    restoreFocus();
    setTimeout(() => restoreFocus(true), 0);
  };
  show(false);
  // Presence keeps the same children when it reopens mid-exit, so this opens again too. It runs
  // as a computation, since an effect can miss an exit that settles within the same flush.
  createComputed(
    on(presence.exiting, (exiting) => (exiting ? hide() : show(true)), { defer: true }),
  );
  onCleanup(hide);
  onMount(() => {
    if (!open) return;
    setTriggerOpen();
    startFollowing();
    watchContextMenu();
    options.initialFocus();
  });
  return {
    exiting: presence.exiting,
    restoreFocus,
    /** The trigger's id, for a popup labelled by it. */
    triggerId: () => (trigger === null ? undefined : elementId(trigger, "trigger")),
    positioner: (element: HTMLElement) => {
      positioner = element;
      element.setAttribute("data-floating-positioner", "");
      returnTargets.set(element, returnTo);
    },
    backdrop: (element: HTMLElement) => {
      backdrop = element;
    },
    popup: (element: HTMLElement) => {
      popupElement = element;
      presence.track(element);
    },
  };
}
