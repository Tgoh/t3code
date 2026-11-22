import { createSignal, type JSX, onCleanup, onMount, Show, splitProps } from "solid-js";
import { Portal } from "solid-js/web";

import { Check } from "../icons";
import { type ICloseReason, useOverlay } from "../overlays";
import { usePresence } from "./Presence";

const ITEM =
  "flex h-7 cursor-pointer items-center gap-2 rounded-[5px] border-0 bg-transparent px-2 py-0 text-left text-[13px] hover:bg-accent aria-disabled:cursor-default aria-disabled:opacity-50 [&_svg]:size-3.5";
const PLAIN = "[&_svg:not(.brand-icon)]:text-muted-foreground";
const DANGER = "text-error-foreground [&_svg]:text-error-foreground";

export function MenuItem(
  props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "onSelect"> & {
    icon: JSX.Element;
    label: string;
    detail?: string | undefined;
    danger?: boolean;
    /** Cuts a long label to one line, for a menu as wide as its anchor. */
    truncate?: boolean;
    onSelect: () => void;
  },
) {
  const [local, rest] = splitProps(props, [
    "icon",
    "label",
    "detail",
    "danger",
    "truncate",
    "onSelect",
  ]);
  return (
    <button
      type="button"
      role="menuitem"
      {...rest}
      class={`${ITEM} ${local.danger ? DANGER : PLAIN}`}
      onClick={() => local.onSelect()}
    >
      {local.icon}
      <span class={local.truncate ? "flex-1 truncate" : "flex-1"}>{local.label}</span>
      <Show when={local.detail}>
        <span class="text-[12px] text-muted-foreground">{local.detail}</span>
      </Show>
    </button>
  );
}

/** A menu row's icon for a choice: a check when it's on, else a blank of the same size. */
export const MenuCheck = (props: { on: boolean }) => (
  <Show when={props.on} fallback={<span class="size-3.5 flex-none" />}>
    <Check />
  </Show>
);

export const MenuSeparator = () => <div class="my-1 border-t border-border" />;

export function MenuHeading(props: { children: JSX.Element }) {
  return (
    <p class="mx-0 mt-1 mb-0 flex items-center gap-2 border-t border-border px-2 pt-2 pb-1 text-[12px] font-medium text-muted-foreground [&_svg]:size-3.5">
      {props.children}
    </p>
  );
}

/**
 * A popup's entrance and exit, for a `Popup` that replaces the surface's look with its own
 * `class`. Menus use it too, where stock's have none. Follows PopoverPopup in
 * apps/web/src/components/ui/popover.tsx.
 */
export const POPOVER_MOTION =
  "transition-[scale,opacity] starting:scale-98 starting:opacity-0 data-closing:pointer-events-none data-closing:scale-98 data-closing:opacity-0";

const SURFACE = `fixed z-[120] flex max-h-[calc(100vh-16px)] min-w-52 flex-col overflow-y-auto rounded-lg border border-border bg-popover p-1 text-foreground shadow-[0_10px_25px_-5px_rgb(0_0_0/20%)] ${POPOVER_MOTION}`;

const MARGIN = 8;

/** Places a popup at a point, kept inside the window. */
function placeAt(popup: HTMLElement, x: number, y: number) {
  popup.style.left = `${Math.min(x, window.innerWidth - popup.offsetWidth - MARGIN)}px`;
  popup.style.top = `${Math.max(MARGIN, Math.min(y, window.innerHeight - popup.offsetHeight - MARGIN))}px`;
}

/**
 * A menu or popover on the overlay stack, which closes it on Escape when it's on top and on a
 * press outside it and its anchor. `class` replaces the menu surface's look.
 */
export function Popup(props: {
  label: string;
  onClose: (reason: ICloseReason) => void;
  children: JSX.Element;
  /** Opens at this point, as a context menu does. */
  x?: number;
  y?: number;
  /** Places it on mount and on every resize, for a popup that follows its anchor. */
  place?: (popup: HTMLElement) => void;
  anchor?: HTMLElement;
  class?: string;
  role?: "menu" | "dialog";
  portal?: boolean;
}) {
  const [element, setElement] = createSignal<HTMLDivElement>();
  const presence = usePresence();
  useOverlay({
    close: (reason) => props.onClose(reason),
    contains: (node) => element()?.contains(node) === true || props.anchor?.contains(node) === true,
  });
  onMount(() => {
    const popup = element();
    if (popup === undefined) return;
    if (props.x !== undefined && props.y !== undefined) placeAt(popup, props.x, props.y);
    const place = props.place;
    if (place === undefined) return;
    const replace = () => place(popup);
    replace();
    window.addEventListener("resize", replace);
    onCleanup(() => window.removeEventListener("resize", replace));
  });
  const body = () => (
    <div
      class={props.class ?? SURFACE}
      role={props.role ?? "menu"}
      aria-label={props.label}
      data-closing={presence.closing() ? "" : undefined}
      ref={(popup) => {
        setElement(popup);
        presence.track(popup);
      }}
    >
      {props.children}
    </div>
  );
  return (
    <Show when={props.portal} fallback={body()}>
      <Portal>{body()}</Portal>
    </Show>
  );
}
