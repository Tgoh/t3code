import type { KeybindingCommand } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { useResource } from "treflex-solid";
import {
  type Accessor,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";

import { AddProjectPalette } from "./AddProject";
import { ProjectBadge } from "./brand";
import { CommandPalette } from "./CommandPalette";
import { Composer, FileDropSection } from "./Composer";
import Environment from "./Environment";
import { adjacentThread, isEditable, resolveShortcutCommand, shortcutLabel } from "./keybindings";
import {
  COMPOSER_SELECTOR,
  type INavigation,
  type IPaletteView,
  NavigationContext,
  SEARCH_SELECTOR,
} from "./navigation";
import Root from "./Root";
import { SettingsView } from "./SettingsView";
import { readStored, writeStored } from "./storage";
import { Sidebar, SidebarToggle } from "./Sidebar";
import ThreadSession from "./ThreadSession";
import { ThreadView } from "./ThreadView";
import { TooltipHost } from "./tooltip";
import { UsageView } from "./UsageView";
import {
  createMediaQuery,
  createSidebarSheet,
  SIDEBAR_SHEET_QUERY,
  SidebarSheetContext,
  trackVisualViewport,
  useSidebarSheet,
} from "./viewport";

const NewThreadView = ThreadSession.provider(() => {
  const session = ThreadSession.use();
  const environment = Environment.use();
  const projectName = () => session.projectName() ?? "Unknown project";
  return (
    <FileDropSection>
      <header class="thread-header">
        <SidebarToggle />
        <div class="breadcrumb">
          <ProjectBadge
            project={environment.state.Replica.Shell.Projects[session.projectId() ?? ""]}
            size={14}
          />
          <span class="crumb-project">{projectName()}</span>
          <span class="crumb-separator">/</span>
          <h1>New thread</h1>
        </div>
      </header>
      <div class="chat-stage">
        <div class="timeline" />
        <div class="composer-lane">
          <Composer />
        </div>
      </div>
    </FileDropSection>
  );
});

const SIDEBAR_COLLAPSED_KEY = "reflex-web:sidebar-collapsed";
const nextFrame = (run: () => void) => requestAnimationFrame(() => requestAnimationFrame(run));

const EnvironmentView = Environment.provider(() => {
  const environment = Environment.use();
  const sidebar = createSidebarSheet(
    createMediaQuery(SIDEBAR_SHEET_QUERY),
    () => environment.state.Local.SelectedThreadId,
    {
      initial: readStored<unknown>(SIDEBAR_COLLAPSED_KEY, false) === true,
      onChange: (collapsed) => writeStored(SIDEBAR_COLLAPSED_KEY, collapsed),
    },
  );
  const keybindingsResource = useResource(environment.state, "Server/Keybindings");
  const keybindings = () => keybindingsResource.value() ?? DEFAULT_RESOLVED_KEYBINDINGS;
  const platform = navigator.platform;
  const [palette, setPalette] = createSignal<IPaletteView | null>(null);
  const [threadOrder, setThreadOrder] = createSignal<Accessor<readonly string[]>>(() => []);
  // The on-screen keyboard would cover a phone's thread, so the sheet layout leaves focus alone.
  const focusComposer = () => {
    if (sidebar.sheet()) return;
    nextFrame(() => document.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR)?.focus());
  };
  const focusSearch = () => {
    if (sidebar.sheet()) sidebar.setOpen(true);
    else if (sidebar.collapsed()) sidebar.toggle();
    nextFrame(() => document.querySelector<HTMLInputElement>(SEARCH_SELECTOR)?.focus());
  };
  const goToThread = (threadId: string) => {
    void environment.selectThread(threadId);
    focusComposer();
  };
  const projectIds = () =>
    Object.values(environment.state.Replica.Shell.Projects)
      .filter((project) => project.archivedAt == null)
      .map((project) => project.id);
  const newThreadHere = () => {
    const projectId = environment.currentProjectId() ?? projectIds()[0] ?? null;
    if (projectId === null) return setPalette("new-thread-in");
    void environment.newThread(projectId);
    focusComposer();
  };
  // Follows the window keydown handlers of Sidebar.tsx and AppSidebarLayout.tsx and the chat route
  // commands in apps/web/src/shortcuts/chatRouteCommands.ts.
  const runCommand = (command: KeybindingCommand): boolean => {
    switch (command) {
      case "commandPalette.toggle":
        setPalette(palette() === null ? "root" : null);
        return true;
      case "sidebar.toggle":
        sidebar.toggle();
        return true;
      case "chat.new":
        if (projectIds().length > 1) setPalette("new-thread-in");
        else newThreadHere();
        return true;
      case "chat.newLocal":
        newThreadHere();
        return true;
      case "thread.previous":
      case "thread.next": {
        const target = adjacentThread(
          threadOrder()(),
          environment.state.Local.SelectedThreadId,
          command === "thread.next" ? "next" : "previous",
        );
        if (target === null) return false;
        goToThread(target);
        return true;
      }
      case "workspace.focusNext":
      case "workspace.focusPrevious":
        if (document.activeElement?.closest(".sidebar")) focusComposer();
        else focusSearch();
        return true;
      case "usage.open":
        void environment.openView({ Kind: "usage" });
        return true;
      default:
        return false;
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && sidebar.open()) {
      sidebar.setOpen(false);
      return;
    }
    if (event.defaultPrevented || event.repeat) return;
    const command = resolveShortcutCommand(
      event,
      keybindings(),
      {
        terminalFocus:
          event.target instanceof Element && event.target.closest(".terminal-drawer") !== null,
        editableFocus: isEditable(event.target),
      },
      platform,
    );
    if (command === null) return;
    if (palette() !== null && command !== "commandPalette.toggle") return;
    if (!runCommand(command)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener("keydown", onKeyDown);
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));
  const navigation: INavigation = {
    keybindings,
    shortcut: (command) => shortcutLabel(keybindings(), command, platform),
    palette,
    setPalette,
    threadOrder: () => threadOrder()(),
    setThreadOrder: (order) => setThreadOrder(() => order),
    goToThread,
    focusComposer,
    focusSearch,
  };
  return (
    <div
      class="layout"
      classList={{
        "sidebar-sheet": sidebar.sheet(),
        "sidebar-open": sidebar.open(),
        "sidebar-collapsed": sidebar.collapsed(),
      }}
    >
      <SidebarSheetContext.Provider value={sidebar}>
        <NavigationContext.Provider value={navigation}>
          <Sidebar state={environment.state.Replica.Shell} />
          <Show when={sidebar.open()}>
            <div
              class="sidebar-backdrop"
              aria-hidden="true"
              onClick={() => sidebar.setOpen(false)}
            />
          </Show>
          <EnvironmentMain />
          <Show when={palette() === "add-project"}>
            <AddProjectPalette onClose={() => setPalette(null)} />
          </Show>
          <Show when={palette() === "add-project" ? null : palette()} keyed>
            {(view) => <CommandPalette state={environment.state.Replica.Shell} view={view} />}
          </Show>
        </NavigationContext.Provider>
      </SidebarSheetContext.Provider>
    </div>
  );
});

function EnvironmentMain() {
  const environment = Environment.use();
  const sidebar = useSidebarSheet();
  return (
    <main inert={sidebar.open()}>
      <Switch
        fallback={
          <>
            <Show when={sidebar.sheet() || sidebar.collapsed()}>
              <header class="thread-header">
                <SidebarToggle />
              </header>
            </Show>
            <p class="empty">Select a thread.</p>
          </>
        }
      >
        <Match
          when={
            environment.state.Local.View?.Kind === "settings" ? environment.state.Local.View : null
          }
        >
          {(view) => <SettingsView page={view().Page} />}
        </Match>
        <Match when={environment.state.Local.View?.Kind === "usage"}>
          <UsageView />
        </Match>
        <Match when={environment.selectedOpenThread()} keyed>
          {(thread) => <ThreadView state={thread} />}
        </Match>
        <Match when={environment.selectedDraftSession()} keyed>
          {(session) => <NewThreadView state={session} />}
        </Match>
      </Switch>
    </main>
  );
}

export const App = Root.provider(() => {
  const root = Root.use();
  onMount(() => trackVisualViewport(document.documentElement));
  return (
    <>
      <Switch>
        <Match when={root.state.Phase === "loading"}>
          <p class="empty">Loading…</p>
        </Match>
        <Match when={root.state.Phase === "unpaired"}>
          <p class="empty">
            Not paired with {root.state.Label}. Open this page with a pairing token: run{" "}
            <code>node apps/server/src/bin.ts pair</code> and add <code>#token=…</code> to the
            address.
          </p>
        </Match>
        <Match when={root.state.Phase === "connected"}>
          <For each={root.state.Environments}>
            {(environment) => <EnvironmentView state={environment} />}
          </For>
        </Match>
      </Switch>
      <TooltipHost />
    </>
  );
});
