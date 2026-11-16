import { For, Match, onCleanup, onMount, Show, Switch } from "solid-js";

import { ProjectBadge } from "./brand";
import { Composer, FileDropSection } from "./Composer";
import Environment from "./Environment";
import Root from "./Root";
import { Sidebar, SidebarToggle } from "./Sidebar";
import ThreadSession from "./ThreadSession";
import { ThreadView } from "./ThreadView";
import { TooltipHost } from "./tooltip";
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

const EnvironmentView = Environment.provider(() => {
  const environment = Environment.use();
  const sidebar = createSidebarSheet(
    createMediaQuery(SIDEBAR_SHEET_QUERY),
    () => environment.state.Local.SelectedThreadId,
  );
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && sidebar.open()) sidebar.setOpen(false);
  };
  document.addEventListener("keydown", onKeyDown);
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));
  return (
    <div
      class="layout"
      classList={{ "sidebar-sheet": sidebar.sheet(), "sidebar-open": sidebar.open() }}
    >
      <SidebarSheetContext.Provider value={sidebar}>
        <Sidebar state={environment.state.Replica.Shell} />
        <Show when={sidebar.open()}>
          <div class="sidebar-backdrop" aria-hidden="true" onClick={() => sidebar.setOpen(false)} />
        </Show>
        <EnvironmentMain />
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
            <Show when={sidebar.sheet()}>
              <header class="thread-header">
                <SidebarToggle />
              </header>
            </Show>
            <p class="empty">Select a thread.</p>
          </>
        }
      >
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
