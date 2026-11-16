import { For, Match, Switch } from "solid-js";

import { ProjectBadge } from "./brand";
import { Composer, FileDropSection } from "./Composer";
import Environment from "./Environment";
import Root from "./Root";
import { Sidebar } from "./Sidebar";
import ThreadSession from "./ThreadSession";
import { ThreadView } from "./ThreadView";
import { TooltipHost } from "./tooltip";

const NewThreadView = ThreadSession.provider(() => {
  const session = ThreadSession.use();
  const projectName = () => session.projectName() ?? "Unknown project";
  return (
    <FileDropSection>
      <header class="thread-header">
        <div class="breadcrumb">
          <ProjectBadge name={projectName()} size={14} />
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
  return (
    <div class="layout">
      <Sidebar state={environment.state.Replica.Shell} />
      <main>
        <Switch fallback={<p class="empty">Select a thread.</p>}>
          <Match when={environment.selectedOpenThread()} keyed>
            {(thread) => <ThreadView state={thread} />}
          </Match>
          <Match when={environment.selectedDraftSession()} keyed>
            {(session) => <NewThreadView state={session} />}
          </Match>
        </Switch>
      </main>
    </div>
  );
});

export const App = Root.provider(() => {
  const root = Root.use();
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
