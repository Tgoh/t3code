import { stepHighlight } from "../listNavigation";

/** Base UI's `TYPEAHEAD_RESET_MS`, which its menus pass; its selects keep the 750ms default. */
export const MENU_TYPEAHEAD_RESET_MS = 500;
export const SELECT_TYPEAHEAD_RESET_MS = 750;

const labelOf = (item: HTMLElement) =>
  (item.dataset.label ?? item.textContent ?? "").trim().toLowerCase();

/**
 * Base UI's typeahead: letters typed within `resetMs` of each other build one prefix, a prefix
 * that matches nothing starts over, and repeating a first letter cycles through the items that
 * start with it, unless some label starts with a doubled letter.
 */
export function createTypeahead(resetMs: number) {
  let typed = "";
  let typedAt = -Infinity;
  let previous = -1;
  let matched = -1;
  const expire = (event: KeyboardEvent) => {
    if (typed === "" || event.timeStamp - typedAt < resetMs) return;
    typed = "";
    previous = matched;
  };
  return {
    /** Whether a Space now is part of what's being typed rather than a press. */
    typing: (event: KeyboardEvent) => {
      expire(event);
      return typed !== "";
    },
    /**
     * For a printable key, the next item after the one at `index` whose label starts with what's
     * been typed, or undefined for none; null for any other key.
     */
    match: (
      event: KeyboardEvent,
      items: readonly HTMLElement[],
      index: number,
      skip?: (item: HTMLElement) => boolean,
    ): HTMLElement | undefined | null => {
      if (event.key.length !== 1) return null;
      expire(event);
      const key = event.key.toLowerCase();
      const available = (item: HTMLElement) => skip?.(item) !== true;
      const labels = items.map(labelOf);
      if (typed === "") previous = index;
      const cycles = labels.every(
        (label, at) => label === "" || !available(items[at]!) || label[0] !== label[1],
      );
      if (cycles && typed === key) {
        typed = "";
        previous = matched;
      }
      typed += key;
      typedAt = event.timeStamp;
      for (let offset = 0; offset < items.length; offset += 1) {
        const at = (previous + 1 + offset + items.length) % items.length;
        if (available(items[at]!) && labels[at]!.startsWith(typed)) {
          matched = at;
          return items[at];
        }
      }
      if (key !== " ") typed = "";
      return undefined;
    },
  };
}

/**
 * The highlight of a menu's or select's items, as Base UI's list navigation: the highlighted item
 * holds focus and `data-highlighted`, and the keys move it.
 */
export function createItemNavigation(options: {
  container: () => HTMLElement | undefined;
  selector: string;
  /** Whether the arrow keys wrap at the ends: a menu's do, a select's stop. */
  loop: boolean;
  typeaheadResetMs: number;
  /** Items typeahead passes over. */
  typeaheadSkips?: (item: HTMLElement) => boolean;
  /** The item a new typeahead searches after, when not the highlighted one: a select's choice. */
  typeaheadFrom?: () => HTMLElement | undefined;
}) {
  let highlighted: HTMLElement | null = null;
  const typeahead = createTypeahead(options.typeaheadResetMs);
  const items = () => {
    const container = options.container();
    return container === undefined
      ? []
      : [...container.querySelectorAll<HTMLElement>(options.selector)];
  };
  const itemAt = (target: EventTarget | null) => {
    const item = target instanceof Element ? target.closest<HTMLElement>(options.selector) : null;
    return item !== null && options.container()?.contains(item) === true ? item : null;
  };
  const setHighlight = (item: HTMLElement | null) => {
    if (highlighted === item) return;
    highlighted?.removeAttribute("data-highlighted");
    highlighted = item;
    item?.setAttribute("data-highlighted", "");
  };
  return {
    items,
    itemAt,
    highlighted: () => highlighted,
    focusItem: (item: HTMLElement | undefined, scroll = true) => {
      if (item === undefined) return;
      item.focus({ preventScroll: true });
      if (scroll) item.scrollIntoView({ block: "nearest" });
    },
    typing: typeahead.typing,
    /**
     * What a key does: the item it moves the highlight to (undefined when there is none),
     * `"activate"` for Enter or Space on the highlighted item, or null for a key it leaves alone.
     */
    resolve: (event: KeyboardEvent): HTMLElement | undefined | "activate" | null => {
      const list = items();
      const index = highlighted === null ? -1 : list.indexOf(highlighted);
      switch (event.key) {
        case "ArrowDown":
        case "ArrowUp": {
          const step = event.key === "ArrowDown" ? 1 : -1;
          const next = options.loop
            ? stepHighlight(index < 0 ? null : index, list.length, step)
            : index < 0
              ? step === 1
                ? 0
                : list.length - 1
              : Math.min(list.length - 1, Math.max(0, index + step));
          return next === null ? undefined : list[next];
        }
        case "Home":
          return list[0];
        case "End":
          return list.at(-1);
        case "Enter":
        case " ":
          if (event.key === " " && typeahead.typing(event)) break;
          if (highlighted === null || event.target instanceof HTMLInputElement) return null;
          return "activate";
      }
      const from = options.typeaheadFrom?.();
      return typeahead.match(
        event,
        list,
        from === undefined ? index : list.indexOf(from),
        options.typeaheadSkips,
      );
    },
    onFocusIn: (event: FocusEvent) => setHighlight(itemAt(event.target)),
    onFocusOut: (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || options.container()?.contains(next) !== true) {
        setHighlight(null);
      }
    },
  };
}
