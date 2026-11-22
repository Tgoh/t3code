// @effect-diagnostics globalDate:off globalTimers:off -- A view-only tick for working timers, outside any Effect runtime.
import type { ShownOrder } from "@t3tools/client-runtime/state/thread-search";
import { useResource } from "treflex-solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";

import { T3Mark } from "./brand";
import Environment from "./Environment";
import { ProjectBadge } from "./brand";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Eye,
  EyeOff,
  FolderPlus,
  Folders,
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
import { createProjectDrag } from "./projectDrag";
import { isProjectSort, PROJECT_SORT_LABELS } from "./projectOrder";
import Root from "./Root";
import { arrowStep, stepHighlight } from "./listNavigation";
import Shell, { isBusy, sidebarStatus } from "./Shell";
import { SidebarFooter } from "./SidebarFooter";
import { StageArt } from "./StageArt";
import { type ICardSection, ThreadCard, ThreadMenu } from "./ThreadCard";
import { modelDisplay } from "./ThreadSession";
import { IconButton, iconButton } from "./ui/IconButton";
import { MenuCheck, MenuHeading, MenuItem, Popup } from "./ui/Menu";
import { EMPTY_NOTE } from "./ui/notes";
import { Presence } from "./ui/Presence";
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
// the rows' gap so it reads as one line; the main thread's row draws it as a green bar.
const FOLDER_ROWS =
  "m-0 flex list-none flex-col gap-[5px] p-0 [&>li+li]:relative [&>li+li]:pl-3.5 [&>li+li]:before:absolute [&>li+li]:before:-top-[5px] [&>li+li]:before:bottom-0 [&>li+li]:before:left-3 [&>li+li]:before:w-px [&>li+li]:before:bg-sidebar-border [&>li:has(>[data-main])]:before:top-0 [&>li:has(>[data-main])]:before:left-[11px] [&>li:has(>[data-main])]:before:w-[3px] [&>li:has(>[data-main])]:before:rounded-[2px] [&>li:has(>[data-main])]:before:bg-success";
const SIDEBAR_ERROR = "mx-[18px] mt-0 mb-2 text-[12px] text-error-foreground";
const COUNT = "ml-auto tabular-nums";

function SectionHeader(props: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        class="mt-2 flex h-7 w-full cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-0 text-[12px] font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        <ChevronRight class={props.open ? "size-3.5 rotate-90" : "size-3.5"} />
        {props.label}
        <span class={COUNT}>{props.count}</span>
      </button>
    </li>
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
      <IconButton
        variant={props.inSidebar === true ? "brand" : "ghost"}
        class={props.inSidebar === true ? "relative mr-2 -ml-1" : undefined}
        aria-label="Toggle main sidebar"
        data-tip={withShortcut("Toggle sidebar", navigation.shortcut("sidebar.toggle"))}
        aria-expanded={sidebar.sheet() ? sidebar.open() : !sidebar.collapsed()}
        onClick={() => sidebar.toggle()}
      >
        <PanelLeft />
      </IconButton>
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
  const providerName = (instanceId: string) =>
    providers().find((provider) => provider.InstanceId === instanceId)?.Name ?? instanceId;
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
  const [moreMenu, setMoreMenu] = createSignal<{ X: number; Y: number } | null>(null);
  const projects = () =>
    Object.values(shell.state.Projects).filter(
      (project) => project.archivedAt == null && !hiddenProjects().has(project.id),
    );
  const scope = createMemo(() => new Set(layout().Scope));
  const [scopeMenu, setScopeMenu] = createSignal<{ X: number; Y: number } | null>(null);
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
  const drag = createProjectDrag({
    list,
    order: () => [...folders().keys()],
    onDrop: (order) => void environment.setPreferences({ ProjectOrder: order }),
  });
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
  ) => (
    <ThreadCard
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
      projectName={shell.state.Projects[thread.projectId]?.title ?? "Unknown project"}
      model={modelDisplay(providers(), thread.modelSelection)}
      previousProviders={(thread.providerInstanceHistory ?? [])
        .filter((instanceId) => instanceId !== thread.modelSelection.instanceId)
        .map(providerName)}
      selected={selected() === thread.id}
      renaming={renaming() === thread.id}
      now={now()}
      second={second()}
      onMenu={(x, y) => setMenu({ Id: thread.id, X: x, Y: y })}
      onRenamed={(title) => {
        setRenaming(null);
        const trimmed = title?.trim();
        if (trimmed && trimmed !== thread.title) {
          environment.threadCommand(thread.id, { Kind: "rename", Title: trimmed });
        }
      }}
    />
  );
  return (
    <nav class={SIDEBAR} data-sidebar>
      <header class="relative flex h-(--topbar-height) flex-none items-center px-3">
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
          <input
            class="min-w-0 flex-1 border-0 bg-transparent px-0.5 py-px text-[14px] font-medium text-sidebar-foreground outline-none placeholder:text-sidebar-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
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
            <IconButton
              variant="sidebar-field"
              size="sm"
              aria-label="Clear thread search"
              data-tip="Clear search"
              onMouseDown={(event) => event.preventDefault()}
              onClick={clearSearch}
            >
              <X />
            </IconButton>
          </Show>
        </div>
        <IconButton
          variant="sidebar"
          pressed={scope().size > 0}
          aria-label="Filter projects"
          data-tip={`Projects: ${scopeLabel()}`}
          aria-expanded={scopeMenu() !== null}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setScopeMenu({ X: box.left, Y: box.bottom + 4 });
          }}
        >
          <ListFilter />
        </IconButton>
        <IconButton
          variant="sidebar"
          aria-label="Add project"
          data-tip="Add project"
          aria-pressed={navigation.palette() === "add-project"}
          onClick={() => navigation.setPalette("add-project")}
        >
          <FolderPlus />
        </IconButton>
        <Show when={targetProject()}>
          {(projectId) => (
            <IconButton
              variant="sidebar"
              aria-label="New thread"
              data-tip={withShortcut("New thread", navigation.shortcut("chat.new"))}
              onClick={() => environment.newThread(projectId())}
            >
              <SquarePen />
            </IconButton>
          )}
        </Show>
        <Show when={projects().length > 1}>
          {/* A native select stretched invisibly over the icon, which keeps the native popup. */}
          <label
            class={`${iconButton("sidebar", "narrow")} relative has-[select:focus-visible]:outline-2 has-[select:focus-visible]:-outline-offset-2 has-[select:focus-visible]:outline-ring [&_svg]:size-3.5`}
            data-tip="New thread in project"
          >
            <ChevronDown />
            <select
              class="absolute inset-0 w-full cursor-pointer opacity-0"
              aria-label="New thread in project"
              value=""
              onChange={(event) => {
                environment.newThread(event.currentTarget.value);
                event.currentTarget.value = "";
              }}
            >
              <option value="" disabled>
                New thread in…
              </option>
              <For each={projects()}>
                {(project) => <option value={project.id}>{project.title}</option>}
              </For>
            </select>
          </label>
        </Show>
        <IconButton
          variant="sidebar"
          size="narrow"
          aria-label="More sidebar options"
          data-tip="More options"
          aria-expanded={moreMenu() !== null}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setMoreMenu({ X: box.left, Y: box.bottom + 4 });
          }}
        >
          <Ellipsis />
        </IconButton>
      </div>
      <Presence when={scopeMenu()}>
        {(at) => (
          <Popup x={at().X} y={at().Y} label="Filter projects" onClose={() => setScopeMenu(null)}>
            <MenuItem
              icon={<MenuCheck on={scope().size === 0} />}
              label="All projects"
              onSelect={() => {
                void environment.toggleProjectScope(null);
                setScopeMenu(null);
              }}
            />
            <For
              each={[...projects()].sort((left, right) => left.title.localeCompare(right.title))}
            >
              {(project) => (
                <MenuItem
                  icon={<MenuCheck on={scope().has(project.id)} />}
                  label={project.title}
                  onSelect={() => void environment.toggleProjectScope(project.id)}
                />
              )}
            </For>
          </Popup>
        )}
      </Presence>
      <Presence when={moreMenu()}>
        {(at) => (
          <Popup
            x={at().X}
            y={at().Y}
            label="More sidebar options"
            onClose={() => setMoreMenu(null)}
          >
            <MenuItem
              icon={grouped() ? <Check /> : <Folders />}
              label="Group by project"
              onSelect={() => void environment.setPreferences({ GroupByProject: !grouped() })}
            />
            <Show when={grouped()}>
              <MenuHeading>
                <ArrowUpDown />
                Sort projects
              </MenuHeading>
              <For each={Object.entries(PROJECT_SORT_LABELS)}>
                {([value, label]) => (
                  <MenuItem
                    icon={<MenuCheck on={projectSort() === value} />}
                    label={label}
                    onSelect={() => {
                      if (isProjectSort(value))
                        void environment.setPreferences({ ProjectSort: value });
                    }}
                  />
                )}
              </For>
            </Show>
            <Show when={hiddenList().length > 0}>
              <MenuHeading>
                <EyeOff />
                Hidden projects
              </MenuHeading>
              <For each={hiddenList()}>
                {(project) => (
                  <MenuItem
                    icon={<Eye />}
                    label={project.title}
                    detail="Show"
                    onSelect={() => void environment.setProjectHidden(project.id, false)}
                  />
                )}
              </For>
            </Show>
          </Popup>
        )}
      </Presence>
      <Show when={endedReason()}>
        {(reason) => <p class={SIDEBAR_ERROR}>The shell stream ended: {reason()}</p>}
      </Show>
      <Show when={root.state.Failure}>
        {(failure) => (
          <p class={SIDEBAR_ERROR}>
            That didn't work: {failure()}
            <IconButton
              size="sm"
              aria-label="Dismiss"
              data-tip="Dismiss"
              onClick={() => root.dismissFailure()}
            >
              <X />
            </IconButton>
          </p>
        )}
      </Show>
      <Show when={searching()}>
        <Show
          when={results().length > 0}
          fallback={
            <p class={EMPTY_NOTE} role="status">
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
            <p class={EMPTY_NOTE}>
              {!shell.shellSynchronized()
                ? "Loading threads…"
                : scope().size > 0
                  ? "No threads in these projects."
                  : "No threads yet."}
            </p>
          </Show>
        }
      >
        <ul class={THREAD_LIST} ref={setList}>
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
                        onDragStart={(event) => drag.begin(event, projectId)}
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
                        {(thread) => card(thread, "active", true)}
                      </For>
                    </ul>
                  </li>
                );
              }}
            </For>
            <Show when={drag.lineTop() !== null}>
              <li
                class="pointer-events-none absolute right-3 left-3 h-0.5 list-none rounded-[1px] bg-primary"
                style={{ top: `${drag.lineTop()}px` }}
                aria-hidden="true"
              />
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
      <Presence when={menuThread()} keyed>
        {(held) => {
          const thread = held();
          return (
            <ThreadMenu
              thread={thread}
              x={menu()?.X ?? 0}
              y={menu()?.Y ?? 0}
              now={now()}
              onRename={() => setRenaming(thread.id)}
              onClose={() => setMenu(null)}
            />
          );
        }}
      </Presence>
      <Presence when={menuProject()} keyed>
        {(held) => {
          const project = held();
          return (
            <ProjectMenu
              project={project}
              x={projectMenu()?.X ?? 0}
              y={projectMenu()?.Y ?? 0}
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
          <div
            class="pointer-events-none fixed top-0 left-0 z-140 flex max-w-64 items-center gap-1.5 rounded-md border border-border bg-popover px-2.5 py-1 text-[13px] font-medium whitespace-nowrap text-foreground shadow-[0_10px_25px_-5px_rgb(0_0_0/20%)]"
            ref={drag.setGhost}
            aria-hidden="true"
          >
            <ProjectBadge project={folder.Project} size={12} />
            <span>{folder.Project?.title ?? "Unknown project"}</span>
          </div>
        )}
      </Show>
      <SidebarFooter />
    </nav>
  );
});
