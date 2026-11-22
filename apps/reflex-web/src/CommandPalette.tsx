// @effect-diagnostics globalDate:off -- Ranking samples the clock once, when the palette opens.
import { getLatestThreadForProject } from "@t3tools/client-runtime/state/thread-sort";
import { findSearchTokenRanges } from "@t3tools/shared/paletteSearch";
import { createEffect, createMemo, createSignal, For, type JSX, on, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";

import {
  filterPalette,
  type IPaletteGroup,
  type IPaletteIcon,
  type IPaletteItem,
  paletteRows,
  rootGroups,
} from "./paletteRanking";
import { ProjectBadge, ProviderIcon } from "./brand";
import Environment from "./Environment";
import { arrowStep, stepHighlight } from "./listNavigation";
import { Highlighted } from "./Highlighted";
import { Folder, FolderGit2 } from "./icons";
import { MARK, STATUS_LABEL, STATUS_TONE } from "./ThreadCard";
import { modelDisplay } from "./ThreadSession";
import {
  ArrowLeft,
  FolderOpen,
  FolderPlus,
  MessageSquare,
  PenLine,
  Search,
  SquarePen,
} from "./icons";
import type { IWireThreadShell } from "./Infrastructure/wire";
import { useMessageSearch } from "./messageSearch";
import { toSortableThread } from "./projectOrder";
import { type IPaletteView, useNavigation } from "./navigation";
import Shell, { activityAt, isSnoozed, sidebarStatus } from "./Shell";
import { rankMessages, threadSubject } from "./threadSearch";
import { relativeTime } from "./timestamps";
import {
  PALETTE,
  PALETTE_ADDON,
  PALETTE_BACK,
  PALETTE_BACKDROP,
  PALETTE_FOOTER,
  PALETTE_GROUP,
  PALETTE_HINT,
  PALETTE_INPUT,
  PALETTE_INPUT_ROW,
  PALETTE_KBD,
  PALETTE_LIST,
  PALETTE_NOTE,
  PALETTE_ROW,
  PALETTE_ROW_DETAIL,
  PALETTE_ROW_TEXT,
  PALETTE_ROW_TITLE,
} from "./ui/palette";

const META_TEXT = "min-w-0 truncate";

const ICONS: Record<IPaletteIcon, () => JSX.Element> = {
  "new-thread": () => <SquarePen />,
  "add-project": () => <FolderPlus />,
  project: () => <FolderOpen />,
  thread: () => <MessageSquare />,
  focus: () => <Search />,
  rename: () => <PenLine />,
};

const NEW_THREAD_IN = "action:new-thread-in";

// Follows CommandPalette in apps/web/src/components/CommandPalette.tsx: actions, recent threads,
// and, for a query, ranked actions, threads, projects and message matches.
export const CommandPalette = Shell.provider((props: { view: IPaletteView }) => {
  const environment = Environment.use();
  const shell = Shell.use();
  const navigation = useNavigation();
  const now = Date.now();
  const close = () => navigation.setPalette(null);

  const projects = createMemo(() =>
    Object.values(shell.state.Projects)
      .filter((project) => project.archivedAt == null)
      .sort((left, right) => left.title.localeCompare(right.title)),
  );
  const projectTitle = (projectId: string) => shell.state.Projects[projectId]?.title ?? null;
  const threads = createMemo(() =>
    shell.sidebarThreads().filter((thread) => thread.archivedAt == null),
  );
  const selected = () => environment.state.Local.SelectedThreadId;

  const runs = new Map<string, () => void>();
  const keepsOpen = new Set<string>();
  const run = (value: string, action: () => void, keepOpen = false) => {
    runs.set(value, action);
    if (keepOpen) keepsOpen.add(value);
  };

  const openProject = (projectId: string) => {
    const at = now;
    const openable = threads().filter(
      (thread) =>
        thread.settledOverride !== "settled" &&
        !isSnoozed(thread, at, shell.subagentRequests()[thread.id]),
    );
    const latest = getLatestThreadForProject(
      openable.map(toSortableThread),
      shell.state.Projects[projectId]!.id,
      "updated_at",
    );
    if (latest) navigation.goToThread(latest.id);
    else environment.newThread(projectId);
  };

  const threadItem = (thread: IWireThreadShell): IPaletteItem => {
    const title = projectTitle(thread.projectId);
    const current = thread.id === selected();
    const value = `thread:${thread.id}`;
    run(value, () => navigation.goToThread(thread.id, query().trim() || undefined));
    const activity = activityAt(thread);
    return {
      Value: value,
      Title: thread.title,
      SearchTerms: [thread.title],
      Thread: threadSubject(thread, environment.state.EnvironmentId, title),
      ThreadId: thread.id,
      Icon: "thread",
      ...(activity === null ? {} : { Timestamp: relativeTime(activity, now) }),
      ...(current ? { Secondary: true } : {}),
    };
  };
  const threadItems = createMemo(() => threads().map(threadItem));

  const projectItems = createMemo(() =>
    projects().map((project): IPaletteItem => {
      const value = `project:${project.id}`;
      run(value, () => openProject(project.id));
      return {
        Value: value,
        Title: project.title,
        Description: project.workspaceRoot,
        SearchTerms: [project.title, project.workspaceRoot],
        Icon: "project",
      };
    }),
  );
  const newThreadInItems = createMemo(() =>
    projects().map((project): IPaletteItem => {
      const value = `new-thread-in:${project.id}`;
      run(value, () => environment.newThread(project.id));
      return {
        Value: value,
        Title: project.title,
        Description: project.workspaceRoot,
        SearchTerms: [project.title, project.workspaceRoot],
        Icon: "project",
        ...(project.id === environment.currentProjectId() ? { Shortcut: "chat.newLocal" } : {}),
      };
    }),
  );
  const newThreadInGroups = (): IPaletteGroup[] => [
    { Value: "new-thread-in", Label: "Projects", Items: newThreadInItems() },
  ];

  const actionItems = createMemo((): IPaletteItem[] => {
    const items: IPaletteItem[] = [];
    const target = environment.currentProjectId();
    const targetTitle = target === null ? null : projectTitle(target);
    if (target !== null && targetTitle !== null) {
      run("action:new-thread", () => environment.newThread(target));
      items.push({
        Value: "action:new-thread",
        Title: `New thread in ${targetTitle}`,
        Emphasis: targetTitle,
        SearchTerms: ["new thread", "chat", "create", "draft"],
        Icon: "new-thread",
        Shortcut: "chat.newLocal",
      });
    }
    if (projects().length > 0) {
      items.push({
        Value: NEW_THREAD_IN,
        Title: "New thread in...",
        SearchTerms: ["new thread", "project", "pick", "choose", "select"],
        Icon: "new-thread",
        Submenu: newThreadInGroups(),
      });
    }
    run("action:add-project", () => navigation.setPalette("add-project"), true);
    items.push({
      Value: "action:add-project",
      Title: "Add project",
      SearchTerms: [
        "add project",
        "folder",
        "directory",
        "browse",
        "clone",
        "remote",
        "repository",
        "repo",
        "git",
        "url",
      ],
      Icon: "add-project",
    });
    if (shell.state.Threads[selected() ?? ""] !== undefined) {
      run("action:rename-thread", () => navigation.renameThread());
      items.push({
        Value: "action:rename-thread",
        Title: "Rename thread",
        SearchTerms: ["rename", "title", "thread"],
        Icon: "rename",
        Shortcut: "thread.rename",
      });
    }
    run("action:search-threads", () => navigation.focusSearch());
    items.push({
      Value: "action:search-threads",
      Title: "Search threads",
      SearchTerms: ["search", "find", "filter", "threads", "sidebar"],
      Icon: "focus",
    });
    return items;
  });

  const [stack, setStack] = createSignal<Array<{ Item: IPaletteItem; ParentQuery: string }>>(
    props.view === "new-thread-in"
      ? [
          {
            Item: {
              Value: NEW_THREAD_IN,
              Title: "New thread in...",
              SearchTerms: [],
              Icon: "new-thread",
            },
            ParentQuery: "",
          },
        ]
      : [],
  );
  const submenu = () => stack().at(-1) ?? null;
  const [query, setQuery] = createSignal("");
  const [highlight, setHighlight] = createSignal(0);
  const [input, setInput] = createSignal<HTMLInputElement>();
  const [list, setList] = createSignal<HTMLElement>();
  onMount(() => queueMicrotask(() => input()?.focus()));

  const searchesThreads = () => submenu() === null && !query().startsWith(">");
  const messageSearch = useMessageSearch(() => (searchesThreads() ? query() : ""));
  let shown: ReturnType<typeof rankMessages> | null = null;
  const messageItems = createMemo(() => {
    const matches = messageSearch.matches();
    if (matches.length === 0) return [];
    shown = rankMessages({
      threads: threads(),
      environmentId: environment.state.EnvironmentId,
      query: messageSearch.query(),
      matches,
      shown,
      now,
    });
    const byId = new Map<string, IPaletteItem>(threadItems().map((item) => [item.Value, item]));
    const matchById = new Map<string, (typeof matches)[number]>(
      matches.map((match) => [match.threadId, match]),
    );
    return shown.keys.flatMap((threadId): IPaletteItem[] => {
      const item = byId.get(`thread:${threadId}`);
      const match = matchById.get(threadId);
      if (item === undefined || match === undefined) return [];
      const { Description: _description, ...rest } = item;
      return [
        {
          ...rest,
          Snippet: match.snippet,
          ...(match.messageCreatedAt
            ? { Timestamp: relativeTime(match.messageCreatedAt, now) }
            : {}),
        },
      ];
    });
  });

  const groups = createMemo(() => {
    const held = submenu();
    const current =
      held === null
        ? null
        : held.Item.Value === NEW_THREAD_IN
          ? newThreadInGroups()
          : (held.Item.Submenu ?? []);
    return filterPalette({
      groups: current ?? rootGroups(actionItems(), threadItems(), `thread:${selected() ?? ""}`),
      query: query(),
      inSubmenu: current !== null,
      actions: actionItems(),
      projects: projectItems(),
      threads: threadItems(),
      messages: messageItems(),
      now,
    });
  });
  const rows = createMemo(() => paletteRows(groups()));
  createEffect(on(query, () => setHighlight(0), { defer: true }));
  createEffect(
    on(highlight, (held) =>
      list()?.querySelector(`[data-row="${held}"]`)?.scrollIntoView({ block: "nearest" }),
    ),
  );

  const enter = (item: IPaletteItem) => {
    setStack([...stack(), { Item: item, ParentQuery: query() }]);
    setQuery("");
    setHighlight(0);
  };
  const back = () => {
    const held = submenu();
    if (held === null) return;
    setStack(stack().slice(0, -1));
    setQuery(held.ParentQuery);
    setHighlight(0);
  };
  const choose = (item: IPaletteItem | undefined) => {
    if (item === undefined) return;
    if (item.Submenu !== undefined || item.Value === NEW_THREAD_IN) return enter(item);
    const action = runs.get(item.Value);
    if (!keepsOpen.has(item.Value)) close();
    action?.();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Backspace" && query() === "" && submenu() !== null) {
      event.preventDefault();
      back();
    } else if (arrowStep(event.key) !== null) {
      event.preventDefault();
      const step = arrowStep(event.key)!;
      if (rows().length === 0) return;
      setHighlight((held) => stepHighlight(held, rows().length, step) ?? 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(rows()[highlight()]);
    }
  };

  const rowIndex = (item: IPaletteItem) => rows().indexOf(item);
  const emptyMessage = () => {
    if (rows().length > 0) return null;
    if (messageSearch.pending()) return "Searching thread messages…";
    return "No matching commands, projects or threads.";
  };

  return (
    <Portal>
      <div
        class={PALETTE_BACKDROP}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div class={PALETTE} role="dialog" aria-modal="true" aria-label="Command palette">
          <div class={PALETTE_INPUT_ROW}>
            <Show
              when={submenu() !== null}
              fallback={
                <span class={PALETTE_ADDON}>
                  <Search />
                </span>
              }
            >
              <button type="button" class={PALETTE_BACK} aria-label="Back" onClick={back}>
                <ArrowLeft />
              </button>
            </Show>
            <input
              class={PALETTE_INPUT}
              aria-label="Search commands, projects, and threads"
              placeholder={
                submenu() === null ? "Search commands, projects, and threads..." : "Search..."
              }
              spellcheck={false}
              autocomplete="off"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              value={query()}
              ref={setInput}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          <div class={PALETTE_LIST} id="palette-list" ref={setList} role="listbox">
            <For each={groups()}>
              {(group) => (
                <>
                  <p class={PALETTE_GROUP}>{group.Label}</p>
                  <For each={group.Items}>
                    {(item) => (
                      <PaletteRow
                        item={item}
                        index={rowIndex(item)}
                        highlighted={highlight() === rowIndex(item)}
                        query={messageSearch.query()}
                        shortcut={item.Shortcut ? navigation.shortcut(item.Shortcut) : null}
                        onHover={() => setHighlight(rowIndex(item))}
                        onChoose={() => choose(item)}
                      />
                    )}
                  </For>
                </>
              )}
            </For>
            <Show when={emptyMessage()}>
              {(message) => <p class={PALETTE_NOTE}>{message()}</p>}
            </Show>
          </div>
          <footer class={PALETTE_FOOTER}>
            <span class={PALETTE_HINT}>
              <kbd class={PALETTE_KBD}>↑</kbd>
              <kbd class={PALETTE_KBD}>↓</kbd> Navigate
            </span>
            <span class={PALETTE_HINT}>
              <kbd class={PALETTE_KBD}>Enter</kbd> Select
            </span>
            <Show when={submenu() !== null}>
              <span class={PALETTE_HINT}>
                <kbd class={PALETTE_KBD}>Backspace</kbd> Back
              </span>
            </Show>
            <span class={PALETTE_HINT}>
              <kbd class={PALETTE_KBD}>Esc</kbd> Close
            </span>
          </footer>
        </div>
      </div>
    </Portal>
  );
});

// Follows ThreadRowLeadingStatus in apps/web/src/components/ThreadStatusIndicators.tsx, with the
// sidebar's status.
function ThreadStatusLabel(props: { threadId: string }) {
  const shell = Shell.use();
  const status = () => {
    const thread = shell.state.Threads[props.threadId];
    return thread === undefined
      ? null
      : sidebarStatus(thread, shell.subagentRequests()[props.threadId]);
  };
  return (
    <Show when={status()}>
      {(held) => (
        <span
          class={`mr-1.5 inline-flex flex-none items-center gap-1 align-[1px] text-[10px] leading-4 font-medium ${STATUS_TONE[held()]}`}
        >
          <span class="size-1.5 rounded-full bg-current" />
          {STATUS_LABEL[held()]}
        </span>
      )}
    </Show>
  );
}

const MetaDot = () => <span class="flex-none opacity-50">·</span>;

// Follows ThreadCommandSubtitle in apps/web/src/components/ThreadCommandSubtitle.tsx: project,
// environment, workspace and the provider that runs the thread.
function ThreadMeta(props: { threadId: string }) {
  const environment = Environment.use();
  const shell = Shell.use();
  const thread = () => shell.state.Threads[props.threadId];
  return (
    <Show when={thread()}>
      {(held) => {
        const project = () => shell.state.Projects[held().projectId];
        const branch = () => held().branch?.trim() || null;
        return (
          <span class="flex min-w-0 items-center gap-1 [&_img]:size-3 [&_img]:flex-none [&_svg]:size-3 [&_svg]:flex-none">
            <Show when={project()}>
              {(shown) => (
                <>
                  <ProjectBadge project={shown()} size={12} />
                  <span class={META_TEXT}>{shown().title}</span>
                  <MetaDot />
                  <span>Local</span>
                </>
              )}
            </Show>
            <Show when={branch()}>
              {(shown) => (
                <>
                  <MetaDot />
                  <Show when={held().worktreePath} fallback={<Folder />}>
                    <FolderGit2 />
                  </Show>
                  <span class={META_TEXT}>{shown()}</span>
                </>
              )}
            </Show>
            <MetaDot />
            <ProviderIcon
              driver={
                modelDisplay(environment.state.Replica.Providers, held().modelSelection).Driver
              }
              size={12}
            />
          </span>
        );
      }}
    </Show>
  );
}

function PaletteRow(props: {
  item: IPaletteItem;
  index: number;
  highlighted: boolean;
  query: string;
  shortcut: string | null;
  onHover: () => void;
  onChoose: () => void;
}) {
  const title = () => {
    const item = props.item;
    if (item.Ranges !== undefined) return <Highlighted text={item.Title} ranges={item.Ranges} />;
    if (item.Emphasis !== undefined && item.Title.endsWith(item.Emphasis)) {
      return (
        <>
          {item.Title.slice(0, -item.Emphasis.length)}
          <strong>{item.Emphasis}</strong>
        </>
      );
    }
    return item.Title;
  };
  const detail = () => {
    const item = props.item;
    if (item.Snippet !== undefined)
      return (
        <Highlighted
          text={item.Snippet}
          ranges={findSearchTokenRanges(item.Snippet, props.query)}
        />
      );
    if (item.Hint !== undefined)
      return (
        <>
          {item.Hint.label}: <Highlighted text={item.Hint.text} ranges={item.Hint.ranges} />
        </>
      );
    if (item.ThreadId !== undefined) return <ThreadMeta threadId={item.ThreadId} />;
    return item.Description;
  };
  return (
    <button
      type="button"
      class={`${PALETTE_ROW} ${MARK}`}
      role="option"
      aria-selected={props.highlighted}
      data-row={props.index}
      onMouseDown={(event) => event.preventDefault()}
      onPointerMove={() => {
        if (!props.highlighted) props.onHover();
      }}
      onClick={() => props.onChoose()}
    >
      {ICONS[props.item.Icon]()}
      <span class={PALETTE_ROW_TEXT}>
        <span class={PALETTE_ROW_TITLE}>
          <Show when={props.item.ThreadId}>
            {(threadId) => <ThreadStatusLabel threadId={threadId()} />}
          </Show>
          {title()}
        </span>
        <Show when={detail()}>
          <span class={PALETTE_ROW_DETAIL}>{detail()}</span>
        </Show>
      </span>
      <Show when={props.item.Timestamp}>
        <span class="flex-none text-[12px] text-muted-foreground tabular-nums">
          {props.item.Timestamp}
        </span>
      </Show>
      <Show when={props.shortcut}>{(label) => <kbd class={PALETTE_KBD}>{label()}</kbd>}</Show>
    </button>
  );
}
