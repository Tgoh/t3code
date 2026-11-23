import { isPasteAsTextShortcut } from "@t3tools/client-runtime/text-paste";
import type { KeybindingCommand } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { useDispatch } from "treflex-solid";
import {
  createEffect,
  createMemo,
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
import { Composer, COMPOSER_LANE, FileDropSection } from "./Composer";
import { TOGGLE_DICTATION_EVENT, typeIntoComposer } from "./composerFocus";
import {
  pasteTextToFocusComposer,
  shouldRedirectInputToComposer,
  shouldTypeToFocusComposer,
} from "./composerFocusRedirect";
import Dictation from "./Dictation";
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
import { CloneToasts } from "./ProjectClone";
import Root from "./Root";
import { SettingsView } from "./SettingsView";
import { createKeyDispatcher, runPanelShortcut } from "./shortcuts";
import { Sidebar, SidebarToggle } from "./Sidebar";
import { SidebarRail } from "./SidebarRail";
import { shownSidebarWidth } from "./sidebarWidth";
import ThreadSession, { closeRightPanel } from "./ThreadSession";
import { CHAT_STAGE, ThreadView } from "./ThreadView";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/Empty";
import { BREADCRUMB, CRUMB_MUTED, CRUMB_SEPARATOR, CRUMB_TITLE, PageHeader } from "./ui/PageHeader";
import { Presence, usePresence } from "./ui/Presence";
import { SheetBackdrop } from "./ui/Sheet";
import { StandalonePage, StandalonePageHeader } from "./ui/StandalonePage";
import { AnchoredToasts, Toasts } from "./ui/Toast";
import { TooltipHost } from "./ui/Tooltip";
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
  // Follows appInit.tsx: styles.css sizes --chat-content-max-width from this attribute.
  createEffect(() => {
    document.documentElement.dataset.chatWidth =
      environment.state.Local.ClientSettings?.chatWidth ?? "comfortable";
  });
  const keybindings = () => environment.keybindings();
  const platform = navigator.platform;
  const dispatch = useDispatch();
  const [palette, setPalette] = createSignal<IPaletteView | null>(null);
  // Each open is a new session with its own Presence, so a reopen mounts a fresh palette while
  // the closing one exits with its old content. The two latest are enough to cover an exit.
  const paletteSession = createMemo(() => {
    const view = palette();
    return view === null ? null : { View: view };
  });
  const paletteSessions = createMemo<ReadonlyArray<{ View: IPaletteView }>>((held) => {
    const session = paletteSession();
    return session === null || held.includes(session) ? held : [...held.slice(-1), session];
  }, []);
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
  const projectIds = () => environment.activeProjects().map((project) => project.id);
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
      case "thread.settle":
        if (environment.state.Local.SelectedThreadId === null) return false;
        void environment.toggleSettleOpenThread();
        return true;
      case "thread.regenerateTitle": {
        const threadId = environment.state.Local.SelectedThreadId;
        if (threadId === null || environment.state.Replica.Shell.Threads[threadId] === undefined)
          return false;
        void environment.regenerateTitles([threadId]);
        return true;
      }
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
    resolve: (event) => {
      const terminalFocus =
        event.target instanceof Element && event.target.closest("[data-terminal-drawer]") !== null;
      const command = resolveShortcutCommand(
        event,
        keybindings(),
        {
          terminalFocus,
          editableFocus: isEditable(event.target),
          composerFocus: event.target instanceof Element && event.target.matches(COMPOSER_SELECTOR),
        },
        platform,
      );
      // A focused terminal owns Ctrl chords, such as tmux's Ctrl+B prefix.
      return command === "sidebar.toggle" && event.ctrlKey && terminalFocus ? null : command;
    },
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
  const [viewportWidth, setViewportWidth] = createSignal(window.innerWidth);
  const onResize = () => setViewportWidth(window.innerWidth);
  window.addEventListener("resize", onResize);
  onCleanup(() => window.removeEventListener("resize", onResize));
  const [dragWidth, setDragWidth] = createSignal<number | null>(null);
  const sidebarWidth = () =>
    dragWidth() ??
    shownSidebarWidth(environment.state.Local.Preferences.SidebarWidth, viewportWidth());
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
      class="layout fixed inset-x-0 top-[var(--viewport-top,0)] max-sm:[--workspace-titlebar-control-size:--spacing(8)] grid h-[var(--viewport-height,100%)] grid-cols-[calc(var(--sidebar-width)+env(safe-area-inset-left))_minmax(0,1fr)] pt-[env(safe-area-inset-top)] [&:is(.sidebar-sheet,.sidebar-collapsed)]:grid-cols-[minmax(0,1fr)]"
      style={{ "--sidebar-width": `${sidebarWidth()}px` }}
      classList={{
        "sidebar-sheet": sidebar.sheet(),
        "sidebar-open": sidebar.open(),
        "sidebar-collapsed": sidebar.collapsed(),
      }}
    >
      <SidebarSheetContext.Provider value={sidebar}>
        <OverlayContext.Provider value={overlays}>
          <NavigationContext.Provider value={navigation}>
            <Presence when={sidebar.open()}>
              {() => (
                <SheetBackdrop ref={usePresence().track} onClick={() => sidebar.setOpen(false)} />
              )}
            </Presence>
            <Sidebar state={environment.state.Replica.Shell} />
            <Show when={!sidebar.sheet() && !sidebar.collapsed()}>
              <SidebarRail
                width={sidebarWidth()}
                onResize={setDragWidth}
                onDone={(width) => {
                  if (width === null) return setDragWidth(null);
                  void environment
                    .setPreferences({ SidebarWidth: width })
                    .finally(() => setDragWidth(null));
                }}
                onReset={() => void environment.setPreferences({ SidebarWidth: null })}
              />
            </Show>
            <EnvironmentMain state={environment.state.Local.Dictation} />
            <CloneToasts />
            <For each={paletteSessions()}>
              {(session) => (
                <Presence when={paletteSession() === session}>
                  {() =>
                    session.View === "add-project" ? (
                      <AddProjectPalette onClose={() => setPalette(null)} />
                    ) : (
                      <CommandPalette state={environment.state.Replica.Shell} view={session.View} />
                    )
                  }
                </Presence>
              )}
            </For>
          </NavigationContext.Provider>
        </OverlayContext.Provider>
      </SidebarSheetContext.Provider>
    </div>
  );
});

const EnvironmentMain = Dictation.provider(() => {
  const environment = Environment.use();
  const sidebar = useSidebarSheet();
  return (
    <main class="h-full min-h-0 min-w-0 bg-background" inert={sidebar.open()}>
      <Switch
        fallback={
          <div class="flex h-full min-h-0 flex-col">
            <Show when={sidebar.sheet() || sidebar.collapsed()}>
              <PageHeader>
                <SidebarToggle />
              </PageHeader>
            </Show>
            <Empty>
              <div class="w-full max-w-lg px-8 py-12">
                <EmptyHeader wide>
                  <EmptyTitle>Pick a thread to continue</EmptyTitle>
                  <EmptyDescription>
                    Select an existing thread or create a new one to get started.
                  </EmptyDescription>
                </EmptyHeader>
              </div>
            </Empty>
          </div>
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
});

export const App = Root.provider(() => {
  const root = Root.use();
  onMount(() => trackVisualViewport(document.documentElement));
  const activeThread = createMemo(() => {
    const environment = root.state.Environments.find((entry) => entry.Local.SelectedThreadId);
    const threadId = environment?.Local.SelectedThreadId;
    return environment && threadId ? { environmentId: environment.EnvironmentId, threadId } : null;
  });
  return (
    <>
      <Switch>
        <Match when={root.state.Phase === "loading"}>
          <Empty>
            <EmptyHeader>
              <EmptyDescription>Loading…</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Match>
        <Match when={root.state.Phase === "unpaired"}>
          <StandalonePage>
            <StandalonePageHeader
              context={root.state.Label}
              title="Pair with this environment"
              description="Open this page with a pairing token to start a session with this environment."
            />
            <div class="mt-6 rounded-lg border border-border/70 bg-background/55 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
              Run <code>node apps/server/src/bin.ts pair</code> and add <code>#token=…</code> to the
              address.
            </div>
          </StandalonePage>
        </Match>
        <Match when={root.state.Phase === "connected"}>
          <For each={root.state.Environments}>
            {(environment) => <EnvironmentView state={environment} />}
          </For>
        </Match>
      </Switch>
      <Toasts activeThread={activeThread()} />
      <AnchoredToasts activeThread={activeThread()} />
      <TooltipHost />
    </>
  );
});
