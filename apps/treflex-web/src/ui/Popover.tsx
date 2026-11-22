import { createSignal, type JSX, Show, splitProps } from "solid-js";
import { Portal } from "solid-js/web";

import {
  createPopup,
  inFloating,
  type IAlign,
  type IAnchor,
  type ISide,
  tabbables,
} from "./floating";
import { overrides } from "./merge";

const POSITIONER = "h-(--positioner-height) max-h-(--available-height) max-w-(--available-width)";
const POSITIONER_VARIANT = {
  default: "w-(--positioner-width) transition-transform data-instant:transition-none z-[130]",
  panel:
    "z-(--z-sheet) w-[min(calc(var(--thread-details-panel-width)+--spacing(4)),calc(var(--anchor-width)---spacing(2)))] transition-[top] duration-150 ease-out data-instant:transition-[top] motion-reduce:transition-none motion-reduce:data-instant:transition-none",
};

// Stands in for tailwind-merge: the width, radius and shadow parts are left out where a variant,
// `tooltipStyle` or a call site's width replaces them.
const POPUP =
  "relative flex h-(--popup-height,auto) origin-(--transform-origin) text-popover-foreground outline-none transition-[width,height,scale,opacity] before:pointer-events-none before:absolute before:inset-0 before:shadow-[0_1px_--theme(--color-black/4%)] has-data-[slot=calendar]:rounded-xl has-data-[slot=calendar]:before:rounded-[calc(var(--radius-xl)-1px)] data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)] will-change-[scale] [-webkit-app-region:no-drag]";
const POPUP_WIDTH = {
  auto: "",
  sm: "max-w-[calc(100vw-2rem)] w-64",
  md: "max-w-[calc(100vw-2rem)] w-80",
  lg: "max-w-[calc(100vw-2rem)] w-96",
};
const SHADOW =
  "shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]";
const TOOLTIP_STYLE = "rounded-md text-xs shadow-md/5 before:rounded-[calc(var(--radius-md)-1px)]";
const PANEL =
  "w-full overflow-visible rounded-none border-0 bg-transparent shadow-none before:hidden [backdrop-filter:none] [-webkit-backdrop-filter:none]";

const VIEWPORT =
  "relative size-full max-h-(--available-height) px-(--viewport-inline-padding) has-data-[slot=calendar]:p-2 data-instant:transition-none **:data-current:data-ending-style:opacity-0 **:data-current:data-starting-style:opacity-0 **:data-previous:data-ending-style:opacity-0 **:data-previous:data-starting-style:opacity-0 **:data-current:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-current:opacity-100 **:data-previous:opacity-100 **:data-current:transition-opacity **:data-previous:transition-opacity";
const VIEWPORT_PADDING = {
  default: "py-4 [--viewport-inline-padding:--spacing(4)]",
  compact: "py-2 [--viewport-inline-padding:--spacing(3)]",
  none: "rounded-[calc(var(--radius-lg)-1px)] py-0 [--viewport-inline-padding:0px]",
};
const TOOLTIP_PADDING = "py-1 [--viewport-inline-padding:--spacing(2)]";

type IPadding = keyof typeof VIEWPORT_PADDING;
type IWidth = keyof typeof POPUP_WIDTH;

function popoverClasses(options: {
  padding: IPadding;
  variant: "default" | "panel";
  width: IWidth;
  tooltipStyle: boolean;
  class: string | undefined;
}) {
  const panel = options.variant === "panel";
  const tooltip = options.tooltipStyle;
  const sized = options.width !== "auto" || panel || overrides(options.class, "width");
  const popup = [
    POPUP,
    sized ? "" : tooltip ? "w-fit" : "w-(--popup-width,auto)",
    tooltip || panel ? "" : "rounded-lg before:rounded-[calc(var(--radius-lg)-1px)]",
    panel ? "before:rounded-[calc(var(--radius-lg)-1px)]" : "dropdown-glass",
    tooltip ? TOOLTIP_STYLE : panel ? "" : SHADOW,
    POPUP_WIDTH[options.width],
    panel ? PANEL : "",
    options.class ?? "",
  ];
  const viewport = [
    VIEWPORT,
    panel ? "" : "overflow-clip",
    panel
      ? `${options.padding === "none" ? "rounded-[calc(var(--radius-lg)-1px)] " : ""}overflow-visible py-2 [--viewport-inline-padding:--spacing(2)]`
      : tooltip && options.padding === "default"
        ? TOOLTIP_PADDING
        : VIEWPORT_PADDING[options.padding],
    tooltip ? "" : "not-data-transitioning:overflow-y-auto",
  ];
  const join = (parts: string[]) => parts.filter(Boolean).join(" ");
  return {
    positioner: `${POSITIONER} ${POSITIONER_VARIANT[options.variant]}`,
    popup: join(popup),
    viewport: join(viewport),
  };
}

/**
 * A popover, placed against `anchor` and kept there while open. As Base UI's non-modal popover,
 * it takes focus on open (the first tabbable element, or the popup on a touch screen, unless
 * `initialFocus` picks one), gives it back to the trigger on close, and closes on Escape, a press
 * outside, or focus leaving it. Render it in a `Presence` so it plays its exit.
 */
export function PopoverPopup(
  props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "children" | "role"> & {
    anchor: IAnchor;
    /** The element that opened it, when that isn't an element `anchor`. */
    trigger?: HTMLElement;
    label?: string;
    onClose: () => void;
    padding?: IPadding;
    variant?: "default" | "panel";
    width?: IWidth;
    side?: ISide;
    align?: IAlign;
    sideOffset?: number;
    alignOffset?: number;
    collisionAvoidance?: { side?: "flip" | "shift" | "none"; align?: "flip" | "shift" | "none" };
    tooltipStyle?: boolean;
    touchBackdrop?: boolean;
    /** What takes focus on open; null leaves it on the popup. */
    initialFocus?: (popup: HTMLElement) => HTMLElement | null;
    role?: "dialog" | "menu";
    /** Layout only, or a width. */
    class?: string;
    children: JSX.Element;
  },
) {
  const [local, rest] = splitProps(props, [
    "anchor",
    "trigger",
    "label",
    "onClose",
    "padding",
    "variant",
    "width",
    "side",
    "align",
    "sideOffset",
    "alignOffset",
    "collisionAvoidance",
    "tooltipStyle",
    "touchBackdrop",
    "initialFocus",
    "role",
    "class",
    "children",
  ]);
  const variant = () => local.variant ?? "default";
  const [popupElement, setPopupElement] = createSignal<HTMLDivElement>();
  const trigger = local.trigger ?? (local.anchor instanceof HTMLElement ? local.anchor : null);
  const popup = createPopup({
    anchor: local.anchor,
    placement: () => ({
      side: local.side ?? "bottom",
      align: local.align ?? "center",
      sideOffset: local.sideOffset ?? 4,
      alignOffset: local.alignOffset ?? 0,
      collisionPadding: variant() === "panel" ? 0 : undefined,
      collisionAvoidance: local.collisionAvoidance,
    }),
    onClose: () => local.onClose(),
    trigger,
    initialFocus: () => {
      const element = popupElement();
      if (element === undefined) return;
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      const target =
        local.initialFocus === undefined
          ? coarse
            ? null
            : (tabbables(element)[0] ?? null)
          : local.initialFocus(element);
      (target ?? element).focus({ preventScroll: true });
    },
  });
  // Base UI's focus guards: tabbing out of either end leaves the popover beside its trigger.
  const onKeyDown = (event: KeyboardEvent) => {
    const element = popupElement();
    if (event.key !== "Tab" || event.defaultPrevented) return;
    if (element === undefined || trigger === null) return;
    const inside = tabbables(element);
    const active = document.activeElement;
    if (event.shiftKey) {
      if (inside.length > 0 && active !== inside[0] && active !== element) return;
      event.preventDefault();
      trigger.focus({ preventScroll: true });
      local.onClose();
      return;
    }
    if (inside.length > 0 && active !== inside.at(-1)) return;
    event.preventDefault();
    const next = tabbables(document.body).find(
      (candidate) =>
        !inFloating(candidate) &&
        !trigger.contains(candidate) &&
        (trigger.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    );
    local.onClose();
    (next ?? trigger).focus({ preventScroll: true });
  };
  const classes = () =>
    popoverClasses({
      padding: local.padding ?? "default",
      variant: variant(),
      width: local.width ?? "auto",
      tooltipStyle: local.tooltipStyle === true,
      class: local.class,
    });
  return (
    <Portal>
      <Show when={local.touchBackdrop}>
        <div
          ref={(held) => popup.backdrop(held)}
          class="fixed inset-0 z-[130] hidden pointer-coarse:block"
          data-slot="popover-backdrop"
        />
      </Show>
      <div
        ref={(held) => popup.positioner(held)}
        class={classes().positioner}
        style={{ position: "fixed", left: "0px", top: "0px" }}
        data-slot="popover-positioner"
      >
        <div
          {...rest}
          ref={(held) => {
            setPopupElement(held);
            popup.popup(held);
          }}
          class={classes().popup}
          role={local.role ?? "dialog"}
          tabIndex={-1}
          aria-label={local.label}
          data-slot="popover-popup"
          onKeyDown={onKeyDown}
          onFocusOut={(event) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node) || popup.exiting()) return;
            if (event.currentTarget.contains(next) || trigger?.contains(next)) return;
            if (inFloating(next)) return;
            local.onClose();
          }}
        >
          <div class={classes().viewport} data-slot="popover-viewport">
            {local.children}
          </div>
        </div>
      </div>
    </Portal>
  );
}
