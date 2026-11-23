import { type Accessor, createMemo, createSignal, onCleanup, onSettled } from "solid-js";

export type IOrientation = "horizontal" | "vertical" | "both";

interface IKeys {
  orientation: IOrientation;
  homeEnd: boolean;
}

const enabled = (item: HTMLElement) =>
  !item.hasAttribute("disabled") && item.getAttribute("aria-disabled") !== "true";

/**
 * Base UI's composite keys: the item an arrow key (or Home and End, when on) moves focus to from
 * the one holding focus, skipping disabled items and wrapping. Undefined when focus stays put.
 */
function rovingTarget(
  event: KeyboardEvent,
  items: readonly HTMLElement[],
  keys: IKeys,
): HTMLElement | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return undefined;
  const target = event.target;
  const current = items.findIndex((item) => target instanceof Node && item.contains(target));
  if (current < 0) return undefined;
  const rtl = getComputedStyle(items[current]!).direction === "rtl";
  const horizontal = keys.orientation !== "vertical";
  const vertical = keys.orientation !== "horizontal";
  const forward =
    (horizontal && event.key === (rtl ? "ArrowLeft" : "ArrowRight")) ||
    (vertical && event.key === "ArrowDown");
  const backward =
    (horizontal && event.key === (rtl ? "ArrowRight" : "ArrowLeft")) ||
    (vertical && event.key === "ArrowUp");
  const open = items.filter(enabled);
  let next: HTMLElement | undefined;
  if (keys.homeEnd && event.key === "Home") next = open[0];
  else if (keys.homeEnd && event.key === "End") next = open.at(-1);
  else if (forward || backward) {
    const step = forward ? 1 : -1;
    for (let offset = 1; offset < items.length; offset++) {
      const item = items[(current + step * offset + items.length) % items.length]!;
      if (enabled(item)) {
        next = item;
        break;
      }
    }
  }
  return next === items[current] ? undefined : next;
}

/**
 * One tab stop for a group, as Base UI's `CompositeRoot`: the item focused last, else the active
 * one, else the first enabled.
 */
export function createRoving(options: { orientation: Accessor<IOrientation>; homeEnd: boolean }) {
  const entries = new Map<
    HTMLElement,
    { active: Accessor<boolean>; disabled: Accessor<boolean> }
  >();
  const [version, setVersion] = createSignal(0);
  const [focused, setFocused] = createSignal<HTMLElement | null>(null);
  const changed = () => setVersion((held) => held + 1);
  const ordered = () => {
    version();
    return [...entries.keys()].sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
  };
  const stop = createMemo(() => {
    const open = ordered().filter((item) => entries.get(item)?.disabled() !== true);
    const held = focused();
    if (held !== null && open.includes(held)) return held;
    return open.find((item) => entries.get(item)?.active() === true) ?? open[0] ?? null;
  });
  return {
    /** Call in the item's component body; pass the returned ref to the item's element. */
    register(entry: { active: Accessor<boolean>; disabled: Accessor<boolean> }) {
      let item: HTMLElement | undefined;
      // Mounted, the item has its place in the document, which orders the group.
      onSettled(() => {
        changed();
      });
      onCleanup(() => {
        if (item === undefined) return;
        entries.delete(item);
        if (focused() === item) setFocused(null);
        changed();
      });
      return (element: HTMLElement) => {
        item = element;
        entries.set(element, entry);
      };
    },
    tabIndex: (item: HTMLElement | undefined) => {
      const held = stop();
      return item !== undefined && held === item ? 0 : -1;
    },
    onFocusIn(event: FocusEvent) {
      const target = event.target;
      const item = ordered().find((held) => target instanceof Node && held.contains(target));
      if (item !== undefined) setFocused(item);
    },
    onKeyDown(event: KeyboardEvent) {
      const next = rovingTarget(event, ordered(), {
        orientation: options.orientation(),
        homeEnd: options.homeEnd,
      });
      if (next === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      next.focus();
    },
  };
}
