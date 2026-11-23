import type { KeybindingCommand } from "@t3tools/contracts";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import { useInFlight, useResource } from "treflex-solid";
import type { JSX } from "@solidjs/web";
import {
  createSignal,
  createTrackedEffect,
  For,
  onCleanup,
  onSettled,
  Show,
  untrack,
} from "solid-js";

import Environment from "./Environment";
import {
  ChevronDown,
  ChevronUp,
  Plus,
  RotateCcw,
  Search,
  Square,
  SquareSplitHorizontal,
  SquareSplitVertical,
  SquareTerminal,
  Trash2,
  X,
} from "./icons";
import { resolveShortcutCommand, shortcutLabel, withShortcut } from "./keybindings";
import { useNavigation } from "./navigation";
import Terminal, { endShell, TerminalShell } from "./Terminal";
import { resolveTerminalLinkTarget } from "./terminalLinks";
import { type ITerminalGroup, MAX_TERMINALS_PER_GROUP, shownGroup } from "./terminalLayout";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { ERROR_TEXT } from "./ui/notice";
import { PanelTabCloseButton } from "./ui/PanelTabCloseButton";
import { sheetPopupVariants } from "./ui/Sheet";
import { createMediaQuery, enterPanel, PANEL_SHEET_QUERY } from "./viewport";

const RECONNECTING = new Set(["connecting", "backoff", "offline", "blocked"]);
const RESTARTABLE = new Set(["exited", "closed", "error"]);

// Follows handleBeforeKey in apps/web/src/components/ThreadTerminalDrawer.tsx, less the thread
// jumps treflex doesn't run. Any other key stays with the shell.
const TERMINAL_PASSED_COMMANDS = new Set<KeybindingCommand>([
  "terminal.toggle",
  "terminal.split",
  "terminal.splitVertical",
  "terminal.new",
  "terminal.close",
  "diff.toggle",
  "thread.previous",
  "thread.next",
]);

// Follows MIN_DRAWER_HEIGHT and MAX_DRAWER_HEIGHT_RATIO in apps/web/src/components/ThreadTerminalDrawer.tsx.
const MIN_DRAWER_HEIGHT = 180;
const MAX_DRAWER_HEIGHT_RATIO = 0.75;

const DRAWER_COLUMN =
  "relative z-45 flex min-h-0 min-w-0 flex-none flex-col overflow-hidden border-t border-border/80 bg-(--terminal-background) transition-[translate,opacity] duration-200 ease-in-out data-starting-style:translate-y-2 data-starting-style:opacity-0";

const DRAWER_SHEET = `${sheetPopupVariants({ side: "bottom", surface: "terminal" })} pb-(--safe-bottom)`;

const FLOATING_ACTION =
  "p-1 text-foreground/90 transition-colors hover:bg-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-64 aria-disabled:hover:bg-transparent";
const SIDEBAR_ACTION =
  "inline-flex h-full items-center px-1 text-foreground/90 transition-colors hover:bg-accent/70 not-first:border-l not-first:border-border/70 aria-disabled:cursor-not-allowed aria-disabled:opacity-64 aria-disabled:hover:bg-transparent";

function clampHeight(height: number, max: number): number {
  return Math.min(Math.max(Math.round(height), MIN_DRAWER_HEIGHT), max);
}

/** Room the column leaves above the composer, which overlays the timeline. */
function maxDrawerHeight(column: HTMLElement | null): number {
  const windowCap = Math.max(
    MIN_DRAWER_HEIGHT,
    Math.floor(window.innerHeight * MAX_DRAWER_HEIGHT_RATIO),
  );
  if (column === null) return windowCap;
  const header = column.querySelector<HTMLElement>(":scope > header")?.offsetHeight ?? 0;
  const composer = column.querySelector<HTMLElement>(".composer-lane")?.offsetHeight ?? 0;
  return Math.min(windowCap, Math.max(0, column.clientHeight - header - composer));
}

function ActionButton(props: {
  label: string;
  class: string;
  disabled?: boolean;
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      class={props.class}
      aria-label={props.label}
      aria-disabled={props.disabled === true ? "true" : undefined}
      data-tip={props.label}
      onClick={() => {
        if (props.disabled !== true) props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}

/** The drawer's commands are bound while the terminal has focus. */
function useTerminalShortcut() {
  const navigation = useNavigation();
  return (command: KeybindingCommand) =>
    shortcutLabel(navigation.keybindings(), command, navigator.platform, { terminalFocus: true });
}

export const TerminalPanel = Terminal.provider(() => {
  const terminal = Terminal.use();
  const shortcut = useTerminalShortcut();
  const panelSheet = createMediaQuery(PANEL_SHEET_QUERY);
  const layout = () => terminal.state.Layout;
  const shown = () => shownGroup(layout());
  const hasSidebar = () => layout().TerminalIds.length > 1;
  const groupHeaders = () =>
    layout().Groups.length > 1 || layout().Groups.some((group) => group.TerminalIds.length > 1);
  const splitFull = () => (shown()?.TerminalIds.length ?? 0) >= MAX_TERMINALS_PER_GROUP;
  const activeShell = () => terminal.state.Shells[layout().ActiveTerminalId];
  const [findIn, setFindIn] = createSignal<string | null>(null);

  const splitLabel = (direction: string, command: KeybindingCommand) =>
    splitFull()
      ? `Split Terminal ${direction} (max ${MAX_TERMINALS_PER_GROUP} per group)`
      : withShortcut(`Split Terminal ${direction}`, shortcut(command));
  const actions = (style: string) => (
    <>
      <ActionButton
        class={style}
        label="Find"
        disabled={activeShell() === undefined}
        onClick={() => setFindIn(layout().ActiveTerminalId)}
      >
        <Search class="size-3.25" />
      </ActionButton>
      <ActionButton
        class={style}
        label={splitLabel("Horizontally", "terminal.split")}
        disabled={splitFull()}
        onClick={() => void terminal.addTerminal("horizontal")}
      >
        <SquareSplitHorizontal class="size-3.25" />
      </ActionButton>
      <ActionButton
        class={style}
        label={splitLabel("Vertically", "terminal.splitVertical")}
        disabled={splitFull()}
        onClick={() => void terminal.addTerminal("vertical")}
      >
        <SquareSplitVertical class="size-3.25" />
      </ActionButton>
      <ActionButton
        class={style}
        label={withShortcut("New Terminal", shortcut("terminal.new"))}
        onClick={() => void terminal.addTerminal(null)}
      >
        <Plus class="size-3.25" />
      </ActionButton>
      <Show when={activeShell()}>
        {(shell) => <CloseActiveButton state={shell()} class={style} />}
      </Show>
      <ActionButton
        class={style}
        label={withShortcut("Hide terminal", shortcut("terminal.toggle"))}
        onClick={() => void terminal.closeTerminal()}
      >
        <X class="size-3.25" />
      </ActionButton>
    </>
  );

  let drawer: HTMLElement | undefined;
  const [maxHeight, setMaxHeight] = createSignal(Number.POSITIVE_INFINITY);
  const [dragHeight, setDragHeight] = createSignal<number | null>(null);
  const height = () => clampHeight(dragHeight() ?? terminal.state.Height, maxHeight());
  onSettled(() => {
    const column = drawer?.parentElement ?? null;
    const measure = () => setMaxHeight(maxDrawerHeight(column));
    measure();
    const observer = new ResizeObserver(measure);
    if (column !== null) observer.observe(column);
    const composer = column?.querySelector(".composer-lane");
    if (composer) observer.observe(composer);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  });
  let drag: { pointerId: number; startY: number; startHeight: number } | null = null;
  const onResizeDown = (event: PointerEvent & { currentTarget: HTMLElement }) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, startY: event.clientY, startHeight: height() };
  };
  const onResizeMove = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    event.preventDefault();
    setDragHeight(clampHeight(drag.startHeight + (drag.startY - event.clientY), maxHeight()));
  };
  const onResizeEnd = (event: PointerEvent & { currentTarget: HTMLElement }) => {
    if (drag?.pointerId !== event.pointerId) return;
    const start = drag.startHeight;
    drag = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    const next = dragHeight();
    setDragHeight(null);
    // A drag that ends where it started keeps the stored height, which may be above today's cap.
    if (next !== null && next !== start) void terminal.setTerminalHeight(next);
  };

  return (
    <aside
      ref={(element) => {
        drawer = element;
        enterPanel(element);
      }}
      class={panelSheet() ? DRAWER_SHEET : DRAWER_COLUMN}
      style={panelSheet() ? undefined : { height: `${height()}px` }}
      data-terminal-drawer
    >
      <Show when={!panelSheet()}>
        <div
          class="absolute inset-x-0 top-0 z-20 h-1.5 cursor-row-resize touch-none any-pointer-coarse:h-4"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          onLostPointerCapture={onResizeEnd}
        />
      </Show>
      <Show when={!hasSidebar()}>
        <div class="pointer-events-none absolute top-2 right-2 z-20">
          <div class="pointer-events-auto inline-flex items-center overflow-hidden rounded-md border border-border/80 bg-background shadow-xs *:not-first:border-l *:not-first:border-border/80">
            {actions(FLOATING_ACTION)}
          </div>
        </div>
      </Show>
      <Show when={terminal.state.Error}>
        <p class={`${ERROR_TEXT} flex-none py-1`}>{terminal.state.Error}</p>
      </Show>
      <div
        class={`flex min-h-0 w-full flex-1 bg-(--terminal-background) ${hasSidebar() ? "gap-1.5" : ""}`}
      >
        <div
          class="grid min-h-0 min-w-0 flex-1 overflow-hidden"
          style={
            shown()?.SplitDirection === "vertical"
              ? {
                  "grid-template-rows": `repeat(${shown()?.TerminalIds.length ?? 1}, minmax(0, 1fr))`,
                }
              : {
                  "grid-template-columns": `repeat(${shown()?.TerminalIds.length ?? 1}, minmax(0, 1fr))`,
                }
          }
        >
          <For each={shown()?.TerminalIds ?? []}>
            {(terminalId) => (
              <Show when={terminal.state.Shells[terminalId]}>
                {(shell) => (
                  <ShellPane
                    state={shell()}
                    vertical={shown()?.SplitDirection === "vertical"}
                    active={terminalId === layout().ActiveTerminalId}
                    finding={findIn() === terminalId}
                    onFind={(open) => setFindIn(open ? terminalId : null)}
                    onActivate={() => void terminal.activateShell(terminalId)}
                  />
                )}
              </Show>
            )}
          </For>
        </div>
        <Show when={hasSidebar()}>
          <aside class="flex w-36 min-w-36 flex-col border border-border/70 bg-muted/10">
            <div class="flex h-[22px] items-stretch justify-end border-b border-border/70">
              <div class="inline-flex h-full items-stretch any-pointer-coarse:relative any-pointer-coarse:z-30">
                {actions(SIDEBAR_ACTION)}
              </div>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto px-1 py-1">
              <For each={layout().Groups}>
                {(group) => (
                  <TabGroup
                    group={group}
                    activeId={layout().ActiveTerminalId}
                    header={groupHeaders()}
                    onActivate={(id) => void terminal.activateShell(id)}
                  />
                )}
              </For>
            </div>
          </aside>
        </Show>
      </div>
    </aside>
  );
});

const CloseActiveButton = TerminalShell.provider((props: { class: string }) => {
  const shell = TerminalShell.use();
  const shortcut = useTerminalShortcut();
  const ending = useInFlight(endShell, () => shell.state);
  return (
    <ActionButton
      class={props.class}
      label={withShortcut("Close Terminal", shortcut("terminal.close"))}
      disabled={ending()}
      onClick={() => void shell.endShell()}
    >
      <Trash2 class="size-3.25" />
    </ActionButton>
  );
});

function TabGroup(props: {
  group: ITerminalGroup;
  activeId: string;
  header: boolean;
  onActivate: (terminalId: string) => void;
}) {
  const terminal = Terminal.use();
  const active = () => props.group.TerminalIds.includes(props.activeId);
  const split = () => props.group.TerminalIds.length > 1;
  const label = () =>
    !split() ? "Single" : props.group.SplitDirection === "vertical" ? "Stacked" : "Side by side";
  return (
    <div class="pb-0.5">
      <Show when={props.header}>
        <button
          type="button"
          class={`flex h-[22px] w-full cursor-pointer items-center gap-1 rounded px-1.5 text-2xs ${
            active()
              ? "bg-accent/50 text-foreground"
              : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          }`}
          onClick={() =>
            props.onActivate(active() ? props.activeId : (props.group.TerminalIds[0] ?? ""))
          }
        >
          <Show when={split()} fallback={<Square class="size-3 shrink-0" />}>
            <Show
              when={props.group.SplitDirection === "vertical"}
              fallback={<SquareSplitHorizontal class="size-3 shrink-0" />}
            >
              <SquareSplitVertical class="size-3 shrink-0" />
            </Show>
          </Show>
          <span class="min-w-0 flex-1 truncate text-left">{label()}</span>
          <span class="text-3xs text-muted-foreground/70 tabular-nums">
            {props.group.TerminalIds.length}
          </span>
        </button>
      </Show>
      <div class="flex flex-col gap-0.5">
        <For each={props.group.TerminalIds}>
          {(terminalId) => (
            <Show when={terminal.state.Shells[terminalId]}>
              {(shell) => (
                <TabRow
                  state={shell()}
                  active={terminalId === props.activeId}
                  onActivate={() => props.onActivate(terminalId)}
                />
              )}
            </Show>
          )}
        </For>
      </div>
    </div>
  );
}

const TabRow = TerminalShell.provider((props: { active: boolean; onActivate: () => void }) => {
  const shell = TerminalShell.use();
  const shortcut = useTerminalShortcut();
  const ending = useInFlight(endShell, () => shell.state);
  const label = () => getTerminalLabel(shell.state.TerminalId);
  const closeLabel = () => {
    return withShortcut(`Close ${label()}`, props.active ? shortcut("terminal.close") : null);
  };
  return (
    <div
      class={`group/tab flex h-6 w-full items-center gap-0.5 rounded-md pr-2 pl-1.5 text-xs ${
        props.active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      }`}
    >
      <PanelTabCloseButton
        label={closeLabel()}
        disabled={ending()}
        onClick={() => void shell.endShell()}
      >
        <SquareTerminal class="size-3 shrink-0" />
      </PanelTabCloseButton>
      <button
        type="button"
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left"
        onClick={() => props.onActivate()}
      >
        <span class="truncate">{label()}</span>
      </button>
    </div>
  );
});

const ShellPane = TerminalShell.provider(
  (props: {
    vertical: boolean;
    active: boolean;
    finding: boolean;
    onFind: (open: boolean) => void;
    onActivate: () => void;
  }) => {
    const shell = TerminalShell.use();
    const environment = Environment.use();
    const navigation = useNavigation();
    const live = useResource(() => shell.state, "Terminal/Session");
    const status = () => {
      const held = live.status();
      if (held.State === "ended") return "error";
      if (held.State === "live" && RECONNECTING.has(held.Detail ?? "")) return "reconnecting";
      return shell.state.Status ?? "starting";
    };
    const error = () => {
      const held = live.status();
      return shell.state.Error ?? (held.State === "ended" ? held.Reason : undefined);
    };
    const passKey = (event: KeyboardEvent) => {
      const command = resolveShortcutCommand(
        event,
        navigation.keybindings(),
        { terminalFocus: true, editableFocus: true, composerFocus: false },
        navigator.platform,
      );
      return command !== null && TERMINAL_PASSED_COMMANDS.has(command);
    };
    const openLink = (kind: "url" | "path", text: string) => {
      if (kind === "url") {
        window.open(text, "_blank", "noopener,noreferrer");
        return;
      }
      const launch = shell.state.Launch;
      environment.openInEditor(resolveTerminalLinkTarget(text, launch.Cwd), launch.ProjectRoot);
    };
    const [results, setResults] = createSignal<{ Index: number; Count: number } | null>(null);
    const [host, setHost] = createSignal<HTMLDivElement>();
    createTrackedEffect(() => {
      const view = live.value();
      const element = host();
      if (view === undefined || element === undefined) return;
      onCleanup(
        view.mount(element, {
          focus: untrack(() => shell.state.FocusOnMount),
          passKey,
          openLink,
          openFind: () => props.onFind(true),
          findResults: (index, count) => setResults({ Index: index, Count: count }),
        }),
      );
    });
    createTrackedEffect(() => {
      if (props.finding) return;
      untrack(() => live.value())?.clearFind();
      setResults(null);
    });
    onCleanup(() => {
      if (!props.finding) return;
      live.value()?.clearFind();
      props.onFind(false);
    });
    const closeFind = () => {
      props.onFind(false);
      live.value()?.focus();
    };
    return (
      <div
        class={`relative flex min-h-0 min-w-0 flex-col ${
          props.vertical ? "border-t first:border-t-0" : "border-l first:border-l-0"
        } ${props.active ? "border-border" : "border-border/70"}`}
        onPointerDown={() => {
          if (!props.active) props.onActivate();
        }}
      >
        <Show when={status() !== "running"}>
          <div class="absolute bottom-2 left-3 z-10 flex items-center gap-1.5 rounded-md bg-(--terminal-background) text-[12px] text-muted-foreground">
            <span>{status()}</span>
            <Show when={RESTARTABLE.has(status())}>
              <Button variant="outline" size="xs" onClick={() => void shell.restartShell()}>
                <RotateCcw />
                Restart
              </Button>
            </Show>
          </div>
        </Show>
        <Show when={error()}>
          <p class={`${ERROR_TEXT} flex-none py-1`}>{error()}</p>
        </Show>
        <Show when={props.finding}>
          <FindBar
            results={results()}
            onQuery={(query, direction) => live.value()?.find(query, direction)}
            onClose={closeFind}
          />
        </Show>
        <div
          class="terminal-host min-h-0 flex-1 overflow-hidden bg-(--terminal-background)"
          ref={setHost}
        />
      </div>
    );
  },
);

function FindBar(props: {
  results: { Index: number; Count: number } | null;
  onQuery: (query: string, direction: "typed" | "next" | "previous") => void;
  onClose: () => void;
}) {
  const [query, setQuery] = createSignal("");
  const count = () => {
    const held = props.results;
    if (held === null || query() === "") return "";
    if (held.Count === 0) return "No results";
    return held.Index < 0 ? `${held.Count}+` : `${held.Index + 1} of ${held.Count}`;
  };
  return (
    <div class="absolute right-2 bottom-2 z-20 flex items-center gap-1 rounded-md border border-border/80 bg-background p-1 shadow-xs">
      <Input
        size="compact"
        type="search"
        class="w-44"
        placeholder="Find"
        aria-label="Find in terminal"
        value={query()}
        ref={(element) => queueMicrotask(() => element.focus())}
        onInput={(event) => {
          setQuery(event.currentTarget.value);
          props.onQuery(event.currentTarget.value, "typed");
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            props.onClose();
          } else if (event.key === "Enter") {
            event.preventDefault();
            props.onQuery(query(), event.shiftKey ? "previous" : "next");
          }
        }}
      />
      <span class="min-w-14 text-center text-[11px] text-muted-foreground tabular-nums">
        {count()}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Previous match"
        data-tip="Previous match (Shift+Enter)"
        disabled={query() === ""}
        onClick={() => props.onQuery(query(), "previous")}
      >
        <ChevronUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Next match"
        data-tip="Next match (Enter)"
        disabled={query() === ""}
        onClick={() => props.onQuery(query(), "next")}
      >
        <ChevronDown />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Close find"
        data-tip="Close (Escape)"
        onClick={() => props.onClose()}
      >
        <X />
      </Button>
    </div>
  );
}
