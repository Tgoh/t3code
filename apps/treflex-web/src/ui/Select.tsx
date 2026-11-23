// @effect-diagnostics globalTimers:off -- View-only scroll-arrow and selection timing, outside any Effect runtime.
import { type JSX, Portal } from "@solidjs/web";
import {
  type Accessor,
  createContext,
  createSignal,
  createUniqueId,
  omit,
  onCleanup,
  onSettled,
  Show,
  useContext,
} from "solid-js";

import { ChevronDown, ChevronUp } from "../icons";
import { backdropStyle, createPopup, type IAlign, type ISide } from "./floating";
import { createItemNavigation, createTypeahead, SELECT_TYPEAHEAD_RESET_MS } from "./itemNavigation";
import { overrides } from "./merge";
import { Presence } from "./Presence";

const TRIGGER =
  "relative inline-flex cursor-pointer select-none items-center justify-between gap-2 border rounded-lg text-left text-base outline-none transition-[color,box-shadow,background-color] data-disabled:pointer-events-none data-disabled:opacity-64 sm:text-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4";
const TRIGGER_VARIANT = {
  default:
    "w-full min-w-36 border-input bg-background not-dark:bg-clip-padding text-foreground shadow-xs/5 ring-ring/24 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] not-data-disabled:not-focus-visible:not-aria-invalid:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-inset aria-invalid:border-destructive/36 focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:ring-destructive/16 dark:bg-input/32 dark:aria-invalid:ring-destructive/24 dark:not-data-disabled:not-focus-visible:not-aria-invalid:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='text-'])]:text-icon-muted [[data-disabled],:focus-visible,[aria-invalid],[data-pressed]]:shadow-none",
  ghost:
    "border-transparent text-secondary-label focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent [:hover,[data-pressed]]:text-foreground",
};
const SVG_SIZE = "[&_svg:not([class*='size-'])]:size-4.5";
const SM_SVG_SIZE = "sm:[&_svg:not([class*='size-'])]:size-4";
const LG_BEFORE_RADIUS = "before:rounded-[calc(var(--radius-lg)-1px)]";
// Stands in for tailwind-merge: `replaces` lists the base and variant classes a size overrides.
const TRIGGER_SIZE = {
  compact: {
    class:
      "h-7 gap-1 rounded-md px-[calc(--spacing(2)-1px)] text-xs before:rounded-[calc(var(--radius-md)-1px)] [&_svg:not([class*='size-'])]:size-3.5",
    replaces: ["gap-2", "rounded-lg", "text-base", SVG_SIZE, LG_BEFORE_RADIUS],
  },
  default: { class: "min-h-9 px-[calc(--spacing(3)-1px)] sm:min-h-8", replaces: [] },
  lg: { class: "min-h-10 px-[calc(--spacing(3)-1px)] sm:min-h-9", replaces: [] },
  sm: { class: "min-h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] sm:min-h-7", replaces: ["gap-2"] },
  xs: {
    class:
      "h-7 gap-1 rounded-md px-[calc(--spacing(2)-1px)] text-sm before:rounded-[calc(var(--radius-md)-1px)] sm:h-6 sm:text-xs [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5",
    replaces: [
      "gap-2",
      "rounded-lg",
      "text-base",
      "sm:text-sm",
      SVG_SIZE,
      SM_SVG_SIZE,
      LG_BEFORE_RADIUS,
    ],
  },
};
const ICON = "-me-1 size-3.5 opacity-70";
const VALUE = "flex-1 truncate data-placeholder:text-placeholder";

const POSITIONER = "z-[130] select-none";
// Electron drag hit-testing ignores z-index; items over a drag region would swallow clicks.
const POPUP =
  "origin-(--transform-origin) rounded-lg text-foreground outline-none [-webkit-app-region:no-drag]";
const SCROLL_UP =
  "top-0 z-50 flex h-6 w-full cursor-default items-center justify-center before:pointer-events-none before:absolute before:inset-x-px before:top-px before:h-[200%] before:rounded-t-[calc(var(--radius-lg)-1px)] before:bg-linear-to-b before:from-50% before:from-popover";
const SCROLL_DOWN =
  "bottom-0 z-50 flex h-6 w-full cursor-default items-center justify-center before:pointer-events-none before:absolute before:inset-x-px before:bottom-px before:h-[200%] before:rounded-b-[calc(var(--radius-lg)-1px)] before:bg-linear-to-t before:from-50% before:from-popover";
const ARROW_ICON = "relative size-4.5 sm:size-4";
const GLASS =
  "dropdown-glass relative h-full rounded-lg shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]";
const LIST = "max-h-(--available-height) overflow-y-auto p-1";
// Base UI's `base-ui-disable-scrollbar`, which it puts on the list while scroll arrows can show.
const NO_SCROLLBAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
const ITEM =
  "flex min-h-8 in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] cursor-pointer items-center rounded-sm px-2 py-1 text-base outline-none data-selected:bg-foreground/[0.08] data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0";
const ITEM_TEXT = "min-w-0 flex-1 [&_svg:not([class*='text-'])]:text-muted-foreground";

type ITriggerVariant = keyof typeof TRIGGER_VARIANT;
type ITriggerSize = keyof typeof TRIGGER_SIZE;

function triggerClass(variant: ITriggerVariant, size: ITriggerSize, callClass?: string) {
  const replaced = new Set(TRIGGER_SIZE[size].replaces);
  if (overrides(callClass, "width")) replaced.add("w-full");
  if (overrides(callClass, "minWidth")) replaced.add("min-w-36");
  const kept = `${TRIGGER} ${TRIGGER_VARIANT[variant]}`
    .split(" ")
    .filter((token) => !replaced.has(token));
  return [...kept, TRIGGER_SIZE[size].class, callClass ?? ""].join(" ").trim();
}

const glassClass = (matchTriggerWidth: boolean) =>
  matchTriggerWidth ? `${GLASS} min-w-(--anchor-width)` : GLASS;

const ITEM_SELECTOR = '[role="option"]';
const SCROLL_ARROW_MS = 40;
// Base UI's delay before releasing the mouse over an item selects it.
const MOUSE_UP_SELECT_MS = 400;
const EDGE_TOLERANCE_PX = 1;
const VIEWPORT_MARGIN = 10;
const VIEWPORT_INSET_X = 5;
const TRIGGER_EDGE_THRESHOLD = 20;
const ALIGNED_MIN_HEIGHT = 100;

type IOpenedBy = "keyboard" | "pointer" | "touch";

interface IRoot {
  value: Accessor<string | null>;
  choose: (value: string) => void;
  disabled: Accessor<boolean>;
  open: Accessor<boolean>;
  openedBy: Accessor<IOpenedBy>;
  /** The trigger key's end of the list to highlight when nothing is selected. */
  openedTowards: Accessor<"first" | "last">;
  setOpen: (open: IOpenedBy | null, towards?: "first" | "last") => void;
  trigger: Accessor<HTMLButtonElement | undefined>;
  setTrigger: (element: HTMLButtonElement) => void;
  valueElement: Accessor<HTMLElement | undefined>;
  setValueElement: (element: HTMLElement) => void;
  focused: Accessor<boolean>;
  setFocused: (focused: boolean) => void;
  /** The items mounted hidden while the trigger has focus, for typeahead on a closed select. */
  shadow: Accessor<HTMLElement | undefined>;
  setShadow: (element: HTMLElement | undefined) => void;
  listId: string;
}

const RootContext = createContext<IRoot>();

const useRoot = () => {
  const root = useContext(RootContext);
  if (root === undefined) throw new Error("A select part is outside a Select.");
  return root;
};

const itemValues = new WeakMap<Element, string>();

const enabled = (item: HTMLElement) => !item.hasAttribute("data-disabled");

const flag = (on: boolean | undefined) => (on === true ? "" : undefined);

/**
 * Base UI's select: `value` is the chosen item's, or null for none, and choosing an item calls
 * `onValueChange` with its value. Holds the open state its trigger and popup share.
 */
export function Select(props: {
  value: string | null;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  children: JSX.Element;
}) {
  const [openedBy, setOpenedBy] = createSignal<IOpenedBy | null>(null);
  const [towards, setTowards] = createSignal<"first" | "last">("first");
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  const [valueElement, setValueElement] = createSignal<HTMLElement>();
  const [focused, setFocused] = createSignal(false);
  const [shadow, setShadow] = createSignal<HTMLElement>();
  const root: IRoot = {
    value: () => props.value,
    choose: (value) => {
      if (value !== props.value) props.onValueChange(value);
    },
    disabled: () => props.disabled === true,
    open: () => openedBy() !== null,
    openedBy: () => openedBy() ?? "pointer",
    openedTowards: towards,
    setOpen: (by, to = "first") => {
      setTowards(to);
      setOpenedBy(by);
    },
    trigger,
    setTrigger,
    valueElement,
    setValueElement,
    focused,
    setFocused,
    shadow,
    setShadow: (element) => setShadow(() => element),
    listId: createUniqueId(),
  };
  return <RootContext value={root}>{props.children}</RootContext>;
}

function triggerHandlers(root: IRoot) {
  const typeahead = createTypeahead(SELECT_TYPEAHEAD_RESET_MS);
  let pointerType = "";
  const toggle = (by: IOpenedBy, towards?: "first" | "last") => {
    if (root.disabled()) return;
    root.setOpen(root.open() ? null : by, towards);
  };
  /**
   * Base UI's `cancelOpen`: a press that opened the popup and is released away from both the
   * trigger and the popup closes it again. Armed a tick later, as Firefox can fire it on mousedown.
   */
  const cancelOnRelease = (trigger: HTMLElement) => {
    setTimeout(() =>
      document.addEventListener(
        "mouseup",
        (up) => {
          const target = up.target;
          if (target instanceof Node && trigger.contains(target)) return;
          if (target instanceof Element && target.closest('[data-slot="select-positioner"]')) {
            return;
          }
          const box = trigger.getBoundingClientRect();
          const within =
            up.clientX >= box.left &&
            up.clientX <= box.right &&
            up.clientY >= box.top &&
            up.clientY <= box.bottom;
          if (!within && root.open()) root.setOpen(null);
        },
        { once: true },
      ),
    );
  };
  const typeClosed = (event: KeyboardEvent) => {
    const items = [...(root.shadow()?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])];
    const index = items.findIndex((item) => itemValues.get(item) === root.value());
    const match = typeahead.match(event, items, index, (item) => !enabled(item));
    if (match === null) return;
    event.preventDefault();
    const value = match === undefined ? undefined : itemValues.get(match);
    if (value !== undefined) root.choose(value);
  };
  return {
    onPointerDown: (event: PointerEvent) => {
      pointerType = event.pointerType;
    },
    onMouseDown: (event: MouseEvent) => {
      // A tap's compatibility mousedown is left to its click.
      if (event.button !== 0 || pointerType !== "mouse") return;
      // Focus stays put, and goes to the popup once it opens.
      event.preventDefault();
      const opening = !root.open();
      toggle("pointer");
      if (opening && root.open() && event.currentTarget instanceof HTMLElement) {
        cancelOnRelease(event.currentTarget);
      }
    },
    onClick: (event: MouseEvent) => {
      if (event.detail === 0) return toggle("keyboard");
      if (pointerType === "mouse") return;
      toggle("touch");
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (root.open() || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        toggle("keyboard", event.key === "ArrowDown" ? "first" : "last");
        return;
      }
      if (event.key === " " && !typeahead.typing(event)) return;
      typeClosed(event);
    },
  };
}

/**
 * Opens its select's popup by a mouse press, a tap, Enter, Space, ArrowDown or ArrowUp. Typing on
 * it while closed chooses the item whose label starts with what's typed, as a native select does.
 */
export function SelectTrigger(
  props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "children"> & {
    variant?: ITriggerVariant;
    size?: ITriggerSize;
    /** Layout only, or a width. */
    class?: string;
    children: JSX.Element;
  },
) {
  const root = useRoot();
  const rest = omit(props, "variant", "size", "class", "children");
  const handlers = triggerHandlers(root);
  return (
    <button
      type="button"
      {...rest}
      ref={(held) => root.setTrigger(held)}
      class={triggerClass(props.variant ?? "default", props.size ?? "default", props.class)}
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded="false"
      disabled={root.disabled()}
      tabindex={root.disabled() ? -1 : 0}
      data-disabled={flag(root.disabled())}
      data-placeholder={flag(root.value() === null)}
      data-slot="select-trigger"
      onFocus={() => root.setFocused(true)}
      onBlur={() => root.setFocused(false)}
      onPointerDown={handlers.onPointerDown}
      onMouseDown={handlers.onMouseDown}
      onClick={handlers.onClick}
      onKeyDown={handlers.onKeyDown}
    >
      {props.children}
      <span aria-hidden="true" data-slot="select-icon">
        <ChevronDown class={ICON} />
      </span>
    </button>
  );
}

/** The chosen item's label, which the caller passes as children, or `placeholder` with none. */
export function SelectValue(props: { placeholder?: string; children?: JSX.Element }) {
  const root = useRoot();
  return (
    <span
      ref={(held) => root.setValueElement(held)}
      class={VALUE}
      data-placeholder={flag(root.value() === null)}
      data-slot="select-value"
    >
      {root.value() === null ? props.placeholder : props.children}
    </span>
  );
}

interface IPopupProps {
  side?: ISide;
  sideOffset?: number;
  align?: IAlign;
  alignOffset?: number;
  /**
   * Opens with the chosen item over the trigger's label, as Base UI's default does, falling back
   * to placing it beside the trigger for a touch, near a viewport edge, or with too little room.
   */
  alignItemWithTrigger?: boolean;
  matchTriggerWidth?: boolean;
  children: JSX.Element;
}

/**
 * The listbox, shown while the select is open: Base UI's keyboard, typeahead and pointer
 * handling, modal while open, giving focus back to the trigger once it closes.
 */
export function SelectPopup(props: IPopupProps) {
  const root = useRoot();
  return (
    <>
      <Show when={!root.open() && root.focused()}>
        <div hidden ref={(element) => root.setShadow(element)}>
          {props.children}
        </div>
      </Show>
      <Presence when={root.open() && root.trigger()}>
        {(trigger) => <SelectSurface {...props} trigger={trigger()} />}
      </Presence>
    </>
  );
}

function selectSurface(root: IRoot, props: IPopupProps & { trigger: HTMLButtonElement }) {
  const touch = root.openedBy() === "touch";
  let popupElement: HTMLDivElement | undefined;
  let list: HTMLDivElement | undefined;
  const [scrollUp, setScrollUp] = createSignal(false);
  const [scrollDown, setScrollDown] = createSignal(false);
  // Base UI's two release flags: the chosen item takes a release only after the delay, another
  // item also after a drag.
  let selectedMouseUp = false;
  let unselectedMouseUp = false;
  let dragY = 0;
  const mouseUpTimer = setTimeout(() => {
    selectedMouseUp = true;
    unselectedMouseUp = true;
  }, MOUSE_UP_SELECT_MS);
  const close = () => root.setOpen(null);
  let aligned = false;
  onCleanup(() => {
    clearTimeout(mouseUpTimer);
    window.removeEventListener("resize", close);
  });
  const navigation = createItemNavigation({
    container: () => list,
    selector: ITEM_SELECTOR,
    loop: false,
    typeaheadResetMs: SELECT_TYPEAHEAD_RESET_MS,
    typeaheadSkips: (item) => !enabled(item),
    typeaheadFrom: () => selectedItem(),
  });
  const updateArrows = () => {
    if (list === undefined || touch) return;
    const max = list.scrollHeight - list.clientHeight;
    setScrollUp(list.scrollTop > EDGE_TOLERANCE_PX);
    setScrollDown(list.scrollTop < max - EDGE_TOLERANCE_PX);
  };
  const selectedItem = () =>
    navigation.items().find((item) => itemValues.get(item) === root.value());
  const popup = createPopup({
    anchor: props.trigger,
    trigger: props.trigger,
    placement: () => ({
      side: props.side ?? "bottom",
      align: props.align ?? "start",
      sideOffset: props.sideOffset ?? 4,
      alignOffset: props.alignOffset ?? 0,
      collisionAvoidance: { fallbackAxisSide: "none" },
    }),
    onClose: close,
    position: (element) => {
      aligned = (props.alignItemWithTrigger ?? true) && !touch && alignWithTrigger(element);
      // An aligned popup doesn't follow its trigger, so a resize closes it, as Base UI's does.
      if (aligned) window.addEventListener("resize", close);
      requestAnimationFrame(updateArrows);
      return aligned;
    },
    initialFocus: () => {
      const items = navigation.items().filter(enabled);
      const target =
        selectedItem() ??
        (root.openedBy() === "keyboard"
          ? root.openedTowards() === "first"
            ? items[0]
            : items.at(-1)
          : aligned
            ? navigation.items()[0]
            : undefined);
      if (target === undefined) {
        popupElement?.focus({ preventScroll: true });
        return;
      }
      navigation.focusItem(target, false);
      // Placement lands after the first frame; only then does the list scroll.
      requestAnimationFrame(() => target.scrollIntoView({ block: "nearest" }));
    },
  });
  onSettled(() => {
    if (list !== undefined) props.trigger.setAttribute("aria-controls", list.id);
  });

  const alignWithTrigger = (element: HTMLElement): boolean => {
    if (popupElement === undefined || list === undefined) return false;
    const view = document.documentElement;
    const triggerBox = props.trigger.getBoundingClientRect();
    element.style.setProperty("--anchor-width", `${triggerBox.width}px`);
    // Measured as it will show: aligned items are wider than the trigger.
    element.dataset.side = "none";
    popupElement.dataset.side = "none";
    const box = element.getBoundingClientRect();
    const text = (
      selectedItem() ?? (root.value() === null ? navigation.items()[0] : undefined)
    )?.querySelector<HTMLElement>('[data-slot="select-item-text"]');
    const valueBox = root.valueElement()?.getBoundingClientRect() ?? triggerBox;
    const textBox = text?.getBoundingClientRect();
    const target = valueBox.top + valueBox.height / 2;
    const offset =
      textBox === undefined ? triggerBox.height / 2 : textBox.top - box.top + textBox.height / 2;
    const left =
      textBox === undefined ? triggerBox.left : box.left + (valueBox.left - textBox.left);
    // The items above or below that don't fit are scrolled out of view rather than moving the
    // chosen one off the trigger.
    const ideal = target - offset;
    const top = Math.max(ideal, VIEWPORT_MARGIN);
    const scroll = top - ideal;
    const height = Math.min(box.height - scroll, view.clientHeight - VIEWPORT_MARGIN - top);
    if (
      triggerBox.top < TRIGGER_EDGE_THRESHOLD ||
      triggerBox.bottom > view.clientHeight - TRIGGER_EDGE_THRESHOLD ||
      Math.ceil(height) + EDGE_TOLERANCE_PX < Math.min(box.height, ALIGNED_MIN_HEIGHT)
    ) {
      delete element.dataset.side;
      delete popupElement.dataset.side;
      return false;
    }
    element.style.left = `${Math.min(Math.max(left, VIEWPORT_INSET_X), view.clientWidth - VIEWPORT_INSET_X - box.width)}px`;
    element.style.top = `${top}px`;
    element.style.height = `${height}px`;
    popupElement.style.height = "100%";
    Object.assign(list.style, { position: "relative", maxHeight: "100%", overflowY: "auto" });
    list.scrollTop = scroll;
    const origin = Math.min(Math.max(((target - top) / height) * 100, 0), 100);
    popupElement.style.setProperty("--transform-origin", `50% ${origin}%`);
    return true;
  };

  const scrollArrow = (direction: 1 | -1) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    onCleanup(stop);
    const step = () => {
      timer = undefined;
      if (list === undefined) return;
      const max = list.scrollHeight - list.clientHeight;
      const row = navigation.items()[0]?.offsetHeight ?? 0;
      list.scrollTop = Math.min(Math.max(list.scrollTop + direction * row, 0), max);
      updateArrows();
      if (list.scrollTop <= 0 || list.scrollTop >= max) return;
      timer = setTimeout(step, SCROLL_ARROW_MS);
    };
    return {
      onMouseMove: (event: MouseEvent) => {
        if ((event.movementX === 0 && event.movementY === 0) || timer !== undefined) return;
        if (list?.contains(document.activeElement)) popupElement?.focus({ preventScroll: true });
        timer = setTimeout(step, SCROLL_ARROW_MS);
      },
      onMouseLeave: stop,
    };
  };
  const up = scrollArrow(-1);
  const down = scrollArrow(1);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Tab") {
      // Focus goes back to the trigger first: Tab then moves on from it, Shift+Tab stays on it.
      popup.restoreFocus();
      if (event.shiftKey) event.preventDefault();
      close();
      return;
    }
    const target = navigation.resolve(event);
    if (target === null) return;
    event.preventDefault();
    if (target === "activate") {
      navigation.highlighted()?.click();
      return;
    }
    event.stopPropagation();
    navigation.focusItem(target);
  };
  const clearHighlight = () => {
    if (navigation.highlighted() !== null) popupElement?.focus({ preventScroll: true });
  };

  return {
    touch,
    scrollUp,
    scrollDown,
    up,
    down,
    backdrop: popup.backdrop,
    positioner: popup.positioner,
    popup: (held: HTMLDivElement) => {
      popupElement = held;
      popup.popup(held);
    },
    list: (held: HTMLDivElement) => {
      list = held;
    },
    updateArrows,
    onKeyDown,
    onPointerMove: (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.buttons === 1) {
        dragY += event.movementY;
        if (dragY ** 2 >= 64) unselectedMouseUp = true;
      }
      const item = navigation.itemAt(event.target);
      if (item === null || !enabled(item)) return clearHighlight();
      if (item !== navigation.highlighted()) navigation.focusItem(item, false);
    },
    onPointerLeave: clearHighlight,
    onFocusIn: navigation.onFocusIn,
    onFocusOut: navigation.onFocusOut,
    host: {
      mouseUp: (item: HTMLElement) => {
        if (root.openedBy() !== "pointer") return;
        const allowed = itemValues.get(item) === root.value() ? selectedMouseUp : unselectedMouseUp;
        if (allowed) item.click();
      },
      close,
    } satisfies IItemHost,
  };
}

function SelectSurface(props: IPopupProps & { trigger: HTMLButtonElement }) {
  const root = useRoot();
  const surface = selectSurface(root, props);
  return (
    <Portal>
      <div
        ref={(held) => surface.backdrop(held)}
        role="presentation"
        style={backdropStyle(props.trigger)}
      />
      <div
        ref={(held) => surface.positioner(held)}
        class={POSITIONER}
        style={{ position: "fixed", left: "0px", top: "0px" }}
        data-slot="select-positioner"
      >
        <div
          ref={(held) => surface.popup(held)}
          class={POPUP}
          role="presentation"
          tabindex={-1}
          data-slot="select-popup"
          onKeyDown={surface.onKeyDown}
          onPointerMove={surface.onPointerMove}
          onPointerLeave={surface.onPointerLeave}
          onFocusIn={surface.onFocusIn}
          onFocusOut={surface.onFocusOut}
        >
          <Show when={surface.scrollUp()}>
            <div
              aria-hidden="true"
              class={SCROLL_UP}
              style={{ position: "absolute" }}
              data-slot="select-scroll-up-arrow"
              onMouseMove={surface.up.onMouseMove}
              onMouseLeave={surface.up.onMouseLeave}
            >
              <ChevronUp class={ARROW_ICON} />
            </div>
          </Show>
          <div class={glassClass(props.matchTriggerWidth ?? true)}>
            <div
              ref={(held) => surface.list(held)}
              id={root.listId}
              class={surface.touch ? LIST : `${LIST} ${NO_SCROLLBAR}`}
              role="listbox"
              data-slot="select-list"
              onScroll={surface.updateArrows}
            >
              <ItemHostContext value={surface.host}>{props.children}</ItemHostContext>
            </div>
          </div>
          <Show when={surface.scrollDown()}>
            <div
              aria-hidden="true"
              class={SCROLL_DOWN}
              style={{ position: "absolute" }}
              data-slot="select-scroll-down-arrow"
              onMouseMove={surface.down.onMouseMove}
              onMouseLeave={surface.down.onMouseLeave}
            >
              <ChevronDown class={ARROW_ICON} />
            </div>
          </Show>
        </div>
      </div>
    </Portal>
  );
}

interface IItemHost {
  /** A mouse released over an item that wasn't pressed on it, as when dragging from the trigger. */
  mouseUp: (item: HTMLElement) => void;
  close: () => void;
}

const ItemHostContext = createContext<IItemHost>();

function itemHandlers(
  root: IRoot,
  host: IItemHost | undefined,
  props: { value: string; disabled?: boolean },
) {
  let pressed = false;
  return {
    onPointerDown: () => {
      pressed = true;
    },
    onMouseUp: (event: MouseEvent & { currentTarget: HTMLDivElement }) => {
      if (pressed) {
        pressed = false;
        return;
      }
      host?.mouseUp(event.currentTarget);
    },
    onClick: () => {
      pressed = false;
      if (props.disabled === true) return;
      root.choose(props.value);
      host?.close();
    },
  };
}

export function SelectItem(props: { value: string; disabled?: boolean; children: JSX.Element }) {
  const root = useRoot();
  const handlers = itemHandlers(root, useContext(ItemHostContext), props);
  const selected = () => root.value() === props.value;
  return (
    <div
      ref={(element) => itemValues.set(element, props.value)}
      class={ITEM}
      role="option"
      tabindex={-1}
      aria-selected={selected() ? "true" : "false"}
      aria-disabled={props.disabled === true ? "true" : undefined}
      data-selected={flag(selected())}
      data-disabled={flag(props.disabled)}
      data-slot="select-item"
      onPointerDown={handlers.onPointerDown}
      onMouseUp={handlers.onMouseUp}
      onClick={handlers.onClick}
    >
      <div class={ITEM_TEXT} data-slot="select-item-text">
        {props.children}
      </div>
    </div>
  );
}
