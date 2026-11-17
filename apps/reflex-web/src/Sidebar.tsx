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
import { useNavigation } from "./navigation";
import { groupResults, type ISearchResult, rankMessages, searchThreads } from "./threadSearch";
import { FolderHeader, ProjectMenu, RemoveProjectDialog } from "./ProjectFolder";
import { createProjectDrag } from "./projectDrag";
import { isProjectSort, PROJECT_SORT_LABELS } from "./projectOrder";
import Root from "./Root";
import { arrowStep, stepHighlight } from "./listNavigation";
import { MenuItem, Popup } from "./Menu";
import Shell, { isBusy, sidebarStatus } from "./Shell";
import { SidebarFooter } from "./SidebarFooter";
import { StageArt } from "./StageArt";
import { type ICardSection, ThreadCard, ThreadMenu } from "./ThreadCard";
import { modelDisplay } from "./ThreadSession";
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
  const local = () => environment.state.Local;
  const preferences = () => local().Preferences;
  const layout = createMemo(() => environment.sidebarLayout());
  const now = () => local().Now;
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
                void environment.toggleProjectScope(null);
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
                  onSelect={() => void environment.toggleProjectScope(project.id)}
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
              onSelect={() => void environment.setPreferences({ GroupByProject: !grouped() })}
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
                      if (isProjectSort(value))
                        void environment.setPreferences({ ProjectSort: value });
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
                    onSelect={() => void environment.setProjectHidden(project.id, false)}
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
                  class="section-more"
                  onClick={() => void environment.showMoreSettled()}
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
            onHide={() => void environment.setProjectHidden(project.id, true)}
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
      <SidebarFooter />
    </nav>
  );
});
