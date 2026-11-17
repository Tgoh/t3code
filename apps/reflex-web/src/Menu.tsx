import { createSignal, type JSX, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";

import { type ICloseReason, useOverlay } from "./overlays";

export function MenuItem(props: {
  icon: JSX.Element;
  label: string;
  detail?: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      class="menu-item"
      classList={{ danger: props.danger === true }}
      role="menuitem"
      onClick={props.onSelect}
    >
      {props.icon}
      <span class="menu-label">{props.label}</span>
      <Show when={props.detail}>
        <span class="menu-detail">{props.detail}</span>
      </Show>
    </button>
  );
}

const MARGIN = 8;

/** Places a popup at a point, kept inside the window. */
function placeAt(popup: HTMLElement, x: number, y: number) {
  popup.style.left = `${Math.min(x, window.innerWidth - popup.offsetWidth - MARGIN)}px`;
  popup.style.top = `${Math.max(MARGIN, Math.min(y, window.innerHeight - popup.offsetHeight - MARGIN))}px`;
}

/**
 * A menu or popover on the overlay stack, which closes it on Escape when it's on top and on a
 * press outside it and its anchor.
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
      class={props.class ?? "thread-menu"}
      role={props.role ?? "menu"}
      aria-label={props.label}
      ref={setElement}
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
