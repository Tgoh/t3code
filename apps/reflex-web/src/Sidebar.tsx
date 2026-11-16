// @effect-diagnostics globalDate:off globalTimers:off -- View-only ticks for relative times, outside any Effect runtime.
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
import { useNavigation } from "./navigation";
import { readStored, readStoredIds, writeStored } from "./storage";
import {
  groupResults,
  type ISearchResult,
  liveScope,
  rankMessages,
  scopeThreads,
  searchThreads,
} from "./threadSearch";
import { FolderHeader, ProjectMenu, RemoveProjectDialog } from "./ProjectFolder";
import { createProjectDrag } from "./projectDrag";
import {
  type IProjectSort,
  isProjectSort,
  orderFolders,
  PROJECT_SORT_LABELS,
} from "./projectOrder";
import Root from "./Root";
import { MenuItem, Popup } from "./Menu";
import Shell, {
  isBusy,
  projectFolders,
  sidebarSections,
  sidebarStatus,
  unhiddenThreads,
} from "./Shell";
import { StageArt } from "./StageArt";
import { type ICardSection, ThreadCard, ThreadMenu } from "./ThreadCard";
import { modelDisplay } from "./ThreadSession";
import { MINUTE } from "./timestamps";
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
const SETTLED_PAGE = 25;

const GROUP_KEY = "reflex-web:group-by-project";
const CLOSED_FOLDERS_KEY = "reflex-web:closed-folders";
const PROJECT_SORT_KEY = "reflex-web:project-sort";
const PROJECT_ORDER_KEY = "reflex-web:project-order";
const HIDDEN_PROJECTS_KEY = "reflex-web:hidden-projects";
const PROJECT_SCOPE_KEY = "reflex-web:project-scope";
const searchResultId = (threadId: string) => `sidebar-search-result-${threadId}`;

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
        class="section-header"
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        <ChevronRight class="section-chevron" classList={{ open: props.open }} />
        {props.label}
        <span class="section-count">{props.count}</span>
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
      <button
        class="icon-button sidebar-toggle"
        aria-label="Toggle main sidebar"
        data-tip={withShortcut("Toggle sidebar", navigation.shortcut("sidebar.toggle"))}
        aria-expanded={sidebar.sheet() ? sidebar.open() : !sidebar.collapsed()}
        onClick={() => sidebar.toggle()}
      >
        <PanelLeft />
      </button>
    </Show>
  );
}

export const Sidebar = Shell.provider(() => {
  const root = Root.use();
  const environment = Environment.use();
  const shell = Shell.use();
  const navigation = useNavigation();
  const selected = () => environment.state.Local.SelectedThreadId;
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
  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), MINUTE);
  onCleanup(() => clearInterval(tick));
  const [second, setSecond] = createSignal(Date.now());
  const [hiddenProjects, setHiddenProjects] = createSignal(
    new Set(readStoredIds(HIDDEN_PROJECTS_KEY)),
  );
  const setProjectHidden = (projectId: string, hide: boolean) => {
    const next = new Set(hiddenProjects());
    if (hide) next.add(projectId);
    else next.delete(projectId);
    setHiddenProjects(next);
    writeStored(HIDDEN_PROJECTS_KEY, [...next]);
  };
  const hiddenList = () =>
    Object.values(shell.state.Projects)
      .filter((project) => hiddenProjects().has(project.id))
      .sort((left, right) => left.title.localeCompare(right.title));
  const [moreMenu, setMoreMenu] = createSignal<{ X: number; Y: number } | null>(null);
  const projects = () =>
    Object.values(shell.state.Projects).filter(
      (project) => project.archivedAt == null && !hiddenProjects().has(project.id),
    );
  const [storedScope, setStoredScope] = createSignal(
    new Set(readStoredIds(PROJECT_SCOPE_KEY)) as ReadonlySet<string>,
  );
  const scope = createMemo(() =>
    liveScope(storedScope(), new Set(projects().map((project) => project.id))),
  );
  const setScope = (next: ReadonlySet<string>) => {
    setStoredScope(next);
    writeStored(PROJECT_SCOPE_KEY, [...next]);
  };
  const [scopeMenu, setScopeMenu] = createSignal<{ X: number; Y: number } | null>(null);
  const scopeLabel = () => {
    const held = [...scope()];
    if (held.length === 0) return "All projects";
    if (held.length === 1) return shell.state.Projects[held[0]!]?.title ?? "1 project";
    return `${held.length} projects`;
  };
  const visibleThreads = createMemo(() =>
    scopeThreads(
      unhiddenThreads(shell.sidebarThreads(), hiddenProjects(), selected()),
      scope(),
      selected(),
    ),
  );
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
  const sections = createMemo(() =>
    sidebarSections(visibleThreads(), now(), shell.subagentRequests()),
  );
  const [snoozedOpen, setSnoozedOpen] = createSignal(false);
  const [settledOpen, setSettledOpen] = createSignal(false);
  const [settledShown, setSettledShown] = createSignal(SETTLED_PAGE);
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [menu, setMenu] = createSignal<{ Id: string; X: number; Y: number } | null>(null);
  const menuThread = () => {
    const held = menu();
    return held === null ? undefined : shell.state.Threads[held.Id];
  };
  const [grouped, setGrouped] = createSignal(readStored(GROUP_KEY, true));
  const [closedFolders, setClosedFolders] = createSignal(
    new Set(readStored<string[]>(CLOSED_FOLDERS_KEY, [])),
  );
  const toggleFolder = (projectId: string) => {
    const next = new Set(closedFolders());
    if (!next.delete(projectId)) next.add(projectId);
    setClosedFolders(next);
    writeStored(CLOSED_FOLDERS_KEY, [...next]);
  };
  const storedSort = readStored<unknown>(PROJECT_SORT_KEY, "manual");
  const [projectSort, setProjectSort] = createSignal<IProjectSort>(
    isProjectSort(storedSort) ? storedSort : "manual",
  );
  const [projectOrder, setProjectOrder] = createSignal(readStoredIds(PROJECT_ORDER_KEY));
  const folders = createMemo(
    () =>
      new Map(
        grouped()
          ? orderFolders(
              projectFolders(sections().Active, shell.state.Projects, hiddenProjects()).filter(
                (folder) =>
                  scope().size === 0 || scope().has(folder.ProjectId) || folder.Threads.length > 0,
              ),
              projectSort(),
              projectOrder(),
              visibleThreads(),
            ).map((folder) => [folder.ProjectId, folder])
          : [],
      ),
  );
  const [list, setList] = createSignal<HTMLElement>();
  const drag = createProjectDrag({
    list,
    order: () => [...folders().keys()],
    onDrop: (order) => {
      setProjectOrder(order);
      writeStored(PROJECT_ORDER_KEY, order);
    },
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
  // A collapsed shelf still shows the open thread, so its row doesn't vanish on settling it.
  const shelf = (threads: IWireThreadShell[], open: boolean, limit = Infinity) =>
    open ? threads.slice(0, limit) : threads.filter((thread) => thread.id === selected());
  const targetProject = () => environment.currentProjectId() ?? projects()[0]?.id ?? null;
  const folderThreads = (projectId: string) => {
    const threads = folders().get(projectId)?.Threads ?? [];
    return closedFolders().has(projectId)
      ? threads.filter((thread) => thread.id === selected())
      : threads;
  };
  const threadOrder = createMemo(() =>
    [
      ...sections().Pinned,
      ...(grouped() ? [...folders().keys()].flatMap(folderThreads) : sections().Active),
      ...shelf(sections().Snoozed, snoozedOpen()),
      ...shelf(sections().Settled, settledOpen(), settledShown()),
    ].map((thread) => thread.id),
  );
  navigation.setThreadOrder(threadOrder);

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
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = results()[(highlightIndex() + step + count) % count]!;
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
    <nav class="sidebar">
      <header class="sidebar-brand">
        <div class="sidebar-stage">
          <StageArt />
        </div>
        <SidebarToggle inSidebar />
        <span class="brand-mark">
          <T3Mark />
          <span>Code</span>
        </span>
        <Show when={connection() !== "connected"}>
          <span class="connection">{connection()}</span>
        </Show>
      </header>
      <div class="sidebar-header-row">
        <div class="sidebar-search">
          <Search />
          <input
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
              setHighlightId(null);
            }}
            onKeyDown={onSearchKey}
          />
          <Show when={searching()}>
            <button
              type="button"
              class="icon-button small"
              aria-label="Clear thread search"
              data-tip="Clear search"
              onMouseDown={(event) => event.preventDefault()}
              onClick={clearSearch}
            >
              <X />
            </button>
          </Show>
        </div>
        <button
          type="button"
          class="icon-button"
          classList={{ pressed: scope().size > 0 }}
          aria-label="Filter projects"
          data-tip={`Projects: ${scopeLabel()}`}
          aria-expanded={scopeMenu() !== null}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setScopeMenu({ X: box.left, Y: box.bottom + 4 });
          }}
        >
          <ListFilter />
        </button>
        <button
          class="icon-button"
          aria-label="Add project"
          data-tip="Add project"
          aria-pressed={navigation.palette() === "add-project"}
          onClick={() => navigation.setPalette("add-project")}
        >
          <FolderPlus />
        </button>
        <Show when={targetProject()}>
          {(projectId) => (
            <button
              class="icon-button"
              aria-label="New thread"
              data-tip={withShortcut("New thread", navigation.shortcut("chat.new"))}
              onClick={() => environment.newThread(projectId())}
            >
              <SquarePen />
            </button>
          )}
        </Show>
        <Show when={projects().length > 1}>
          <label class="icon-button picker-overlay narrow" data-tip="New thread in project">
            <ChevronDown />
            <select
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
        <button
          class="icon-button narrow"
          aria-label="More sidebar options"
          data-tip="More options"
          aria-expanded={moreMenu() !== null}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setMoreMenu({ X: box.left, Y: box.bottom + 4 });
          }}
        >
          <Ellipsis />
        </button>
      </div>
      <Show when={scopeMenu()}>
        {(at) => (
          <Popup x={at().X} y={at().Y} label="Filter projects" onClose={() => setScopeMenu(null)}>
            <MenuItem
              icon={scope().size === 0 ? <Check /> : <span class="menu-check" />}
              label="All projects"
              onSelect={() => {
                setScope(new Set());
                setScopeMenu(null);
              }}
            />
            <For
              each={[...projects()].sort((left, right) => left.title.localeCompare(right.title))}
            >
              {(project) => (
                <MenuItem
                  icon={scope().has(project.id) ? <Check /> : <span class="menu-check" />}
                  label={project.title}
                  onSelect={() => {
                    const next = new Set(scope());
                    if (!next.delete(project.id)) next.add(project.id);
                    setScope(next);
                  }}
                />
              )}
            </For>
          </Popup>
        )}
      </Show>
      <Show when={moreMenu()}>
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
              onSelect={() => {
                setGrouped(!grouped());
                writeStored(GROUP_KEY, grouped());
              }}
            />
            <Show when={grouped()}>
              <p class="menu-heading">
                <ArrowUpDown />
                Sort projects
              </p>
              <For each={Object.entries(PROJECT_SORT_LABELS)}>
                {([value, label]) => (
                  <MenuItem
                    icon={projectSort() === value ? <Check /> : <span class="menu-check" />}
                    label={label}
                    onSelect={() => {
                      if (!isProjectSort(value)) return;
                      setProjectSort(value);
                      writeStored(PROJECT_SORT_KEY, value);
                    }}
                  />
                )}
              </For>
            </Show>
            <Show when={hiddenList().length > 0}>
              <p class="menu-heading">
                <EyeOff />
                Hidden projects
              </p>
              <For each={hiddenList()}>
                {(project) => (
                  <MenuItem
                    icon={<Eye />}
                    label={project.title}
                    detail="Show"
                    onSelect={() => setProjectHidden(project.id, false)}
                  />
                )}
              </For>
            </Show>
          </Popup>
        )}
      </Show>
      <Show when={endedReason()}>
        {(reason) => <p class="sidebar-error">The shell stream ended: {reason()}</p>}
      </Show>
      <Show when={root.state.Failure}>
        {(failure) => (
          <p class="sidebar-error">
            That didn't work: {failure()}
            <button
              class="icon-button small"
              aria-label="Dismiss"
              data-tip="Dismiss"
              onClick={() => root.dismissFailure()}
            >
              <X />
            </button>
          </p>
        )}
      </Show>
      <Show when={searching()}>
        <Show
          when={results().length > 0}
          fallback={
            <p class="empty" role="status">
              {messageSearch.pending() ? "Searching thread messages…" : "No threads found"}
            </p>
          }
        >
          <ul
            class="thread-list"
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
                    <li class="folder-group" role="presentation">
                      <ul class="folder-rows" role="presentation">
                        <li class="search-folder" role="presentation">
                          <ProjectBadge project={shell.state.Projects[projectId()]} size={12} />
                          <span class="folder-title">
                            {shell.state.Projects[projectId()]?.title ?? "Unknown project"}
                          </span>
                          <span class="section-count">{group.Results.length}</span>
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
            <p class="empty">
              {!shell.shellSynchronized()
                ? "Loading threads…"
                : scope().size > 0
                  ? "No threads in these projects."
                  : "No threads yet."}
            </p>
          </Show>
        }
      >
        <ul class="thread-list" ref={setList}>
          <For each={sections().Pinned}>{(thread) => card(thread, "pinned")}</For>
          <Show
            when={
              sections().Pinned.length > 0 &&
              (grouped() ? folders().size > 0 : sections().Active.length > 0)
            }
          >
            <li class="section-divider" />
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
                    class="folder-group"
                    classList={{ dragging: drag.dragging() === projectId }}
                    data-folder-id={projectId}
                  >
                    <ul class="folder-rows">
                      <FolderHeader
                        folder={folder()}
                        open={!closedFolders().has(projectId)}
                        renaming={renamingProject() === projectId}
                        draggable={projectSort() === "manual"}
                        onDragStart={(event) => drag.begin(event, projectId)}
                        onToggle={() => toggleFolder(projectId)}
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
                class="folder-drop-line"
                style={{ top: `${drag.lineTop()}px` }}
                aria-hidden="true"
              />
            </Show>
          </Show>
          <Show when={sections().Pinned.length === 0 && sections().Active.length === 0}>
            <li class="empty inbox-clear">All clear.</li>
          </Show>
          <Show when={sections().Snoozed.length > 0}>
            <SectionHeader
              label="Snoozed"
              count={sections().Snoozed.length}
              open={snoozedOpen()}
              onToggle={() => setSnoozedOpen((held) => !held)}
            />
            <For each={shelf(sections().Snoozed, snoozedOpen())}>
              {(thread) => card(thread, "snoozed")}
            </For>
          </Show>
          <Show when={sections().Settled.length > 0}>
            <SectionHeader
              label="Settled"
              count={sections().Settled.length}
              open={settledOpen()}
              onToggle={() => setSettledOpen((held) => !held)}
            />
            <For each={shelf(sections().Settled, settledOpen(), settledShown())}>
              {(thread) => card(thread, "settled")}
            </For>
            <Show when={settledOpen() && sections().Settled.length > settledShown()}>
              <li>
                <button
                  type="button"
                  class="section-more"
                  onClick={() => setSettledShown((held) => held + SETTLED_PAGE)}
                >
                  Show more
                </button>
              </li>
            </Show>
          </Show>
        </ul>
      </Show>
      <Show when={menuThread()} keyed>
        {(thread) => (
          <ThreadMenu
            thread={thread}
            x={menu()?.X ?? 0}
            y={menu()?.Y ?? 0}
            now={now()}
            onRename={() => setRenaming(thread.id)}
            onClose={() => setMenu(null)}
          />
        )}
      </Show>
      <Show when={menuProject()} keyed>
        {(project) => (
          <ProjectMenu
            project={project}
            x={projectMenu()?.X ?? 0}
            y={projectMenu()?.Y ?? 0}
            onRename={() => setRenamingProject(project.id)}
            onRemove={() => setRemovingProject(project.id)}
            onHide={() => setProjectHidden(project.id, true)}
            onClose={() => setProjectMenu(null)}
          />
        )}
      </Show>
      <Show when={shell.state.Projects[removingProject() ?? ""]} keyed>
        {(project) => (
          <RemoveProjectDialog project={project} onClose={() => setRemovingProject(null)} />
        )}
      </Show>
      <Show when={folders().get(drag.dragging() ?? "")} keyed>
        {(folder) => (
          <div class="folder-ghost" ref={drag.setGhost} aria-hidden="true">
            <ProjectBadge project={folder.Project} size={12} />
            <span>{folder.Project?.title ?? "Unknown project"}</span>
          </div>
        )}
      </Show>
    </nav>
  );
});
