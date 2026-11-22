// @effect-diagnostics globalTimers:off -- View-only hover delays, outside any Effect runtime.
import {
  type Accessor,
  createContext,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  splitProps,
  useContext,
} from "solid-js";
import { Portal } from "solid-js/web";

import { ChevronRight, Search } from "../icons";
import { stepHighlight } from "../listNavigation";
import type { ICloseReason } from "../overlays";
import { createPopup, type IAlign, type IAnchor, type IPlacement, type ISide } from "./floating";
import { Input, type InputProps } from "./Input";
import { Presence } from "./Presence";

const POPUP =
  "dropdown-glass relative flex origin-(--transform-origin) rounded-lg shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] outline-none focus:outline-none dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)] [-webkit-app-region:no-drag] max-w-[calc(100vw-2rem)]";
const POPUP_WIDTH = {
  default: "min-w-[min(10rem,calc(100vw-2rem))]",
  content: "w-max min-w-0",
};

// Stands in for tailwind-merge: each part leaves out the base classes its variant replaces.
const ITEM =
  "flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1 text-base text-foreground outline-none data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-highlighted:bg-accent data-inset:ps-8 data-[variant=destructive]:text-destructive-foreground data-highlighted:text-accent-foreground data-disabled:opacity-64 sm:text-sm";
const ITEM_SVG =
  "[&>svg]:-mx-0.5 [&>svg:not([class*='opacity-'])]:opacity-80 [&>svg:not([class*='size-'])]:size-4.5 sm:[&>svg:not([class*='size-'])]:size-4 [&>svg:not([class*='text-'])]:text-muted-foreground data-[variant=destructive]:[&>svg:not([class*='text-'])]:text-current [&>svg]:pointer-events-none [&>svg]:shrink-0";
const GHOST_ITEM =
  "[&>svg]:-mx-0.5 select-none py-1 data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-highlighted:bg-accent data-inset:ps-8 data-[variant=destructive]:text-destructive-foreground data-highlighted:text-accent-foreground data-disabled:opacity-64 [&>svg:not([class*='opacity-'])]:opacity-80 [&>svg:not([class*='size-'])]:size-4.5 sm:[&>svg:not([class*='size-'])]:size-4 [&>svg:not([class*='text-'])]:text-muted-foreground data-[variant=destructive]:[&>svg:not([class*='text-'])]:text-current [&>svg]:pointer-events-none [&>svg]:shrink-0 [&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap border font-medium outline-none transition-[box-shadow,scale] [&:not([aria-haspopup]):not(:disabled):not([aria-disabled=true])]:will-change-[scale] [&:active:not([aria-haspopup])]:scale-[0.97] before:pointer-events-none before:absolute before:inset-0 pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 aria-disabled:cursor-not-allowed aria-disabled:opacity-64 [&_svg:not([class*='text-'])]:text-[var(--control-icon-color)] sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 gap-1 rounded-md px-[calc(--spacing(2)-1px)] text-xs before:rounded-[calc(var(--radius-md)-1px)] [&_svg:not([class*='size-'])]:size-3.5 [--control-icon-color:var(--contrast-muted-foreground)] border-transparent text-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent h-auto w-full sm:text-xs";
const ITEM_HEIGHT = {
  default: "min-h-8 sm:min-h-7",
  ghost: "min-h-7 sm:min-h-7",
  touch: "min-h-10 sm:min-h-10",
};
const LABEL =
  "min-w-0 truncate in-data-[density=touch]:[text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both_cap_alphabetic]:in-data-[density=touch]:py-[0.5em]";

const CHECKBOX_ITEM =
  "grid min-h-8 in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] cursor-pointer items-center rounded-sm py-1 ps-2 text-base text-foreground outline-none data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0";
const CHECKBOX_VARIANT = {
  default: "gap-2 grid-cols-[1rem_minmax(0,1fr)] pe-4",
  icon: "gap-2 pe-4 grid-cols-[0.625rem_minmax(0,1fr)]",
  switch: "gap-4 grid-cols-[1fr_auto] pe-1.5",
};
const SWITCH_TRACK =
  "inset-shadow-[0_1px_--theme(--color-black/4%)] inline-flex h-[calc(var(--thumb-size)+2px)] w-[calc(var(--thumb-size)*2-2px)] shrink-0 items-center rounded-full p-px outline-none transition-[background-color,box-shadow] duration-200 [--thumb-size:--spacing(4)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:bg-primary data-unchecked:bg-input data-disabled:opacity-64 sm:[--thumb-size:--spacing(3)]";
const SWITCH_THUMB =
  "pointer-events-none block aspect-square h-full in-[[data-slot=menu-checkbox-item][data-checked]]:origin-[var(--thumb-size)_50%] origin-left in-[[data-slot=menu-checkbox-item][data-checked]]:translate-x-[calc(var(--thumb-size)-4px)] in-[[data-slot=menu-checkbox-item]:active]:not-data-disabled:scale-x-110 in-[[data-slot=menu-checkbox-item]:active]:rounded-[var(--thumb-size)/calc(var(--thumb-size)*1.10)] rounded-(--thumb-size) bg-background shadow-sm/5 [transition:translate_.15s,border-radius_.15s,scale_.1s_.1s,transform-origin_.15s]";

const RADIO_ITEM =
  "[&_svg]:-mx-0.5 flex min-h-8 in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] cursor-pointer items-center rounded-sm px-2 py-1 text-base text-foreground outline-none data-checked:bg-foreground/[0.08] data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0";

const SUB_TRIGGER =
  "[&>svg:not(:last-child)]:-mx-0.5 flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-base text-foreground outline-none data-disabled:cursor-not-allowed data-disabled:pointer-events-none data-highlighted:bg-accent data-popup-open:bg-accent data-inset:ps-8 data-highlighted:text-accent-foreground data-popup-open:text-accent-foreground data-disabled:opacity-64 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground [&>svg:not(:last-child):not([class*='opacity-'])]:opacity-80 [&_svg]:pointer-events-none [&>svg]:shrink-0";

const ITEM_SELECTOR = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]';
const TYPEAHEAD_RESET_MS = 500;
const SUBMENU_DELAY_MS = 100;

type IDensity = "default" | "touch";
type IHighlight = "first" | "last";

interface IOpenSub {
  trigger: HTMLElement;
  close: () => void;
  /** Moves focus to its first item. */
  enter: () => void;
  contains: (node: Node) => boolean;
}

let pendingHighlight: IHighlight | null = null;

/**
 * Base UI's trigger keys: ArrowDown opens the menu on its first item and ArrowUp on its last.
 * Put it on a closed menu trigger's `onKeyDown`, with what opens the menu.
 */
export function openMenuFromKeys(event: KeyboardEvent, open: () => void): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const trigger = event.currentTarget;
  if (!(trigger instanceof HTMLElement) || trigger.getAttribute("aria-expanded") === "true") return;
  event.preventDefault();
  pendingHighlight = event.key === "ArrowDown" ? "first" : "last";
  open();
  queueMicrotask(() => (pendingHighlight = null));
}

interface IMenuLevel {
  /** Closes the whole menu, submenus included. */
  close: () => void;
  exiting: Accessor<boolean>;
  openSub: (sub: IOpenSub) => void;
  releaseSub: (sub: IOpenSub) => void;
  /** Moves focus into the open submenu, for ArrowRight on its trigger. */
  enterSub: () => void;
  /** Keeps a submenu open while the pointer travels from its trigger into it. */
  holdSub: () => void;
}

const MenuContext = createContext<IMenuLevel>();

const useMenu = () => {
  const level = useContext(MenuContext);
  if (level === undefined) throw new Error("A menu part is outside a MenuPopup.");
  return level;
};

type IOpenedBy = "keyboard" | "pointer";

interface ISub {
  open: Accessor<IOpenedBy | null>;
  setOpen: (by: IOpenedBy | null) => void;
  trigger: Accessor<HTMLElement | undefined>;
  setTrigger: (element: HTMLElement) => void;
  parent: IMenuLevel;
}

const SubContext = createContext<ISub>();

const flag = (on: boolean | undefined) => (on === true ? "" : undefined);

const labelOf = (item: HTMLElement) =>
  (item.dataset.label ?? item.textContent ?? "").trim().toLowerCase();

/** Base UI's submenu delay, cancelled when the owner unmounts. */
function delayed() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => clearTimeout(timer);
  onCleanup(cancel);
  return {
    start: (run: () => void) => {
      cancel();
      timer = setTimeout(run, SUBMENU_DELAY_MS);
    },
    cancel,
  };
}

interface ISurface {
  anchor: IAnchor;
  trigger?: HTMLElement | null;
  placement: IPlacement;
  label?: string | undefined;
  width: "default" | "content";
  class?: string | undefined;
  slot: "menu-popup" | "menu-sub-content";
  onClose: (reason: ICloseReason) => void;
  /** Set for a submenu: what it hangs from. */
  sub?: ISub;
  highlight: IHighlight | null;
  rest: JSX.HTMLAttributes<HTMLDivElement>;
}

/** A menu at a point with no trigger: stock's non-modal context menu, not a modal Base UI one. */
const isContextMenu = (props: ISurface) =>
  props.sub === undefined && !(props.anchor instanceof Element) && props.trigger == null;

function menuNavigation(props: ISurface) {
  const sub = props.sub;
  let element: HTMLDivElement | undefined;
  const popup = createPopup({
    anchor: props.anchor,
    placement: () => props.placement,
    onClose: props.onClose,
    trigger: props.trigger ?? null,
    nested: sub !== undefined,
    contextMenu: isContextMenu(props),
    initialFocus: () => {
      const field = element?.querySelector<HTMLElement>("[autofocus]");
      if (field != null) field.focus({ preventScroll: true });
      else if (props.highlight === "first") focusItem(enabledItems()[0]);
      else if (props.highlight === "last") focusItem(enabledItems().at(-1));
      else if (sub === undefined) element?.focus({ preventScroll: true });
    },
  });
  let highlighted: HTMLElement | null = null;
  let openSub: IOpenSub | null = null;
  const subClosing = delayed();
  let typed = "";
  let typedAt = -Infinity;

  const level: IMenuLevel = {
    close: sub === undefined ? () => props.onClose("outside") : sub.parent.close,
    exiting: sub === undefined ? popup.exiting : () => sub.parent.exiting() || popup.exiting(),
    openSub: (next) => {
      subClosing.cancel();
      openSub = next;
    },
    releaseSub: (held) => {
      if (openSub === held) openSub = null;
    },
    enterSub: () => openSub?.enter(),
    holdSub: subClosing.cancel,
  };

  // Keys land on disabled items too, as Base UI's do; only the first highlight on open skips them.
  const items = () =>
    element === undefined ? [] : [...element.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
  const enabledItems = () => items().filter((item) => !item.hasAttribute("data-disabled"));
  const setHighlight = (item: HTMLElement | null) => {
    if (highlighted === item) return;
    highlighted?.removeAttribute("data-highlighted");
    highlighted = item;
    item?.setAttribute("data-highlighted", "");
  };
  const focusItem = (item: HTMLElement | undefined, scroll = true) => {
    if (item === undefined) return;
    item.focus({ preventScroll: true });
    if (scroll) item.scrollIntoView({ block: "nearest" });
  };
  const closeOpenSub = (except?: HTMLElement) => {
    if (openSub === null || openSub.trigger === except) return;
    openSub.close();
  };
  if (sub !== undefined && props.anchor instanceof HTMLElement) {
    const entry: IOpenSub = {
      trigger: props.anchor,
      close: () => sub.setOpen(null),
      enter: () => {
        if (!popup.exiting()) focusItem(enabledItems()[0]);
      },
      contains: (node) => element?.contains(node) === true,
    };
    sub.parent.openSub(entry);
    onCleanup(() => sub.parent.releaseSub(entry));
  }
  const clearHighlight = () => {
    if (highlighted === null || highlighted.hasAttribute("data-popup-open")) return;
    if (element?.contains(document.activeElement)) element.focus({ preventScroll: true });
  };

  const onKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const list = items();
    const index = highlighted === null ? -1 : list.indexOf(highlighted);
    const move = (target: HTMLElement | undefined) => {
      event.preventDefault();
      event.stopPropagation();
      if (target !== undefined && target !== openSub?.trigger) closeOpenSub();
      focusItem(target);
    };
    const typing = event.timeStamp - typedAt < TYPEAHEAD_RESET_MS && typed !== "";
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        const next = stepHighlight(
          index < 0 ? null : index,
          list.length,
          event.key === "ArrowDown" ? 1 : -1,
        );
        return move(next === null ? undefined : list[next]);
      }
      case "Home":
        return move(list[0]);
      case "End":
        return move(list.at(-1));
      case "ArrowLeft":
        if (sub === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        sub.setOpen(null);
        sub.trigger()?.focus({ preventScroll: true });
        return;
      case "Tab":
        // Focus goes back to the trigger first: Tab then moves on from it, Shift+Tab stays on it.
        popup.restoreFocus();
        if (event.shiftKey) event.preventDefault();
        level.close();
        return;
      case "Enter":
      case " ":
        if (event.key === " " && typing) break;
        if (highlighted === null || event.target instanceof HTMLInputElement) return;
        event.preventDefault();
        highlighted.click();
        return;
    }
    if (event.key.length !== 1) return;
    if (!typing) typed = "";
    typedAt = event.timeStamp;
    typed += event.key.toLowerCase();
    const start = typed.length === 1 ? index + 1 : Math.max(index, 0);
    const match = [...list.slice(start), ...list.slice(0, start)].find((item) =>
      labelOf(item).startsWith(typed),
    );
    event.preventDefault();
    event.stopPropagation();
    if (match !== undefined) move(match);
  };

  const onPointerMove: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    sub?.parent.holdSub();
    const item = (event.target as Element).closest<HTMLElement>(ITEM_SELECTOR);
    if (item === null || !element?.contains(item) || item.hasAttribute("data-disabled")) {
      clearHighlight();
      return;
    }
    if (item === highlighted) return;
    focusItem(item, false);
    if (openSub !== null && openSub.trigger !== item) {
      subClosing.start(() => closeOpenSub(item));
    }
  };

  const onPointerLeave = (event: PointerEvent) => {
    clearHighlight();
    const next = event.relatedTarget;
    if (openSub === null || (next instanceof Node && openSub.contains(next))) return;
    subClosing.start(() => closeOpenSub());
  };

  const onFocusIn: JSX.EventHandler<HTMLDivElement, FocusEvent> = (event) => {
    const item = (event.target as Element).closest<HTMLElement>(ITEM_SELECTOR);
    setHighlight(item !== null && element?.contains(item) === true ? item : null);
  };

  const onFocusOut: JSX.EventHandler<HTMLDivElement, FocusEvent> = (event) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !element?.contains(next)) setHighlight(null);
  };

  return {
    level,
    labelledBy: () => (props.label === undefined ? popup.triggerId() : undefined),
    positioner: popup.positioner,
    backdrop: popup.backdrop,
    popup: (held: HTMLDivElement) => {
      element = held;
      popup.popup(held);
    },
    onKeyDown,
    onPointerMove,
    onPointerLeave,
    onFocusIn,
    onFocusOut,
  };
}

function cutout(trigger: HTMLElement | null | undefined): string | undefined {
  if (trigger == null) return undefined;
  const box = trigger.getBoundingClientRect();
  return `polygon(0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,${box.left}px ${box.top}px,${box.left}px ${box.bottom}px,${box.right}px ${box.bottom}px,${box.right}px ${box.top}px,${box.left}px ${box.top}px)`;
}

function MenuSurface(props: ISurface & { children: JSX.Element }) {
  const navigation = menuNavigation(props);
  return (
    <MenuContext.Provider value={navigation.level}>
      <Portal>
        <Show when={props.sub === undefined && !isContextMenu(props)}>
          <div
            ref={(held) => navigation.backdrop(held)}
            role="presentation"
            data-base-ui-inert=""
            style={{
              position: "fixed",
              inset: "0px",
              "user-select": "none",
              "-webkit-user-select": "none",
              "clip-path": cutout(props.trigger),
            }}
          />
        </Show>
        <div
          ref={(held) => navigation.positioner(held)}
          class="z-[130]"
          style={{ position: "fixed", left: "0px", top: "0px" }}
          data-slot="menu-positioner"
        >
          <div
            {...props.rest}
            ref={(held) => navigation.popup(held)}
            class={`${POPUP} ${POPUP_WIDTH[props.width]} ${props.class ?? ""}`}
            role="menu"
            tabIndex={-1}
            aria-label={props.label}
            aria-labelledby={navigation.labelledBy()}
            data-slot={props.slot}
            onKeyDown={navigation.onKeyDown}
            onPointerMove={navigation.onPointerMove}
            onPointerLeave={navigation.onPointerLeave}
            onFocusIn={navigation.onFocusIn}
            onFocusOut={navigation.onFocusOut}
          >
            <div class="max-h-(--available-height) w-full overflow-y-auto p-1">
              {props.children}
            </div>
          </div>
        </div>
      </Portal>
    </MenuContext.Provider>
  );
}

type IPopupProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "children"> & {
  /** What it's placed against: its trigger, another element, or a point for a context menu. */
  anchor: IAnchor;
  /** The element that opened it, when that isn't an element `anchor`. */
  trigger?: HTMLElement;
  label?: string;
  onClose: () => void;
  side?: ISide;
  align?: IAlign;
  sideOffset?: number;
  alignOffset?: number;
  width?: "default" | "content";
  /** Layout only. */
  class?: string;
  children: JSX.Element;
};

/**
 * A menu: Base UI's keyboard and pointer handling, placed against `anchor` and kept there while
 * open. Closing from inside it (an item, Escape, Tab, a press outside) calls `onClose`; render
 * it in a `Presence` so it plays its exit.
 */
export function MenuPopup(props: IPopupProps) {
  const [local, rest] = splitProps(props, [
    "anchor",
    "trigger",
    "label",
    "onClose",
    "side",
    "align",
    "sideOffset",
    "alignOffset",
    "width",
    "class",
    "children",
  ]);
  const anchor = local.anchor;
  const trigger = local.trigger ?? (anchor instanceof HTMLElement ? anchor : null);
  return (
    <MenuSurface
      anchor={anchor}
      trigger={trigger}
      placement={{
        side: local.side ?? "bottom",
        align: local.align ?? "center",
        sideOffset: local.sideOffset ?? 4,
        alignOffset: local.alignOffset ?? 0,
      }}
      label={local.label}
      width={local.width ?? "default"}
      class={local.class}
      slot="menu-popup"
      onClose={() => local.onClose()}
      highlight={pendingHighlight ?? (trigger?.matches(":focus-visible") === true ? "first" : null)}
      rest={rest}
    >
      {local.children}
    </MenuSurface>
  );
}

export function MenuGroup(props: { children: JSX.Element }) {
  return (
    <div role="group" data-slot="menu-group">
      {props.children}
    </div>
  );
}

export function MenuGroupLabel(props: { inset?: boolean; children: JSX.Element }) {
  return (
    <div
      class="px-2 py-1.5 font-medium text-muted-foreground text-xs data-inset:ps-9 sm:data-inset:ps-8"
      data-inset={flag(props.inset)}
      data-slot="menu-label"
    >
      {props.children}
    </div>
  );
}

type IItemProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, "onClick" | "class"> & {
  disabled?: boolean;
  /** The text typeahead matches, when it isn't the row's text. */
  label?: string;
  onClick?: (event: MouseEvent) => void;
  closeOnClick?: boolean;
};

function useActivate(props: IItemProps, closeByDefault: boolean, change?: () => void) {
  const level = useMenu();
  return (event: MouseEvent) => {
    if (props.disabled === true) return;
    change?.();
    props.onClick?.(event);
    if (props.closeOnClick ?? closeByDefault) level.close();
  };
}

const disabledFlag = (props: IItemProps) => (props.disabled === true ? "true" : undefined);

const ITEM_KEYS = ["disabled", "label", "onClick", "closeOnClick", "children"] as const;

export function MenuItem(
  props: IItemProps & {
    variant?: "default" | "destructive" | "ghost";
    density?: IDensity;
    inset?: boolean;
    children: JSX.Element;
  },
) {
  const [local, item, rest] = splitProps(props, ["variant", "density", "inset"], ITEM_KEYS);
  const activate = useActivate(item, true);
  const variant = () => local.variant ?? "default";
  const density = () => local.density ?? "default";
  const height = () =>
    density() === "touch"
      ? ITEM_HEIGHT.touch
      : variant() === "ghost"
        ? ITEM_HEIGHT.ghost
        : ITEM_HEIGHT.default;
  return (
    <div
      {...rest}
      tabIndex={-1}
      aria-disabled={disabledFlag(item)}
      data-disabled={flag(item.disabled)}
      data-label={item.label}
      onClick={activate}
      role="menuitem"
      class={`${variant() === "ghost" ? GHOST_ITEM : `${ITEM} ${ITEM_SVG}`} ${height()}`}
      data-density={density()}
      data-inset={flag(local.inset)}
      data-slot="menu-item"
      data-variant={variant()}
    >
      {item.children}
    </div>
  );
}

export function MenuItemLabel(props: { children: JSX.Element }) {
  return (
    <span data-slot="menu-item-label" class={LABEL}>
      {props.children}
    </span>
  );
}

/** A trailing value on a row, such as the time a snooze preset wakes at. */
export function MenuItemDetail(props: { children: JSX.Element }) {
  return (
    <span
      class="ms-auto shrink-0 ps-4 text-secondary-label tabular-nums"
      data-slot="menu-item-detail"
    >
      {props.children}
    </span>
  );
}

/** A row's key chord. */
export function MenuShortcut(props: { children: JSX.Element }) {
  return (
    <kbd
      class="ms-auto font-medium font-sans text-secondary-label text-xs tracking-widest"
      data-slot="menu-shortcut"
    >
      {props.children}
    </kbd>
  );
}

const CHECK_PATH = "M5.252 12.7 10.2 18.63 18.748 5.37";

export function MenuCheckboxItem(
  props: IItemProps & {
    checked: boolean;
    onCheckedChange?: (checked: boolean) => void;
    variant?: "default" | "icon" | "switch";
    children: JSX.Element;
  },
) {
  const [local, item, rest] = splitProps(
    props,
    ["checked", "onCheckedChange", "variant"],
    ITEM_KEYS,
  );
  const activate = useActivate(item, false, () => local.onCheckedChange?.(!local.checked));
  const variant = () => local.variant ?? "default";
  return (
    <div
      {...rest}
      tabIndex={-1}
      aria-disabled={disabledFlag(item)}
      data-disabled={flag(item.disabled)}
      data-label={item.label}
      data-checked={flag(local.checked)}
      data-unchecked={flag(!local.checked)}
      onClick={activate}
      role="menuitemcheckbox"
      aria-checked={local.checked}
      class={`${CHECKBOX_ITEM} ${CHECKBOX_VARIANT[variant()]}`}
      data-slot="menu-checkbox-item"
    >
      <Show
        when={variant() === "switch"}
        fallback={
          <>
            <Show when={local.checked}>
              <span
                class={variant() === "icon" ? "col-start-1 -mx-0.5" : "col-start-1"}
                data-checked=""
              >
                <svg
                  class={variant() === "icon" ? "size-3.5" : undefined}
                  fill="none"
                  height="24"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.75"
                  viewBox="0 0 24 24"
                  width="24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d={CHECK_PATH} />
                </svg>
              </span>
            </Show>
            <span class="col-start-2">{item.children}</span>
          </>
        }
      >
        <span class="col-start-1">{item.children}</span>
        <span
          class={SWITCH_TRACK}
          data-checked={flag(local.checked)}
          data-unchecked={flag(!local.checked)}
          data-disabled={flag(item.disabled)}
        >
          <span class={SWITCH_THUMB} />
        </span>
      </Show>
    </div>
  );
}

interface IRadioGroup {
  value: Accessor<string>;
  onValueChange: (value: string) => void;
}

const RadioContext = createContext<IRadioGroup>();

export function MenuRadioGroup(props: {
  value: string;
  onValueChange: (value: string) => void;
  class?: string;
  "aria-label"?: string;
  onKeyDown?: JSX.EventHandler<HTMLDivElement, KeyboardEvent>;
  children: JSX.Element;
}) {
  return (
    <RadioContext.Provider
      value={{ value: () => props.value, onValueChange: (value) => props.onValueChange(value) }}
    >
      <div
        role="group"
        class={props.class}
        aria-label={props["aria-label"]}
        data-slot="menu-radio-group"
        onKeyDown={props.onKeyDown}
      >
        {props.children}
      </div>
    </RadioContext.Provider>
  );
}

/**
 * A choice in a `MenuRadioGroup`. `class` replaces the row's look, for a group drawn as one
 * segmented control, as stock's permissions toggle does with Base UI's own radio item.
 */
export function MenuRadioItem(
  props: Omit<IItemProps, "class"> & {
    value: string;
    class?: string;
    children: JSX.Element;
  },
) {
  const group = useContext(RadioContext);
  const [local, item, rest] = splitProps(props, ["value", "class"], ITEM_KEYS);
  const checked = () => group?.value() === local.value;
  const activate = useActivate(item, false, () => {
    if (!checked()) group?.onValueChange(local.value);
  });
  return (
    <div
      {...rest}
      tabIndex={-1}
      aria-disabled={disabledFlag(item)}
      data-disabled={flag(item.disabled)}
      data-label={item.label}
      onClick={activate}
      role="menuitemradio"
      aria-checked={checked()}
      class={local.class ?? RADIO_ITEM}
      data-checked={flag(checked())}
      data-unchecked={flag(!checked())}
      data-slot="menu-radio-item"
    >
      <Show when={local.class === undefined} fallback={item.children}>
        <span class="min-w-0 flex-1">{item.children}</span>
      </Show>
    </div>
  );
}

export function MenuSeparator() {
  return (
    <div
      class="mx-2 my-1 h-px bg-border"
      role="separator"
      aria-orientation="horizontal"
      data-orientation="horizontal"
      data-slot="menu-separator"
    />
  );
}

/** Holds a submenu's open state for its `MenuSubTrigger` and `MenuSubPopup`. */
export function MenuSub(props: { children: JSX.Element }) {
  const parent = useMenu();
  const [open, setOpen] = createSignal<IOpenedBy | null>(null);
  const [trigger, setTrigger] = createSignal<HTMLElement>();
  return (
    <SubContext.Provider value={{ open, setOpen, trigger, setTrigger, parent }}>
      {props.children}
    </SubContext.Provider>
  );
}

const useSub = () => {
  const sub = useContext(SubContext);
  if (sub === undefined) throw new Error("A submenu part is outside a MenuSub.");
  return sub;
};

export function MenuSubTrigger(props: {
  density?: IDensity;
  inset?: boolean;
  disabled?: boolean;
  label?: string;
  children: JSX.Element;
}) {
  const sub = useSub();
  const hover = delayed();
  const open = (by: IOpenedBy) => {
    hover.cancel();
    if (props.disabled === true) return;
    if (sub.open() === null) sub.setOpen(by);
    else if (by === "keyboard") sub.parent.enterSub();
  };
  return (
    <div
      ref={(held) => sub.setTrigger(held)}
      role="menuitem"
      tabIndex={-1}
      aria-haspopup="menu"
      aria-expanded={sub.open() !== null}
      aria-disabled={props.disabled === true ? "true" : undefined}
      class={`${SUB_TRIGGER} ${props.density === "touch" ? ITEM_HEIGHT.touch : ITEM_HEIGHT.default}`}
      data-density={props.density ?? "default"}
      data-disabled={flag(props.disabled)}
      data-inset={flag(props.inset)}
      data-label={props.label}
      data-popup-open={flag(sub.open() !== null)}
      data-slot="menu-sub-trigger"
      onClick={(event) => {
        if (event.detail === 0) return open("keyboard");
        // A mouse opens it by hovering, as Base UI's ignores mouse presses on a submenu trigger.
        if ((event as MouseEvent & { pointerType?: string }).pointerType === "mouse") return;
        open("pointer");
      }}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch" && sub.open() === null) {
          hover.start(() => open("pointer"));
        }
      }}
      onPointerLeave={() => hover.cancel()}
      onKeyDown={(event) => {
        if (event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        open("keyboard");
      }}
    >
      {props.children}
      <ChevronRight class="-me-0.5 ms-auto opacity-80" />
    </div>
  );
}

export function MenuSubPopup(props: {
  align?: IAlign;
  sideOffset?: number;
  alignOffset?: number;
  children: JSX.Element;
}) {
  const sub = useSub();
  const align = () => props.align ?? "start";
  return (
    <Presence when={sub.open() !== null && !sub.parent.exiting() && sub.trigger()}>
      {(trigger) => {
        const close = () => sub.setOpen(null);
        return (
          <MenuSurface
            anchor={trigger()}
            trigger={trigger()}
            placement={{
              side: "inline-end",
              align: align(),
              sideOffset: props.sideOffset ?? 0,
              alignOffset: props.alignOffset ?? (align() !== "center" ? -5 : 0),
            }}
            width="default"
            slot="menu-sub-content"
            sub={sub}
            highlight={sub.open() === "keyboard" ? "first" : null}
            onClose={(reason) => {
              close();
              if (reason === "escape") trigger().focus({ preventScroll: true });
            }}
            rest={{}}
          >
            {props.children}
          </MenuSurface>
        );
      }}
    </Presence>
  );
}

/** A menu's filter field, drawn like stock's `ComboboxSearchInput`. */
export function MenuSearchInput(props: Omit<InputProps, "class" | "size" | "unstyled">) {
  const [local, rest] = splitProps(props, ["onKeyDown"]);
  return (
    <label class="block min-w-0 shrink-0 cursor-text px-2 pt-1.5 pb-1">
      <div class="relative -translate-y-px border-b border-border/70 pb-1.5 transition-colors focus-within:border-ring">
        <Search
          aria-hidden="true"
          class="pointer-events-none absolute top-1.5 left-0 size-4 shrink-0 text-muted-foreground/55"
        />
        <Input
          {...rest}
          class="rounded-none bg-transparent text-sm [&_input]:h-6.5 [&_input]:ps-5 [&_input]:font-sans [&_input]:leading-6.5"
          size="sm"
          unstyled
          onKeyDown={(event) => {
            // Typeahead would otherwise take the letters; arrows still reach the items.
            if (event.key !== "ArrowDown" && event.key !== "Escape") event.stopPropagation();
            const handler = local.onKeyDown;
            if (typeof handler === "function") handler(event);
          }}
        />
      </div>
    </label>
  );
}
