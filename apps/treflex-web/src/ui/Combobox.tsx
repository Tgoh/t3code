import { type JSX, Portal } from "@solidjs/web";
import { createContext, createUniqueId, omit, onCleanup, onSettled, useContext } from "solid-js";

import { Search } from "../icons";
import { createPopup, type IAlign, type IAnchor, inFloating, type ISide } from "./floating";
import { ScrollArea } from "./ScrollArea";

const SEARCH_LABEL = "block min-w-0 shrink-0 cursor-text px-3 pt-2.5";

const SEARCH_FRAME =
  "relative -translate-y-px border-b border-border/70 pb-1.5 transition-colors focus-within:border-ring";

const SEARCH_ICON =
  "pointer-events-none absolute top-1.5 left-0 size-4 shrink-0 text-muted-foreground/55";

const SEARCH_ROOT =
  "relative not-has-[>*.w-full]:w-fit w-full text-foreground has-disabled:opacity-64";

// Stock's unstyled small Input control merged with ComboboxInput's and ComboboxSearchInput's
// classes, as tailwind-merge leaves them.
const SEARCH_CONTROL =
  "has-disabled:opacity-100 rounded-none bg-transparent text-sm has-[+[data-slot=combobox-trigger],+[data-slot=combobox-clear]]:*:data-[slot=combobox-input]:pe-6.5 flex w-full [&_input]:h-6.5 [&_input]:ps-5 [&_input]:font-sans [&_input]:leading-6.5";

const SEARCH_FIELD =
  "w-full min-w-0 rounded-[inherit] outline-none placeholder:text-placeholder [transition:background-color_5000000s_ease-in-out_0s] h-7.5 px-[calc(--spacing(2.5)-1px)] leading-7.5 sm:h-6.5 sm:leading-6.5";

const POSITIONER = "z-[130] select-none";

const POPUP_FRAME =
  "dropdown-glass relative flex max-h-full min-w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) rounded-lg shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] transition-[scale,opacity] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]";

// Electron drag hit-testing ignores z-index; items over a drag region would swallow clicks.
const POPUP =
  "flex min-w-0 max-h-[min(var(--available-height),23rem)] flex-1 flex-col overflow-hidden text-foreground [-webkit-app-region:no-drag]";

const ITEM_BASE =
  "flex min-h-8 in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] cursor-pointer items-center rounded-sm px-2 py-1 text-base outline-none not-data-disabled:hover:bg-foreground/[0.09] data-disabled:cursor-not-allowed data-selected:text-foreground data-highlighted:bg-foreground/[0.09] data-highlighted:text-accent-foreground [&[data-highlighted][data-selected]]:bg-foreground/[0.09] [&[data-highlighted][data-selected]]:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0";

const ITEM_SELECTED_FILL = "data-selected:bg-foreground/[0.06]";

const ITEM_CONTENT =
  "flex min-w-0 flex-1 items-center gap-2 [&_svg:not([class*='text-'])]:text-muted-foreground";

const EMPTY = "not-empty:p-2 text-center text-base text-muted-foreground sm:text-sm";

const LIST = "not-empty:scroll-py-1 not-empty:px-1 not-empty:py-1";

const LIST_VIRTUALIZED = "size-full min-w-0 not-empty:px-1 not-empty:py-1";

const STATUS = "px-3 py-2 font-medium text-muted-foreground text-xs empty:m-0 empty:p-0";

const ITEM_SELECTOR = '[data-slot="combobox-item"]';

const itemValues = new WeakMap<Element, string>();

const withClass = (base: string, extra: string | undefined) =>
  extra === undefined || extra === "" ? base : `${base} ${extra}`;

let pendingOpenHighlight: "first" | "last" | null = null;

/**
 * Base UI's trigger keys: ArrowDown opens the combobox on its first item and ArrowUp on its last,
 * when nothing is selected. Put it on a closed trigger's `onKeyDown`, with what opens it.
 */
export function openComboboxFromKeys(event: KeyboardEvent, open: () => void): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const trigger = event.currentTarget;
  if (!(trigger instanceof HTMLElement) || trigger.getAttribute("aria-expanded") === "true") return;
  event.preventDefault();
  pendingOpenHighlight = event.key === "ArrowDown" ? "first" : "last";
  open();
  queueMicrotask(() => (pendingOpenHighlight = null));
}

/** The combobox's trigger: a press or ArrowDown and ArrowUp call `onOpen` with it. */
export function ComboboxTrigger(
  props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "onKeyDown"> & {
    onOpen: (trigger: HTMLButtonElement) => void;
  },
) {
  const rest = omit(props, "onOpen");
  return (
    <button
      type="button"
      aria-haspopup="listbox"
      aria-expanded="false"
      data-slot="combobox-trigger"
      {...rest}
      onClick={(event) => props.onOpen(event.currentTarget)}
      onKeyDown={(event) => {
        const trigger = event.currentTarget;
        openComboboxFromKeys(event, () => props.onOpen(trigger));
      }}
    />
  );
}

/**
 * Base UI's combobox list navigation with `autoHighlight`: focus stays on the input while the
 * highlight moves by index, so a list that re-renders keeps its highlight at the same row.
 */
function comboboxNavigation(options: {
  onItemHighlighted?: ((value: string | null) => void) | undefined;
}) {
  let list: HTMLElement | undefined;
  let input: HTMLInputElement | undefined;
  let index: number | null = null;
  // A query was typed and the first row takes the highlight once the list has one.
  let pending = false;
  // Opened and not yet navigated: rows that arrive later still bring the selected one in.
  let opening: { fallback: "first" | "last" | null } | null = null;
  let highlighted: HTMLElement | null = null;
  let pressed: Element | null = null;
  const items = () =>
    list === undefined ? [] : [...list.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
  const apply = (target: HTMLElement | null, scroll: boolean) => {
    const changed = target !== highlighted;
    if (changed) {
      highlighted?.removeAttribute("data-highlighted");
      target?.setAttribute("data-highlighted", "");
      highlighted = target;
    }
    if (target === null) input?.removeAttribute("aria-activedescendant");
    else input?.setAttribute("aria-activedescendant", target.id);
    if (scroll) target?.scrollIntoView({ block: "nearest" });
    if (changed)
      options.onItemHighlighted?.(target === null ? null : (itemValues.get(target) ?? null));
  };
  const sync = () => {
    if (opening !== null && index === null && highlightSelected(opening.fallback)) {
      opening = null;
      return;
    }
    const all = items();
    const first = pending && all.length > 0;
    if (first) {
      index = 0;
      pending = false;
    }
    if (index !== null && index >= all.length) index = null;
    apply(index === null ? null : (all[index] ?? null), first);
  };
  const highlightSelected = (fallback: "first" | "last" | null) => {
    const all = items();
    const selected = all.findIndex((item) => item.hasAttribute("data-selected"));
    const enabled = all.filter((item) => !item.hasAttribute("data-disabled"));
    const target =
      selected >= 0
        ? all[selected]
        : fallback === "first"
          ? enabled[0]
          : fallback === "last"
            ? enabled.at(-1)
            : undefined;
    if (target === undefined) return false;
    index = all.indexOf(target);
    apply(target, true);
    return true;
  };
  const itemAt = (target: EventTarget | null) => {
    const item = target instanceof Element ? target.closest<HTMLElement>(ITEM_SELECTOR) : null;
    return item !== null && list?.contains(item) === true ? item : null;
  };
  const scrollToTop = () => {
    const inner = list?.firstElementChild;
    if (inner instanceof HTMLElement && inner.scrollHeight > inner.clientHeight) {
      inner.scrollTop = 0;
      return;
    }
    for (let element = list ?? null; element !== null; element = element.parentElement) {
      if (element.scrollHeight > element.clientHeight) {
        element.scrollTop = 0;
        return;
      }
      if (element.dataset.slot === "combobox-popup") return;
    }
  };
  return {
    setList: (element: HTMLElement) => {
      list = element;
      const observer = new MutationObserver(() => sync());
      observer.observe(element, { childList: true, subtree: true });
      onCleanup(() => observer.disconnect());
    },
    setInput: (element: HTMLInputElement) => {
      input = element;
    },
    input: () => input,
    open: (fallback: "first" | "last" | null) => {
      opening = { fallback };
      sync();
    },
    move: (step: 1 | -1) => {
      const all = items();
      if (all.length === 0) return;
      opening = null;
      pending = false;
      index =
        index === null
          ? step === 1
            ? 0
            : all.length - 1
          : (index + step + all.length) % all.length;
      apply(all[index] ?? null, true);
    },
    activate: () => {
      if (highlighted === null) return false;
      if (!highlighted.hasAttribute("data-disabled")) highlighted.click();
      return true;
    },
    queryChanged: (query: string) => {
      opening = null;
      if (query.trim() === "") {
        pending = false;
        queueMicrotask(() => highlightSelected(null));
        return;
      }
      pending = true;
      scrollToTop();
      queueMicrotask(() => sync());
    },
    onMouseMove: (event: MouseEvent) => {
      const item = itemAt(event.target);
      if (item === null || item === highlighted) return;
      opening = null;
      pending = false;
      index = items().indexOf(item);
      apply(item, false);
    },
    onPointerOut: (event: PointerEvent) => {
      if (event.pointerType === "touch" || itemAt(event.target) === null) return;
      if (itemAt(event.relatedTarget) !== null) return;
      opening = null;
      index = null;
      apply(null, false);
    },
    onItemPointerDown: (event: PointerEvent) => {
      if (event.isPrimary) pressed = event.currentTarget as Element;
      event.preventDefault();
    },
    /** A release over the highlighted row after a press elsewhere selects it, as Base UI's does. */
    onItemMouseUp: (event: MouseEvent & { currentTarget: HTMLElement }) => {
      const started = pressed === event.currentTarget;
      pressed = null;
      const item = event.currentTarget;
      if (started || event.button !== 0 || item !== highlighted) return;
      if (!item.hasAttribute("data-disabled")) item.click();
    },
  };
}

interface IRoot {
  value: () => string | null;
  listId: string;
  navigation: ReturnType<typeof comboboxNavigation>;
}

const RootContext = createContext<IRoot>();

const useRoot = () => {
  const root = useContext(RootContext);
  if (root === undefined) throw new Error("A combobox part is outside a Combobox.");
  return root;
};

/**
 * Base UI's combobox with `autoHighlight`: typing highlights the first row, clearing the query
 * goes back to the `value` row, and the arrow keys and Enter on its search input move the
 * highlight and choose the row. Filtering is the caller's: render the rows that match.
 */
export function Combobox(props: {
  value: string | null;
  onItemHighlighted?: (value: string | null) => void;
  children: JSX.Element;
}) {
  const root: IRoot = {
    value: () => props.value,
    listId: createUniqueId(),
    navigation: comboboxNavigation({
      onItemHighlighted: (value) => props.onItemHighlighted?.(value),
    }),
  };
  return <RootContext value={root}>{props.children}</RootContext>;
}

/** A combobox's filter field, which keeps focus while its list's highlight moves. */
export function ComboboxSearchInput(
  props: Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "class" | "size" | "ref"> & {
    ref?: (element: HTMLInputElement) => void;
  },
) {
  const root = useRoot();
  const rest = omit(props, "ref", "onInput", "onKeyDown");
  return (
    <label class={SEARCH_LABEL}>
      <div class={SEARCH_FRAME}>
        <Search aria-hidden="true" class={SEARCH_ICON} />
        <div class={SEARCH_ROOT}>
          <span class={SEARCH_CONTROL} data-size="sm" data-slot="input-control">
            <input
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={root.listId}
              autocomplete="off"
              spellcheck={false}
              {...rest}
              ref={(element) => {
                root.navigation.setInput(element);
                props.ref?.(element);
              }}
              class={SEARCH_FIELD}
              data-slot="combobox-input"
              onInput={(event) => {
                const handler = props.onInput;
                if (typeof handler === "function") handler(event);
                root.navigation.queryChanged(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                const handler = props.onKeyDown;
                if (typeof handler === "function") handler(event);
                if (event.defaultPrevented || event.isComposing) return;
                if (event.altKey || event.ctrlKey || event.metaKey) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  root.navigation.move(event.key === "ArrowDown" ? 1 : -1);
                } else if (event.key === "Enter" && root.navigation.activate()) {
                  event.preventDefault();
                }
              }}
            />
          </span>
        </div>
      </div>
    </label>
  );
}

/**
 * The popup under a combobox's trigger, non-modal as Base UI's: it focuses its search input on
 * open, and closes on Escape, Tab, a press outside or focus leaving it, giving focus back to the
 * trigger. Render it in a `Presence`.
 */
export function ComboboxPopup(props: {
  anchor: IAnchor;
  /** The element that opened it, when that isn't an element `anchor`. */
  trigger?: HTMLElement;
  onClose: () => void;
  side?: ISide;
  align?: IAlign;
  sideOffset?: number;
  alignOffset?: number;
  /** Layout only, or a width. */
  class?: string;
  children: JSX.Element;
}) {
  const root = useRoot();
  const fallback = pendingOpenHighlight;
  const trigger = props.trigger ?? (props.anchor instanceof HTMLElement ? props.anchor : null);
  const popup = createPopup({
    anchor: props.anchor,
    trigger,
    placement: () => ({
      side: props.side ?? "bottom",
      align: props.align ?? "start",
      sideOffset: props.sideOffset ?? 4,
      alignOffset: props.alignOffset ?? 0,
      collisionAvoidance: { fallbackAxisSide: "none" },
    }),
    onClose: () => props.onClose(),
    initialFocus: () => {
      root.navigation.input()?.focus({ preventScroll: true });
      root.navigation.open(fallback);
    },
  });
  return (
    <Portal>
      <div
        ref={(held) => popup.positioner(held)}
        class={POSITIONER}
        style={{ position: "fixed", left: "0px", top: "0px" }}
        data-slot="combobox-positioner"
      >
        <span ref={(held) => popup.popup(held)} class={withClass(POPUP_FRAME, props.class)}>
          <div
            class={POPUP}
            tabindex={-1}
            data-slot="combobox-popup"
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              // Focus goes back to the trigger first: Tab then moves on from it, Shift+Tab stays.
              popup.restoreFocus();
              if (event.shiftKey) event.preventDefault();
              props.onClose();
            }}
            onFocusOut={(event) => {
              const next = event.relatedTarget;
              if (!(next instanceof Node) || popup.exiting()) return;
              if (event.currentTarget.contains(next) || trigger?.contains(next)) return;
              if (inFloating(next)) return;
              props.onClose();
            }}
          >
            {props.children}
          </div>
        </span>
      </div>
    </Portal>
  );
}

export function ComboboxList(props: { children: JSX.Element }) {
  const root = useRoot();
  return (
    <ScrollArea scrollbarGutter scrollFade>
      <div
        ref={(held) => root.navigation.setList(held)}
        id={root.listId}
        class={LIST}
        role="listbox"
        data-slot="combobox-list"
        onMouseMove={root.navigation.onMouseMove}
        onPointerOut={root.navigation.onPointerOut}
      >
        {props.children}
      </div>
    </ScrollArea>
  );
}

/**
 * A list whose scroller is the caller's child, as stock's is under a virtualizer. `inline` lists
 * sit in the page rather than a popup, and highlight their selected row on mount.
 */
export function ComboboxListVirtualized(props: {
  inline?: boolean;
  "aria-label"?: string;
  /** Layout only. */
  class?: string;
  children: JSX.Element;
}) {
  const root = useRoot();
  onSettled(() => {
    if (props.inline === true) root.navigation.open(null);
  });
  return (
    <div
      ref={(held) => root.navigation.setList(held)}
      id={root.listId}
      class={withClass(LIST_VIRTUALIZED, props.class)}
      role="listbox"
      aria-label={props["aria-label"]}
      data-slot="combobox-list"
      onMouseMove={root.navigation.onMouseMove}
      onPointerOut={root.navigation.onPointerOut}
    >
      {props.children}
    </div>
  );
}

/**
 * A row: `value` names it for the combobox's `value` and `onItemHighlighted`. A disabled row can
 * still be highlighted but not chosen; `pointerWhenDisabled` keeps it hoverable, for a tooltip.
 */
export function ComboboxItem(
  props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "onClick" | "role"> & {
    value: string;
    disabled?: boolean;
    selectedFill?: boolean;
    pointerWhenDisabled?: boolean;
    /** Layout only. */
    class?: string;
    onClick?: (event: MouseEvent) => void;
    children: JSX.Element;
  },
) {
  const root = useRoot();
  const rest = omit(
    props,
    "value",
    "disabled",
    "selectedFill",
    "pointerWhenDisabled",
    "class",
    "onClick",
    "children",
  );
  const id = createUniqueId();
  const selected = () => root.value() === props.value;
  const classes = () =>
    [
      ITEM_BASE,
      props.pointerWhenDisabled === true
        ? "data-disabled:pointer-events-auto"
        : "data-disabled:pointer-events-none",
      props.selectedFill !== false && ITEM_SELECTED_FILL,
      props.class,
    ]
      .filter(Boolean)
      .join(" ");
  return (
    <div
      id={id}
      {...rest}
      ref={(element) => itemValues.set(element, props.value)}
      class={classes()}
      role="option"
      aria-selected={selected() ? "true" : "false"}
      aria-disabled={props.disabled === true ? "true" : undefined}
      data-selected={selected() ? "" : undefined}
      data-disabled={props.disabled === true ? "" : undefined}
      data-slot="combobox-item"
      onPointerDown={root.navigation.onItemPointerDown}
      onMouseDown={(event) => event.preventDefault()}
      onMouseUp={root.navigation.onItemMouseUp}
      onClick={(event) => {
        if (props.disabled !== true) props.onClick?.(event);
      }}
    >
      <div class={ITEM_CONTENT} data-slot="combobox-item-content">
        {props.children}
      </div>
    </div>
  );
}

export function ComboboxEmpty(props: JSX.HTMLAttributes<HTMLDivElement> & { class?: string }) {
  const rest = omit(props, "class");
  return <div {...rest} class={withClass(EMPTY, props.class)} data-slot="combobox-empty" />;
}

export function ComboboxStatus(props: { children: JSX.Element }) {
  return (
    <div
      class={STATUS}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-slot="combobox-status"
    >
      {props.children}
    </div>
  );
}
