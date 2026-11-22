import { useComponentState } from "treflex-solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

import {
  fileItems,
  type IFileSearch,
  type IMenuItem,
  type IMenuTrigger,
  MENU_EMPTY,
  menuTrigger,
  searchFiles,
  skillItems,
  slashItems,
} from "./composerMenu";
import { File as FileIcon, Folder } from "./icons";
import { stepHighlight } from "./listNavigation";
import ThreadSession from "./ThreadSession";

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
  const files = useComponentState<IFileSearch>(() => ({ Query: null, Root: null, Entries: [] }));
  const searching = () => {
    const held = open();
    return held?.kind === "path" && files.state.Query !== held.query;
  };
  const items = createMemo((): IMenuItem[] => {
    const held = open();
    if (held === null) return [];
    if (held.kind === "path") return fileItems(files.state.Entries);
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
      setHighlight((index) => stepHighlight(index, items().length, direction) ?? 0),
    highlighted: () => items()[Math.min(highlight(), items().length - 1)],
    dismiss: () => setDismissedAt(trigger()?.rangeStart ?? null),
    /** Searches for an `@` path at the caret, for the handler that changed the text or caret. */
    search: (text: string, caret: number) => {
      const held = menuTrigger(text, caret);
      if (held?.kind !== "path" || held.rangeStart === dismissedAt()) return;
      void files.dispatch(
        searchFiles,
        session.state.EnvironmentId,
        session.fileSearchRoot(),
        held.query,
      );
    },
  };
}

export type IComposerMenu = ReturnType<typeof useComposerMenu>;

export function ComposerCommandMenu(props: {
  menu: IComposerMenu;
  trigger: IMenuTrigger;
  onPick: (item: IMenuItem) => void;
}) {
  return (
    <div
      class="absolute inset-x-0 bottom-[calc(100%+4px)] z-40 flex max-h-[min(18rem,40dvh)] flex-col overflow-y-auto rounded-xl border border-border bg-popover p-1 text-foreground shadow-[0_10px_25px_-5px_rgb(0_0_0/20%)]"
      role="listbox"
      aria-label="Suggestions"
    >
      <Show
        when={props.menu.items().length > 0}
        fallback={
          <p class="m-0 px-2 py-1.5 text-[13px] text-muted-foreground">
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
                class="flex min-h-[30px] flex-none cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-1 text-left text-[13px] aria-selected:bg-accent [&_svg]:size-3.5 [&_svg]:flex-none [&_svg]:text-muted-foreground"
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
                <span class="max-w-[50%] flex-none truncate">{item.Label}</span>
                <Show when={item.Description}>
                  <span class="min-w-0 truncate text-[12px] text-muted-foreground">
                    {item.Description}
                  </span>
                </Show>
              </button>
            );
          }}
        </For>
      </Show>
    </div>
  );
}
