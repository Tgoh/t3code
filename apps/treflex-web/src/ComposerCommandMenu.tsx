import { useComponentState } from "treflex-solid";
import { Dynamic } from "@solidjs/web";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

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
import { CommandGroup, CommandItem, CommandList } from "./ui/Command";

const ICONS = { file: FileIcon, directory: Folder, command: null, skill: null };

/** The `@`, `/` and `$` menu state for one composer, driven by its text and caret. */
export function useComposerMenu(text: () => string, cursor: () => number) {
  const session = ThreadSession.use();
  const trigger = createMemo(() => menuTrigger(text(), cursor()), {
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
  createEffect(trigger, (held) => {
    setHighlight(0);
    if (held === null || held.rangeStart !== dismissedAt()) setDismissedAt(null);
  });
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
    highlightAt: (index: number) => setHighlight(index),
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

const LISTBOX_LABEL: Record<IMenuTrigger["kind"], string> = {
  path: "Files and folders",
  "slash-command": "Commands",
  skill: "Skills",
};

export function ComposerCommandMenu(props: {
  menu: IComposerMenu;
  trigger: IMenuTrigger;
  onPick: (item: IMenuItem) => void;
}) {
  return (
    <div class="absolute inset-x-0 bottom-[calc(100%+4px)] z-40 flex max-h-[min(18rem,40dvh)] min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-popover text-foreground shadow-[0_10px_25px_-5px_rgb(0_0_0/20%)] **:data-[slot=command-item]:rounded-lg">
      <Show
        when={props.menu.items().length > 0}
        fallback={
          <div class="px-5 pt-3.5 pb-7">
            <p class="text-secondary-label text-xs">
              {props.menu.searching()
                ? "Searching workspace files..."
                : MENU_EMPTY[props.trigger.kind]}
            </p>
          </div>
        }
      >
        <CommandList
          aria-label={LISTBOX_LABEL[props.trigger.kind]}
          class="max-h-72 min-h-0 scroll-pb-6"
        >
          <CommandGroup>
            <For each={props.menu.items()}>
              {(item, index) => {
                const Icon = ICONS[item.Kind];
                const active = () => index() === props.menu.highlight();
                let row: HTMLElement | undefined;
                createEffect(active, (isActive) => {
                  if (isActive) row?.scrollIntoView({ block: "nearest" });
                });
                return (
                  <CommandItem
                    active={active()}
                    aria-selected={active() ? "true" : "false"}
                    ref={(element) => (row = element)}
                    onMouseMove={() => {
                      if (!active()) props.menu.highlightAt(index());
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => props.onPick(item)}
                  >
                    <Show when={Icon}>
                      {(Shown) => (
                        <Dynamic
                          component={Shown()}
                          aria-hidden="true"
                          class="size-4 shrink-0 text-secondary-label"
                        />
                      )}
                    </Show>
                    <span class="flex min-w-0 flex-1 items-center gap-2">
                      <span class="min-w-0 max-w-[45%] shrink-0 truncate font-sans text-xs font-medium">
                        {item.Label}
                      </span>
                      <span class="min-w-0 flex-1 truncate text-left text-secondary-label text-xs">
                        {item.Description}
                      </span>
                    </span>
                  </CommandItem>
                );
              }}
            </For>
          </CommandGroup>
        </CommandList>
      </Show>
    </div>
  );
}
