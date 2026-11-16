// @effect-diagnostics globalTimers:off -- A view-only debounce for the file search, outside any Effect runtime.
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

import {
  fileItems,
  type IMenuItem,
  type IMenuTrigger,
  MENU_EMPTY,
  menuTrigger,
  skillItems,
  slashItems,
  stepHighlight,
} from "./composerMenu";
import { File as FileIcon, Folder } from "./icons";
import ThreadSession from "./ThreadSession";

const FILE_SEARCH_DEBOUNCE_MS = 120;

const ICONS = { file: FileIcon, directory: Folder, command: null, skill: null };

/** The `@`, `/` and `$` menu state for one composer, driven by its text and caret. */
export function useComposerMenu(text: () => string, cursor: () => number) {
  const session = ThreadSession.use();
  const trigger = createMemo(() => menuTrigger(text(), cursor()), undefined, {
    equals: (left, right) =>
      left?.kind === right?.kind &&
      left?.query === right?.query &&
      left?.rangeStart === right?.rangeStart &&
      left?.rangeEnd === right?.rangeEnd,
  });
  const [dismissedAt, setDismissedAt] = createSignal<number | null>(null);
  const [highlight, setHighlight] = createSignal(0);
  const open = () => {
    const held = trigger();
    return held !== null && dismissedAt() !== held.rangeStart ? held : null;
  };
  createEffect(
    on(trigger, (held) => {
      setHighlight(0);
      if (held === null || held.rangeStart !== dismissedAt()) setDismissedAt(null);
    }),
  );
  createEffect(() => {
    const held = open();
    if (held?.kind !== "path") return;
    const query = held.query;
    const timer = setTimeout(() => session.searchFiles(query), FILE_SEARCH_DEBOUNCE_MS);
    onCleanup(() => clearTimeout(timer));
  });
  const searching = () => {
    const held = open();
    return held?.kind === "path" && session.fileSearchResult().Query !== held.query;
  };
  const items = createMemo((): IMenuItem[] => {
    const held = open();
    if (held === null) return [];
    if (held.kind === "path") return fileItems(session.fileSearchResult().Entries);
    const catalog = session.menuCatalog();
    return held.kind === "skill"
      ? skillItems(catalog.Skills, held.query)
      : slashItems(catalog.Commands, catalog.Skills, held.query, held.rangeStart === 0);
  });
  return {
    open,
    items,
    searching,
    highlight,
    move: (direction: 1 | -1) =>
      setHighlight((index) => stepHighlight(index, items().length, direction)),
    highlighted: () => items()[Math.min(highlight(), items().length - 1)],
    dismiss: () => setDismissedAt(trigger()?.rangeStart ?? null),
  };
}

export type IComposerMenu = ReturnType<typeof useComposerMenu>;

export function ComposerCommandMenu(props: {
  menu: IComposerMenu;
  trigger: IMenuTrigger;
  onPick: (item: IMenuItem) => void;
}) {
  return (
    <div class="composer-menu" role="listbox" aria-label="Suggestions">
      <Show
        when={props.menu.items().length > 0}
        fallback={
          <p class="composer-menu-empty">
            {props.menu.searching() ? "Searching…" : MENU_EMPTY[props.trigger.kind]}
          </p>
        }
      >
        <For each={props.menu.items()}>
          {(item, index) => {
            const Icon = ICONS[item.Kind];
            return (
              <button
                type="button"
                role="option"
                class="composer-menu-item"
                aria-selected={index() === props.menu.highlight()}
                ref={(element) =>
                  createEffect(() => {
                    if (index() === props.menu.highlight())
                      element.scrollIntoView({ block: "nearest" });
                  })
                }
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => props.onPick(item)}
              >
                <Show when={Icon}>{(Shown) => <Dynamic component={Shown()} />}</Show>
                <span class="composer-menu-label">{item.Label}</span>
                <Show when={item.Description}>
                  <span class="composer-menu-detail">{item.Description}</span>
                </Show>
              </button>
            );
          }}
        </For>
      </Show>
    </div>
  );
}
