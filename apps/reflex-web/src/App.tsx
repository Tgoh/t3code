import { isPasteAsTextShortcut } from "@t3tools/client-runtime/text-paste";
import type { KeybindingCommand } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS, isMacPlatform } from "@t3tools/shared/keybindings";
import { useDispatch, useResource } from "treflex-solid";
import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";

import { AddProjectPalette } from "./AddProject";
import { ProjectBadge } from "./brand";
import { CommandPalette } from "./CommandPalette";
import { Composer, COMPOSER_LANE, FileDropSection } from "./Composer";
import { TOGGLE_DICTATION_EVENT, typeIntoComposer } from "./composerFocus";
import {
  pasteTextToFocusComposer,
  shouldRedirectInputToComposer,
  shouldTypeToFocusComposer,
} from "./composerFocusRedirect";
import { DictationIndicator } from "./DictationControls";
import Environment from "./Environment";
import { adjacentThread, isEditable, resolveShortcutCommand, shortcutLabel } from "./keybindings";
import {
  COMPOSER_SELECTOR,
  type INavigation,
  type IPaletteView,
  NavigationContext,
  RENAME_THREAD_EVENT,
  SEARCH_SELECTOR,
} from "./navigation";
import { createOverlayStack, OverlayContext } from "./overlays";
import Root from "./Root";
import { SettingsView } from "./SettingsView";
import { createKeyDispatcher, runPanelShortcut } from "./shortcuts";
import { Sidebar, SidebarToggle } from "./Sidebar";
import ThreadSession, { closeRightPanel } from "./ThreadSession";
import { CHAT_STAGE, ThreadView } from "./ThreadView";
import { EMPTY_NOTE } from "./ui/notes";
import { BREADCRUMB, CRUMB_MUTED, CRUMB_SEPARATOR, CRUMB_TITLE, PageHeader } from "./ui/PageHeader";
import { TooltipHost } from "./ui/tooltip";
import { UsageView } from "./UsageView";
import { ViewportDebug } from "./ViewportDebug";
import {
  createMediaQuery,
  createSidebarSheet,
  PANEL_SHEET_QUERY,
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
      <PageHeader>
        <SidebarToggle />
        <div class={BREADCRUMB}>
          <ProjectBadge
            project={environment.state.Replica.Shell.Projects[session.projectId() ?? ""]}
            size={14}
          />
          <span class={CRUMB_MUTED}>{projectName()}</span>
          <span class={CRUMB_SEPARATOR}>/</span>
          <h1 class={CRUMB_TITLE}>New thread</h1>
        </div>
      </PageHeader>
      <div class={CHAT_STAGE}>
        <div class="min-h-0 flex-1" />
        <div class={COMPOSER_LANE}>
          <Composer />
        </div>
      </div>
    </FileDropSection>
  );
});

const nextFrame = (run: () => void) => requestAnimationFrame(() => requestAnimationFrame(run));

const EnvironmentView = Environment.provider(() => {
  const environment = Environment.use();
  const sidebar = createSidebarSheet(
    createMediaQuery(SIDEBAR_SHEET_QUERY),
    () => environment.state.Local.SelectedThreadId,
    {
      initial: environment.state.Local.Preferences.SidebarCollapsed,
      onChange: (collapsed) => void environment.setPreferences({ SidebarCollapsed: collapsed }),
    },
  );
  const keybindingsResource = useResource(environment.state, "Server/Keybindings");
  const keybindings = () => keybindingsResource.value() ?? DEFAULT_RESOLVED_KEYBINDINGS;
  const platform = navigator.platform;
  const dispatch = useDispatch();
  const [palette, setPalette] = createSignal<IPaletteView | null>(null);
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
  const goToThread = (threadId: string, searchQuery?: string) => {
    sidebar.choseThread();
    void environment.selectThread(threadId, searchQuery);
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
  const renameThread = () => {
    const threadId = environment.state.Local.SelectedThreadId;
    if (threadId === null || environment.state.Replica.Shell.Threads[threadId] === undefined)
      return false;
    if (sidebar.sheet()) sidebar.setOpen(true);
    else if (sidebar.collapsed()) sidebar.toggle();
    nextFrame(() =>
      window.dispatchEvent(new CustomEvent(RENAME_THREAD_EVENT, { detail: threadId })),
    );
    return true;
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
          environment.sidebarLayout().Order,
          environment.state.Local.SelectedThreadId,
          command === "thread.next" ? "next" : "previous",
        );
        if (target === null) return false;
        goToThread(target);
        return true;
      }
      case "workspace.focusNext":
      case "workspace.focusPrevious":
        if (document.activeElement?.closest("[data-sidebar]")) focusComposer();
        else focusSearch();
        return true;
      case "usage.open":
        void environment.openView({ Kind: "usage" });
        return true;
      case "composer.dictation":
        if (document.querySelector(COMPOSER_SELECTOR) === null) return false;
        window.dispatchEvent(new Event(TOGGLE_DICTATION_EVENT));
        return true;
      case "thread.rename":
        renameThread();
        return true;
      default:
        return runPanelShortcut(command, environment.panelShortcuts(), dispatch);
    }
  };
  const overlays = createOverlayStack();
  const panelSheet = createMediaQuery(PANEL_SHEET_QUERY);
  const composerCovered = () =>
    overlays.open() ||
    palette() !== null ||
    sidebar.open() ||
    (panelSheet() && environment.panelShortcuts()?.RightPanelOpen === true);
  let pasteAsTextUntil = 0;
  const onPasteAsTextKey = (event: KeyboardEvent) => {
    if (
      shouldRedirectInputToComposer(event) &&
      isPasteAsTextShortcut(event, isMacPlatform(platform))
    )
      pasteAsTextUntil = event.timeStamp + 1_000;
  };
  // Follows usePasteToFocusComposer in apps/web/src/components/chat.
  const onPaste = (event: ClipboardEvent) => {
    if (composerCovered()) return;
    const text = pasteTextToFocusComposer(event);
    if (text === null) return;
    const bypass = event.timeStamp <= pasteAsTextUntil;
    pasteAsTextUntil = 0;
    if (!typeIntoComposer({ Text: text, Paste: true, Bypass: bypass })) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const keys = createKeyDispatcher({
    overlays,
    paletteOpen: () => palette() !== null,
    resolve: (event) =>
      resolveShortcutCommand(
        event,
        keybindings(),
        {
          terminalFocus:
            event.target instanceof Element &&
            event.target.closest("[data-terminal-drawer]") !== null,
          editableFocus: isEditable(event.target),
          composerFocus: event.target instanceof Element && event.target.matches(COMPOSER_SELECTOR),
        },
        platform,
      ),
    run: runCommand,
    typeIntoComposer: (event) =>
      shouldTypeToFocusComposer(event, composerCovered()) &&
      typeIntoComposer({ Text: event.key, Paste: false, Bypass: false }),
    closeSheet: () => {
      const panels = environment.panelShortcuts();
      if (panelSheet() && panels?.RightPanelOpen === true) {
        void dispatch(closeRightPanel, panels.SessionId);
        return true;
      }
      if (!sidebar.open()) return false;
      sidebar.setOpen(false);
      return true;
    },
  });
  const onPointerDown = (event: PointerEvent) => {
    if (event.target instanceof Node) overlays.press(event.target);
  };
  window.addEventListener("keydown", keys.onKeyDown);
  window.addEventListener("keydown", onPasteAsTextKey, true);
  window.addEventListener("paste", onPaste, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  onCleanup(() => {
    window.removeEventListener("keydown", keys.onKeyDown);
    window.removeEventListener("keydown", onPasteAsTextKey, true);
    window.removeEventListener("paste", onPaste, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
  });
  const navigation: INavigation = {
    keybindings,
    shortcut: (command) => shortcutLabel(keybindings(), command, platform),
    palette,
    setPalette,
    goToThread,
    focusComposer,
    focusSearch,
    renameThread,
    takeLetters: keys.takeLetters,
  };
  return (
    <div
      class="layout fixed inset-x-0 top-[var(--viewport-top,0)] grid h-[var(--viewport-height,100%)] grid-cols-[calc(16rem+env(safe-area-inset-left))_minmax(0,1fr)] pt-[env(safe-area-inset-top)] [&:is(.sidebar-sheet,.sidebar-collapsed)]:grid-cols-[minmax(0,1fr)]"
      classList={{
        "sidebar-sheet": sidebar.sheet(),
        "sidebar-open": sidebar.open(),
        "sidebar-collapsed": sidebar.collapsed(),
      }}
    >
      <SidebarSheetContext.Provider value={sidebar}>
        <OverlayContext.Provider value={overlays}>
          <NavigationContext.Provider value={navigation}>
            <Sidebar state={environment.state.Replica.Shell} />
            <Show when={sidebar.open()}>
              <div
                class="absolute inset-0 z-49 bg-(--dialog-backdrop) backdrop-blur-[4px]"
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
        </OverlayContext.Provider>
      </SidebarSheetContext.Provider>
    </div>
  );
});

function EnvironmentMain() {
  const environment = Environment.use();
  const sidebar = useSidebarSheet();
  return (
    <main class="h-full min-h-0 min-w-0 bg-background" inert={sidebar.open()}>
      <Switch
        fallback={
          <>
            <Show when={sidebar.sheet() || sidebar.collapsed()}>
              <PageHeader>
                <SidebarToggle />
              </PageHeader>
            </Show>
            <p class={EMPTY_NOTE}>Select a thread.</p>
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
      <Show when={environment.state.Local.ViewportDebug}>
        <ViewportDebug />
      </Show>
      <DictationIndicator />
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
          <p class={EMPTY_NOTE}>Loading…</p>
        </Match>
        <Match when={root.state.Phase === "unpaired"}>
          <p class={EMPTY_NOTE}>
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
