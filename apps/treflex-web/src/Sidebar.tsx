// @effect-diagnostics globalDate:off globalTimers:off -- A view-only tick for working timers, outside any Effect runtime.
import type { ShownOrder } from "@t3tools/client-runtime/state/thread-search";
import { useResource } from "treflex-solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, splitProps } from "solid-js";

import { T3Mark } from "./brand";
import Environment from "./Environment";
import { ProjectBadge } from "./brand";
import {
  ChevronDown,
  Ellipsis,
  Eye,
  FolderPlus,
  ListFilter,
  PanelLeft,
  Search,
  SquarePen,
  X,
} from "./icons";
import type { IWireThreadShell } from "./Infrastructure/wire";
import { withShortcut } from "./keybindings";
import { useMessageSearch } from "./messageSearch";
import { RENAME_THREAD_EVENT, useNavigation } from "./navigation";
import { groupResults, type ISearchResult, rankMessages, searchThreads } from "./threadSearch";
import { FolderHeader, ProjectMenu, RemoveProjectDialog } from "./ProjectFolder";
import { createListDrag } from "./listDrag";
import { isProjectSort, PROJECT_SORT_LABELS } from "./projectOrder";
import Root from "./Root";
import { arrowStep, stepHighlight } from "./listNavigation";
import Shell, { isBusy, sidebarStatus } from "./Shell";
import { SidebarFooter } from "./SidebarFooter";
import { StageArt } from "./StageArt";
import { type ICardSection, ThreadCard, ThreadMenu } from "./ThreadCard";
import { modelDisplay } from "./ThreadSession";
import { Button } from "./ui/Button";
import { CollapsibleSectionHeader } from "./ui/CollapsibleSectionHeader";
import {
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemDetail,
  MenuItemLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  openMenuFromKeys,
} from "./ui/Menu";
import { Presence } from "./ui/Presence";
import { SidebarInput, SidebarMenuButton } from "./ui/Sidebar";
import { useSidebarSheet } from "./viewport";

const CONNECTION_LABEL: Record<string, string> = {
  connected: "connected",
  connecting: "reconnecting",
  backoff: "reconnecting",
  offline: "offline",
  blocked: "can't connect",
  available: "connecting",
};

const SECOND = 1_000;
const searchResultId = (threadId: string) => `sidebar-search-result-${threadId}`;

// The sheet and collapse states are classes App.tsx sets on the layout around the sidebar.
const SIDEBAR =
  "flex h-full min-h-0 flex-col border-r border-sidebar-border bg-sidebar bg-(image:--surface-grain) bg-size-[256px_256px] text-sidebar-foreground in-[.sidebar-collapsed]:hidden in-[.sidebar-sheet]:absolute in-[.sidebar-sheet]:top-[env(safe-area-inset-top)] in-[.sidebar-sheet]:bottom-0 in-[.sidebar-sheet]:left-0 in-[.sidebar-sheet]:z-50 pl-[env(safe-area-inset-left)] in-[.sidebar-sheet]:w-[calc(100vw-12px)] in-[.sidebar-sheet:not(.sidebar-open)]:invisible in-[.sidebar-sheet:not(.sidebar-open)]:[transform:translateX(-100%)] in-[.sidebar-sheet:not(.sidebar-open)]:[transition:transform_0.2s_ease-in-out,visibility_0s_linear_0.2s] in-[.sidebar-open]:shadow-[0_8px_24px_rgb(0_0_0/12%)] in-[.sidebar-open]:[transition:transform_0.2s_ease-in-out]";
const STAGE_FADE =
  "after:bg-[linear-gradient(to_bottom,transparent_0%,transparent_28%,color-mix(in_srgb,var(--sidebar)_10%,transparent)_40%,color-mix(in_srgb,var(--sidebar)_30%,transparent)_52%,color-mix(in_srgb,var(--sidebar)_58%,transparent)_64%,color-mix(in_srgb,var(--sidebar)_82%,transparent)_75%,color-mix(in_srgb,var(--sidebar)_96%,transparent)_85%,var(--sidebar)_93%)]";
const THREAD_LIST =
  "relative m-0 flex min-h-0 flex-1 list-none flex-col gap-[5px] overflow-y-auto px-2 pt-0.5 pb-[calc(8px+var(--safe-bottom))] [scrollbar-width:none]";
const FOLDER_GROUP = "list-none [[data-folder-group]+&]:mt-3";
// Each row after the header hangs off a guide line under the folder's chevron, reaching up into
// the rows' gap so it reads as one line; a pinned row draws it as a green bar, kept to its own row.
const FOLDER_ROWS =
  "m-0 flex list-none flex-col gap-[5px] p-0 [&>li+li]:relative [&>li+li]:pl-3.5 [&>li+li]:before:absolute [&>li+li]:before:-top-[5px] [&>li+li]:before:bottom-0 [&>li+li]:before:left-3 [&>li+li]:before:w-px [&>li+li]:before:bg-sidebar-border [&>li:has(>[data-pinned])]:before:top-0 [&>li:has(>[data-pinned])]:before:left-[11px] [&>li:has(>[data-pinned])]:before:w-[3px] [&>li:has(>[data-pinned])]:before:rounded-[2px] [&>li:has(>[data-pinned])]:before:bg-success";
const DRAG_GHOST =
  "pointer-events-none fixed top-0 left-0 z-140 flex max-w-64 items-center gap-1.5 rounded-md border border-border bg-popover px-2.5 py-1 text-[13px] font-medium whitespace-nowrap text-foreground shadow-[0_10px_25px_-5px_rgb(0_0_0/20%)]";
const SIDEBAR_ERROR = "mx-[18px] mt-0 mb-2 text-[12px] text-error-foreground";
const COUNT = "ml-auto tabular-nums";

function SectionHeader(props: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li class="relative mx-0.5 mt-2 h-8">
      <CollapsibleSectionHeader
        expanded={props.open}
        onClick={() => props.onToggle()}
        accessory={<span class="font-normal tabular-nums">{props.count}</span>}
      >
        {props.label}
      </CollapsibleSectionHeader>
    </li>
  );
}

function SidebarHeaderButton(props: Parameters<typeof SidebarMenuButton>[0]) {
  const [local, rest] = splitProps(props, ["children", "size"]);
  return (
    <SidebarMenuButton size={local.size ?? "icon-sm"} class="relative shrink-0" {...rest}>
      {local.children}
      <span
        aria-hidden
        class="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
      />
    </SidebarMenuButton>
  );
}

/**
 * In the sidebar it closes the sheet or collapses the column; in a page header it brings the
 * sidebar back, so it shows there only while the sidebar is away.
 */
export function SidebarToggle(props: { inSidebar?: boolean }) {
  const sidebar = useSidebarSheet();
  const navigation = useNavigation();
  const shown = () => (props.inSidebar === true ? true : sidebar.sheet() || sidebar.collapsed());
  return (
    <Show when={shown()}>
      <Button
        variant={props.inSidebar === true ? "media-navigation-inline" : "ghost"}
        size="icon-titlebar"
        class={props.inSidebar === true ? "mr-2 -ml-1" : undefined}
        aria-label="Toggle main sidebar"
        data-tip={withShortcut("Toggle sidebar", navigation.shortcut("sidebar.toggle"))}
        data-tip-side="bottom"
        aria-expanded={sidebar.sheet() ? sidebar.open() : !sidebar.collapsed()}
        onClick={() => sidebar.toggle()}
      >
        <PanelLeft class="size-4" />
      </Button>
    </Show>
  );
}

export const Sidebar = Shell.provider(() => {
  const root = Root.use();
  const environment = Environment.use();
  const shell = Shell.use();
  const navigation = useNavigation();
  const selected = () => shell.sidebarRowThreadId();
  const providers = () => environment.state.Replica.Providers;
  const stream = useResource(() => shell.state, "Shell/Stream");
  const connection = () => {
    const status = stream.status();
    if (status.State !== "live") return status.State;
    const label = CONNECTION_LABEL[status.Detail ?? "connected"] ?? status.Detail;
    return label === "connected" && !shell.shellSynchronized() ? "syncing" : label;
  };
  const endedReason = () => {
    const status = stream.status();
    return status.State === "ended" ? status.Reason : null;
  };
  const local = () => environment.state.Local;
  const preferences = () => local().Preferences;
  const layout = createMemo(() => environment.sidebarLayout());
  const now = () => environment.minute();
  const [second, setSecond] = createSignal(Date.now());
  const hiddenProjects = createMemo(() => new Set(preferences().HiddenProjects));
  const hiddenList = () =>
    Object.values(shell.state.Projects)
      .filter((project) => hiddenProjects().has(project.id))
      .sort((left, right) => left.title.localeCompare(right.title));
  const [moreMenu, setMoreMenu] = createSignal<HTMLElement | null>(null);
  const projects = () =>
    environment.activeProjects().filter((project) => !hiddenProjects().has(project.id));
  const scope = createMemo(() => new Set(layout().Scope));
  const [scopeMenu, setScopeMenu] = createSignal<HTMLElement | null>(null);
  const scopeLabel = () => {
    const held = [...scope()];
    if (held.length === 0) return "All projects";
    if (held.length === 1) return shell.state.Projects[held[0]!]?.title ?? "1 project";
    return `${held.length} projects`;
  };
  const visibleThreads = () => layout().Visible;
  const anyWorking = createMemo(() =>
    visibleThreads().some((thread) =>
      isBusy(sidebarStatus(thread, shell.subagentRequests()[thread.id])),
    ),
  );
  createEffect(() => {
    if (!anyWorking()) return;
    setSecond(Date.now());
    const ticking = setInterval(() => setSecond(Date.now()), SECOND);
    onCleanup(() => clearInterval(ticking));
  });
  const sections = () => layout().Sections;
  const shelves = () => local().Shelves;
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const onRenameRequest = (event: Event) => setRenaming((event as CustomEvent<string>).detail);
  window.addEventListener(RENAME_THREAD_EVENT, onRenameRequest);
  onCleanup(() => window.removeEventListener(RENAME_THREAD_EVENT, onRenameRequest));
  const [menu, setMenu] = createSignal<{ Id: string; X: number; Y: number } | null>(null);
  const menuThread = () => {
    const held = menu();
    return held === null ? undefined : shell.state.Threads[held.Id];
  };
  const grouped = () => preferences().GroupByProject;
  const closedFolders = createMemo(() => new Set(preferences().ClosedFolders));
  const projectSort = () => preferences().ProjectSort;
  const folders = createMemo(
    () => new Map(layout().Folders.map((folder) => [folder.ProjectId, folder])),
  );
  const [list, setList] = createSignal<HTMLElement>();
  const drag = createListDrag({
    list,
    blocks: (held) => [...held.querySelectorAll<HTMLElement>("[data-folder-id]")],
    idOf: (block) => block.dataset.folderId!,
    anchorOf: (block) => block.querySelector("[data-folder-header]"),
    onDrop: (_, order) => void environment.setPreferences({ ProjectOrder: order }),
  });
  const pinDrag = createListDrag({
    list,
    blocks: (held, threadId) =>
      [...held.querySelectorAll<HTMLElement>("[data-pin-id]")].filter(
        (block) => block.dataset.pinFolder === shell.state.Threads[threadId]?.projectId,
      ),
    idOf: (block) => block.dataset.pinId!,
    onDrop: (threadId, order) => void environment.reorderPin(threadId, order),
  });
  const draggedPin = () => shell.state.Threads[pinDrag.dragging() ?? ""];
  const dropLine = () => {
    const top = drag.lineTop() ?? pinDrag.lineTop();
    return top === null ? null : { Top: top };
  };
  const [removingProject, setRemovingProject] = createSignal<string | null>(null);
  const [renamingProject, setRenamingProject] = createSignal<string | null>(null);
  const [projectMenu, setProjectMenu] = createSignal<{ Id: string; X: number; Y: number } | null>(
    null,
  );
  const menuProject = () => {
    const held = projectMenu();
    return held === null ? undefined : shell.state.Projects[held.Id];
  };
  const shelf = (threads: IWireThreadShell[], open: boolean, limit = Infinity) =>
    open ? threads.slice(0, limit) : threads.filter((thread) => thread.id === selected());
  const targetProject = () => environment.currentProjectId() ?? projects()[0]?.id ?? null;

  const [query, setQuery] = createSignal("");
  const searching = () => query().trim().length > 0;
  const messageSearch = useMessageSearch(query);
  let shownMessages: ShownOrder | null = null;
  const messageOrder = createMemo(() => {
    if (messageSearch.matches().length === 0) return [];
    shownMessages = rankMessages({
      threads: visibleThreads(),
      environmentId: environment.state.EnvironmentId,
      query: messageSearch.query(),
      matches: messageSearch.matches(),
      shown: shownMessages,
      now: now(),
    });
    return shownMessages.keys;
  });
  const resultGroups = createMemo(() =>
    searching()
      ? groupResults(
          searchThreads({
            threads: visibleThreads(),
            environmentId: environment.state.EnvironmentId,
            query: query(),
            messages: messageSearch.matches(),
            messageOrder: messageOrder(),
            now: now(),
          }),
          grouped() ? [...folders().keys()] : null,
        )
      : [],
  );
  const results = createMemo(() => resultGroups().flatMap((group) => group.Results));
  const [highlightId, setHighlightId] = createSignal<string | null>(null);
  // The highlight follows its thread, so rows that arrive late don't move it under Enter.
  const highlightIndex = () =>
    Math.max(
      0,
      results().findIndex((result) => result.Thread.id === highlightId()),
    );
  const sectionOf = (thread: IWireThreadShell): ICardSection => {
    const held = sections();
    if (held.Snoozed.includes(thread)) return "snoozed";
    if (held.Settled.includes(thread)) return "settled";
    if (held.Pinned.includes(thread)) return "pinned";
    return "active";
  };
  const clearSearch = () => {
    setQuery("");
    setHighlightId(null);
  };
  const chooseResult = (threadId: string) => {
    clearSearch();
    navigation.goToThread(threadId);
  };
  const onSearchKey = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape" && searching()) {
      event.preventDefault();
      event.stopPropagation();
      clearSearch();
      return;
    }
    const count = results().length;
    if (count === 0) return;
    const step = arrowStep(event.key);
    if (step !== null) {
      event.preventDefault();
      const next = results()[stepHighlight(highlightIndex(), count, step)!]!;
      setHighlightId(next.Thread.id);
      document.getElementById(searchResultId(next.Thread.id))?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = results()[highlightIndex()];
      if (result !== undefined) chooseResult(result.Thread.id);
    }
  };
  // A provider icon only tells threads apart once more than one provider is in use.
  const mixedProviders = createMemo(
    () =>
      new Set(
        visibleThreads().map((thread) => modelDisplay(providers(), thread.modelSelection).Driver),
      ).size > 1,
  );
  const card = (
    thread: IWireThreadShell,
    section: ICardSection,
    compact = false,
    search?: ISearchResult,
    inFolder = false,
  ) => (
    <ThreadCard
      onDragStart={
        inFolder && thread.pinnedAt != null
          ? (event) =>
              pinDrag.begin(event, thread.id, (x, y) => setMenu({ Id: thread.id, X: x, Y: y }))
          : undefined
      }
      dragging={pinDrag.dragging() === thread.id}
      search={
        search && {
          ranges: search.Ranges,
          snippet: search.Match?.snippet ?? null,
          query: messageSearch.query(),
          highlighted: results()[highlightIndex()]?.Thread.id === thread.id,
          id: searchResultId(thread.id),
          onSelect: () => chooseResult(thread.id),
          onHover: () => setHighlightId(thread.id),
        }
      }
      thread={thread}
      section={section}
      compact={compact}
      showProvider={mixedProviders()}
      renaming={renaming() === thread.id}
      second={second()}
      onMenu={(x, y) => setMenu({ Id: thread.id, X: x, Y: y })}
      onRenameEnd={() => setRenaming(null)}
    />
  );
  return (
    <nav class={SIDEBAR} data-sidebar>
      <header class="relative flex h-(--workspace-topbar-height) flex-none items-center px-3">
        <div
          class={`pointer-events-none absolute top-0 right-0 left-[calc(-1*env(safe-area-inset-left))] h-20 overflow-hidden [mask-image:linear-gradient(to_bottom,black_0%,black_55%,transparent_92%)] after:absolute after:inset-0 after:content-[''] ${STAGE_FADE}`}
        >
          <StageArt />
        </div>
        <SidebarToggle inSidebar />
        <span class="relative inline-flex items-baseline gap-1 text-[14px] font-medium tracking-tight text-white">
          <T3Mark />
          <span class="text-[rgb(255_255_255/70%)]">Code</span>
        </span>
        <Show when={connection() !== "connected"}>
          <span class="relative ml-auto text-[12px] font-medium text-white">{connection()}</span>
        </Show>
      </header>
      <div class="relative flex flex-none items-center gap-0.5 px-2 pt-1 pb-2">
        <div class="relative mr-0.5 flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pr-1 pl-2 text-sidebar-muted-foreground focus-within:bg-sidebar-row-hover focus-within:text-sidebar-foreground focus-within:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ring)_70%,transparent)] hover:bg-sidebar-row-hover hover:text-sidebar-foreground [&>svg]:size-4">
          <Search />
          <SidebarInput
            class="min-w-0 flex-1"
            type="search"
            placeholder="Search"
            aria-label="Search threads"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={searching() && results().length > 0}
            aria-controls={searching() ? "sidebar-search-results" : undefined}
            aria-activedescendant={
              searching() && results().length > 0
                ? searchResultId(results()[highlightIndex()]!.Thread.id)
                : undefined
            }
            spellcheck={false}
            autocomplete="off"
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              messageSearch.search(event.currentTarget.value);
              setHighlightId(null);
            }}
            onKeyDown={onSearchKey}
          />
          <Show when={searching()}>
            <Button
              variant="ghost-muted"
              size="icon-micro"
              aria-label="Clear thread search"
              data-tip="Clear search"
              onMouseDown={(event) => event.preventDefault()}
              onClick={clearSearch}
            >
              <X class="size-3" />
            </Button>
          </Show>
        </div>
        <SidebarHeaderButton
          isActive={scope().size > 0}
          aria-label="Filter projects"
          data-tip={`Projects: ${scopeLabel()}`}
          aria-haspopup="menu"
          aria-expanded="false"
          onClick={(event) => {
            const trigger = event.currentTarget;
            setScopeMenu((held) => (held === null ? trigger : null));
          }}
          onKeyDown={(event) => {
            const trigger = event.currentTarget;
            openMenuFromKeys(event, () => setScopeMenu(trigger));
          }}
        >
          <ListFilter />
        </SidebarHeaderButton>
        <SidebarHeaderButton
          aria-label="Add project"
          data-tip="Add project"
          aria-pressed={navigation.palette() === "add-project"}
          onClick={() => navigation.setPalette("add-project")}
        >
          <FolderPlus />
        </SidebarHeaderButton>
        <Show when={targetProject()}>
          {(projectId) => (
            <SidebarHeaderButton
              aria-label="New thread"
              data-tip={withShortcut("New thread", navigation.shortcut("chat.new"))}
              onClick={() => environment.newThread(projectId())}
            >
              <SquarePen />
            </SidebarHeaderButton>
          )}
        </Show>
        <Show when={projects().length > 1}>
          <SidebarHeaderButton
            size="icon-sm-narrow"
            aria-label="New thread in project"
            data-tip="New thread in project"
            aria-pressed={navigation.palette() === "new-thread-in"}
            onClick={() => navigation.setPalette("new-thread-in")}
          >
            <ChevronDown class="size-3.5" />
          </SidebarHeaderButton>
        </Show>
        <SidebarHeaderButton
          size="icon-sm-narrow"
          aria-label="More sidebar options"
          data-tip="More options"
          aria-haspopup="menu"
          aria-expanded="false"
          onClick={(event) => {
            const trigger = event.currentTarget;
            setMoreMenu((held) => (held === null ? trigger : null));
          }}
          onKeyDown={(event) => {
            const trigger = event.currentTarget;
            openMenuFromKeys(event, () => setMoreMenu(trigger));
          }}
        >
          <Ellipsis />
        </SidebarHeaderButton>
      </div>
      <Presence when={scopeMenu()}>
        {(anchor) => (
          <MenuPopup anchor={anchor()} align="start" onClose={() => setScopeMenu(null)}>
            <MenuCheckboxItem
              checked={scope().size === 0}
              closeOnClick
              onClick={() => void environment.toggleProjectScope(null)}
            >
              All projects
            </MenuCheckboxItem>
            <For
              each={[...projects()].sort((left, right) => left.title.localeCompare(right.title))}
            >
              {(project) => (
                <MenuCheckboxItem
                  checked={scope().has(project.id)}
                  onClick={() => void environment.toggleProjectScope(project.id)}
                >
                  {project.title}
                </MenuCheckboxItem>
              )}
            </For>
          </MenuPopup>
        )}
      </Presence>
      <Presence when={moreMenu()}>
        {(anchor) => (
          <MenuPopup anchor={anchor()} align="start" onClose={() => setMoreMenu(null)}>
            <MenuCheckboxItem
              checked={grouped()}
              onCheckedChange={(checked) =>
                void environment.setPreferences({ GroupByProject: checked })
              }
            >
              Group by project
            </MenuCheckboxItem>
            <Show when={grouped()}>
              <MenuSeparator />
              <MenuGroup>
                <MenuGroupLabel>Sort projects</MenuGroupLabel>
                <MenuRadioGroup
                  value={projectSort()}
                  onValueChange={(value) => {
                    if (isProjectSort(value))
                      void environment.setPreferences({ ProjectSort: value });
                  }}
                >
                  <For each={Object.entries(PROJECT_SORT_LABELS)}>
                    {([value, label]) => <MenuRadioItem value={value}>{label}</MenuRadioItem>}
                  </For>
                </MenuRadioGroup>
              </MenuGroup>
            </Show>
            <Show when={hiddenList().length > 0}>
              <MenuSeparator />
              <MenuGroup>
                <MenuGroupLabel>Hidden projects</MenuGroupLabel>
                <For each={hiddenList()}>
                  {(project) => (
                    <MenuItem
                      closeOnClick={false}
                      onClick={() => void environment.setProjectHidden(project.id, false)}
                    >
                      <Eye />
                      <MenuItemLabel>{project.title}</MenuItemLabel>
                      <MenuItemDetail>Show</MenuItemDetail>
                    </MenuItem>
                  )}
                </For>
              </MenuGroup>
            </Show>
          </MenuPopup>
        )}
      </Presence>
      <Show when={endedReason()}>
        {(reason) => <p class={SIDEBAR_ERROR}>The shell stream ended: {reason()}</p>}
      </Show>
      <Show when={root.state.Failure}>
        {(failure) => (
          <p class={SIDEBAR_ERROR}>
            That didn't work: {failure()}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss"
              data-tip="Dismiss"
              onClick={() => root.dismissFailure()}
            >
              <X />
            </Button>
          </p>
        )}
      </Show>
      <Show when={searching()}>
        <Show
          when={results().length > 0}
          fallback={
            <p class="px-2 py-6 text-center text-xs text-sidebar-muted-foreground" role="status">
              {messageSearch.pending()
                ? "Searching thread messages…"
                : messageSearch.failed()
                  ? "Couldn't search thread messages"
                  : "No threads found"}
            </p>
          }
        >
          <ul
            class={THREAD_LIST}
            id="sidebar-search-results"
            role="listbox"
            data-tip-group
            data-tip-delay="150"
            aria-label="Thread search results"
          >
            <For each={resultGroups()}>
              {(group) => (
                <Show
                  when={group.ProjectId}
                  fallback={
                    <For each={group.Results}>
                      {(result) => card(result.Thread, sectionOf(result.Thread), false, result)}
                    </For>
                  }
                >
                  {(projectId) => (
                    <li class={FOLDER_GROUP} role="presentation" data-folder-group>
                      <ul class={FOLDER_ROWS} role="presentation">
                        <li
                          class="flex h-7 items-center gap-1.5 px-1.5 text-[13px] font-semibold text-sidebar-foreground"
                          role="presentation"
                        >
                          <ProjectBadge project={shell.state.Projects[projectId()]} size={12} />
                          <span class="truncate">
                            {shell.state.Projects[projectId()]?.title ?? "Unknown project"}
                          </span>
                          <span class={COUNT}>{group.Results.length}</span>
                        </li>
                        <For each={group.Results}>
                          {(result) => card(result.Thread, sectionOf(result.Thread), true, result)}
                        </For>
                      </ul>
                    </li>
                  )}
                </Show>
              )}
            </For>
          </ul>
        </Show>
      </Show>
      <Show
        when={!searching() && (visibleThreads().length > 0 || folders().size > 0)}
        fallback={
          <Show when={!searching()}>
            <p class="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
              {!shell.shellSynchronized()
                ? "Loading threads…"
                : scope().size > 0
                  ? "No threads in these projects yet"
                  : "No threads yet"}
            </p>
          </Show>
        }
      >
        <ul class={THREAD_LIST} ref={setList} data-tip-group data-tip-delay="150">
          <For each={sections().Pinned}>{(thread) => card(thread, "pinned")}</For>
          <Show
            when={
              sections().Pinned.length > 0 &&
              (grouped() ? folders().size > 0 : sections().Active.length > 0)
            }
          >
            <li class="mx-2.5 my-1 border-t border-sidebar-border" />
          </Show>
          <Show
            when={grouped()}
            fallback={<For each={sections().Active}>{(thread) => card(thread, "active")}</For>}
          >
            <For each={[...folders().keys()]}>
              {(projectId) => {
                const folder = () => folders().get(projectId)!;
                return (
                  <li
                    class={`${FOLDER_GROUP} data-dragging:opacity-40`}
                    data-folder-group
                    data-dragging={drag.dragging() === projectId ? "" : undefined}
                    data-folder-id={projectId}
                  >
                    <ul class={FOLDER_ROWS}>
                      <FolderHeader
                        folder={folder()}
                        open={!closedFolders().has(projectId)}
                        renaming={renamingProject() === projectId}
                        draggable={projectSort() === "manual"}
                        onDragStart={(event) =>
                          drag.begin(event, projectId, (x, y) =>
                            setProjectMenu({ Id: projectId, X: x, Y: y }),
                          )
                        }
                        onToggle={() => void environment.toggleFolder(projectId)}
                        onMenu={(x, y) => setProjectMenu({ Id: projectId, X: x, Y: y })}
                        onRenamed={(title) => {
                          setRenamingProject(null);
                          const trimmed = title?.trim();
                          if (trimmed && trimmed !== folder().Project?.title) {
                            environment.projectCommand(projectId, {
                              Kind: "rename",
                              Title: trimmed,
                            });
                          }
                        }}
                      />
                      <For
                        each={
                          closedFolders().has(projectId)
                            ? folder().Threads.filter((thread) => thread.id === selected())
                            : folder().Threads
                        }
                      >
                        {(thread) => card(thread, "active", true, undefined, true)}
                      </For>
                    </ul>
                  </li>
                );
              }}
            </For>
            <Show when={dropLine()}>
              {(line) => (
                <li
                  class="pointer-events-none absolute right-3 left-3 h-0.5 list-none rounded-[1px] bg-primary"
                  style={{ top: `${line().Top}px` }}
                  aria-hidden="true"
                />
              )}
            </Show>
          </Show>
          <Show when={sections().Pinned.length === 0 && sections().Active.length === 0}>
            <li class="list-none px-2.5 py-2 text-[14px] text-muted-foreground">All clear.</li>
          </Show>
          <Show when={sections().Snoozed.length > 0}>
            <SectionHeader
              label="Snoozed"
              count={sections().Snoozed.length}
              open={shelves().SnoozedOpen}
              onToggle={() => void environment.toggleShelf("Snoozed")}
            />
            <For each={shelf(sections().Snoozed, shelves().SnoozedOpen)}>
              {(thread) => card(thread, "snoozed")}
            </For>
          </Show>
          <Show when={sections().Settled.length > 0}>
            <SectionHeader
              label="Settled"
              count={sections().Settled.length}
              open={shelves().SettledOpen}
              onToggle={() => void environment.toggleShelf("Settled")}
            />
            <For each={shelf(sections().Settled, shelves().SettledOpen, shelves().SettledShown)}>
              {(thread) => card(thread, "settled")}
            </For>
            <Show
              when={shelves().SettledOpen && sections().Settled.length > shelves().SettledShown}
            >
              <li>
                <button
                  type="button"
                  class="cursor-pointer border-0 bg-transparent px-2.5 py-1 text-[12px] text-sidebar-muted-foreground hover:text-sidebar-foreground"
                  onClick={() => void environment.showMoreSettled()}
                >
                  Show more
                </button>
              </li>
            </Show>
          </Show>
        </ul>
      </Show>
      <Presence when={menuThread() === undefined ? undefined : menu()} keyed>
        {(held) => {
          const at = held();
          const thread = shell.state.Threads[at.Id]!;
          return (
            <ThreadMenu
              thread={thread}
              x={at.X}
              y={at.Y}
              onRename={() => setRenaming(thread.id)}
              onClose={() => setMenu(null)}
            />
          );
        }}
      </Presence>
      <Presence when={menuProject() === undefined ? undefined : projectMenu()} keyed>
        {(held) => {
          const at = held();
          const project = shell.state.Projects[at.Id]!;
          return (
            <ProjectMenu
              project={project}
              x={at.X}
              y={at.Y}
              onRename={() => setRenamingProject(project.id)}
              onRemove={() => setRemovingProject(project.id)}
              onHide={() => void environment.setProjectHidden(project.id, true)}
              onClose={() => setProjectMenu(null)}
            />
          );
        }}
      </Presence>
      <Presence when={shell.state.Projects[removingProject() ?? ""]} keyed>
        {(project) => (
          <RemoveProjectDialog project={project()} onClose={() => setRemovingProject(null)} />
        )}
      </Presence>
      <Show when={folders().get(drag.dragging() ?? "")} keyed>
        {(folder) => (
          <div class={DRAG_GHOST} ref={drag.setGhost} aria-hidden="true">
            <ProjectBadge project={folder.Project} size={12} />
            <span>{folder.Project?.title ?? "Unknown project"}</span>
          </div>
        )}
      </Show>
      <Show when={draggedPin()} keyed>
        {(thread) => (
          <div class={DRAG_GHOST} ref={pinDrag.setGhost} aria-hidden="true">
            <span class="truncate">{thread.title}</span>
          </div>
        )}
      </Show>
      <SidebarFooter />
    </nav>
  );
});
