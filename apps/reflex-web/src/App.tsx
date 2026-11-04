// @effect-diagnostics globalDate:off globalTimers:off -- A view-only minute tick for relative times, outside any Effect runtime.
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import { useResource } from "reflex-solid";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";

import { ProjectBadge, ProviderIcon, T3Mark } from "./brand";
import { Composer } from "./Composer";
import Environment from "./Environment";
import {
  ArrowRightLeft,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  GitBranch,
  MessageCircleQuestion,
  ShieldQuestion,
  SquarePen,
} from "./icons";
import type { IWireModelSelection } from "./Infrastructure/commandEffects";
import type { IWireThreadShell } from "./Infrastructure/wire";
import Root from "./Root";
import Shell, { type ISidebarStatus, sidebarStatus, workingStartedAt } from "./Shell";
import { StageArt } from "./StageArt";
import ThreadSession, { modelDisplay } from "./ThreadSession";
import { ThreadView } from "./ThreadView";
import { hoverCard, TooltipHost } from "./tooltip";

const CONNECTION_LABEL: Record<string, string> = {
  connected: "connected",
  connecting: "reconnecting",
  backoff: "reconnecting",
  offline: "offline",
  blocked: "can't connect",
  available: "connecting",
};

const STATUS_LABEL: Record<NonNullable<ISidebarStatus>, string> = {
  working: "Working",
  approval: "Approval",
  input: "Input",
  failed: "Failed",
  done: "Done",
};

function StatusIcon(props: { status: NonNullable<ISidebarStatus> }) {
  return (
    <Switch>
      <Match when={props.status === "working"}>
        <CircleDashed />
      </Match>
      <Match when={props.status === "approval"}>
        <ShieldQuestion />
      </Match>
      <Match when={props.status === "input"}>
        <MessageCircleQuestion />
      </Match>
      <Match when={props.status === "failed"}>
        <CircleAlert />
      </Match>
      <Match when={props.status === "done"}>
        <CircleCheck />
      </Match>
    </Switch>
  );
}

function relativeTime(iso: string, now: number): string {
  const seconds = Math.floor(Math.max(0, now - Date.parse(iso)) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

interface IModelDisplay {
  Driver: string | undefined;
  Name: string;
}

function ThreadHoverCard(props: {
  thread: IWireThreadShell;
  projectName: string;
  model: IModelDisplay;
  previousProviders: string[];
}) {
  return (
    <div class="hover-card">
      <div class="hover-card-title">{props.thread.title}</div>
      <div class="hover-card-details">
        <div class="hover-card-line">
          <ProjectBadge name={props.projectName} size={12} />
          <span>{props.projectName}</span>
        </div>
        <Show when={props.thread.branch}>
          {(branch) => (
            <div class="hover-card-line">
              <GitBranch />
              <span>{branch()}</span>
            </div>
          )}
        </Show>
        <div class="hover-card-line">
          <ProviderIcon driver={props.model.Driver} size={12} />
          <span>{props.model.Name}</span>
        </div>
        <Show when={props.previousProviders.length > 0}>
          <div class="hover-card-line">
            <ArrowRightLeft />
            <span>Handed off from {props.previousProviders.join(", ")}</span>
          </div>
        </Show>
        <Show when={props.thread.lastError}>
          <div
            class="hover-card-line"
            classList={{
              warning: props.thread.lastErrorClass === "usage_limit",
              error: props.thread.lastErrorClass !== "usage_limit",
            }}
          >
            <CircleAlert />
            <span>
              {props.thread.lastErrorClass === "usage_limit"
                ? "Usage limit reached"
                : "Error occurred"}
            </span>
          </div>
        </Show>
      </div>
    </div>
  );
}

function ThreadCard(props: {
  thread: IWireThreadShell;
  projectName: string;
  model: IModelDisplay;
  previousProviders: string[];
  selected: boolean;
  now: number;
  second: number;
  onSelect: () => void;
}) {
  const status = () => {
    const held = sidebarStatus(props.thread);
    return held === "done" && props.selected ? null : held;
  };
  const workingFor = () => {
    const started = workingStartedAt(props.thread);
    return started === null ? null : formatWorkingDurationLabel(props.second - Date.parse(started));
  };
  return (
    <li>
      <button
        class="thread-card"
        data-tip=""
        data-tip-side="right"
        data-tip-delay="150"
        ref={hoverCard(ThreadHoverCard, props)}
        classList={{
          selected: props.selected,
          receded:
            !props.selected &&
            (status() === null || status() === "working" || status() === "approval"),
          dimmed: !props.selected && status() === "working",
        }}
        onClick={props.onSelect}
      >
        <span class="card-line">
          <ProjectBadge name={props.projectName} />
          <span class="card-project">{props.projectName}</span>
          <Show
            when={status()}
            fallback={
              <span class="card-time">
                {relativeTime(
                  props.thread.latestUserMessageAt ?? props.thread.updatedAt,
                  props.now,
                )}
              </span>
            }
          >
            {(held) => (
              <span class={`card-status ${held()}`}>
                <StatusIcon status={held()} />
                {STATUS_LABEL[held()]}
                <Show when={held() === "working" && workingFor()}>
                  {(elapsed) => <span class="card-elapsed">{elapsed()}</span>}
                </Show>
              </span>
            )}
          </Show>
        </span>
        <span class="card-line title-line">
          <span class="card-title">{props.thread.title}</span>
          <ProviderIcon driver={props.model.Driver} size={14} />
        </span>
      </button>
    </li>
  );
}

const MINUTE = 60_000;
const SECOND = 1_000;

const Sidebar = Shell.provider<{
  selected: string | null;
  currentProjectId: string | null;
  modelOf: (selection: IWireModelSelection) => IModelDisplay;
  providerName: (instanceId: string) => string;
  onSelect: (id: string) => void;
  onNewThread: (projectId: string) => void;
}>((props) => {
  const shell = Shell.use();
  const stream = useResource(() => shell.state, "Shell/Stream");
  const connection = () => {
    const status = stream.status();
    if (status.State !== "live") return status.State;
    const label = CONNECTION_LABEL[status.Detail ?? "connected"] ?? status.Detail;
    return label === "connected" && !shell.state.Synchronized ? "syncing" : label;
  };
  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), MINUTE);
  onCleanup(() => clearInterval(tick));
  const [second, setSecond] = createSignal(Date.now());
  const anyWorking = createMemo(() =>
    shell.sidebarThreads().some((thread) => sidebarStatus(thread) === "working"),
  );
  createEffect(() => {
    if (!anyWorking()) return;
    setSecond(Date.now());
    const ticking = setInterval(() => setSecond(Date.now()), SECOND);
    onCleanup(() => clearInterval(ticking));
  });
  const projects = () =>
    Object.values(shell.state.Projects).filter((project) => project.archivedAt == null);
  const targetProject = () => props.currentProjectId ?? projects()[0]?.id ?? null;
  return (
    <nav class="sidebar">
      <header class="sidebar-brand">
        <div class="sidebar-stage">
          <StageArt />
        </div>
        <span class="brand-mark">
          <T3Mark />
          <span>Code</span>
        </span>
      </header>
      <div class="sidebar-tools">
        <span class="connection">
          <Show when={connection() !== "connected"}>{connection()}</Show>
        </span>
        <Show when={targetProject()}>
          {(projectId) => (
            <button
              class="icon-button"
              aria-label="New thread"
              data-tip="New thread"
              onClick={() => props.onNewThread(projectId())}
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
                props.onNewThread(event.currentTarget.value);
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
      </div>
      <Show when={shell.state.Error}>
        <p class="sidebar-error">The shell stream ended: {shell.state.Error}</p>
      </Show>
      <Show
        when={shell.sidebarThreads().length > 0}
        fallback={
          <p class="empty">{shell.state.Synchronized ? "No threads yet." : "Loading threads…"}</p>
        }
      >
        <ul class="thread-list">
          <For each={shell.sidebarThreads()}>
            {(thread) => (
              <ThreadCard
                thread={thread}
                projectName={shell.state.Projects[thread.projectId]?.title ?? "Unknown project"}
                model={props.modelOf(thread.modelSelection)}
                previousProviders={(thread.providerInstanceHistory ?? [])
                  .filter((instanceId) => instanceId !== thread.modelSelection.instanceId)
                  .map((instanceId) => props.providerName(instanceId))}
                selected={props.selected === thread.id}
                now={now()}
                second={second()}
                onSelect={() => props.onSelect(thread.id)}
              />
            )}
          </For>
        </ul>
      </Show>
    </nav>
  );
});

const NewThreadView = ThreadSession.provider(() => {
  const session = ThreadSession.use();
  const projectName = () => session.projectName() ?? "Unknown project";
  return (
    <section class="thread">
      <header class="thread-header">
        <div class="breadcrumb">
          <ProjectBadge name={projectName()} size={14} />
          <span class="crumb-project">{projectName()}</span>
          <span class="crumb-separator">/</span>
          <h1>New thread</h1>
        </div>
      </header>
      <div class="timeline" />
      <div class="composer-lane">
        <Composer />
      </div>
    </section>
  );
});

const EnvironmentView = Environment.provider(() => {
  const environment = Environment.use();
  const providerName = (instanceId: string) =>
    environment.state.Replica.Providers.find((provider) => provider.InstanceId === instanceId)
      ?.Name ?? instanceId;
  return (
    <div class="layout">
      <Sidebar
        state={environment.state.Replica.Shell}
        selected={environment.state.Local.SelectedThreadId}
        currentProjectId={environment.currentProjectId()}
        modelOf={(selection) => modelDisplay(environment.state.Replica.Providers, selection)}
        providerName={providerName}
        onSelect={(id) => environment.selectThread(id)}
        onNewThread={(projectId) => environment.newThread(projectId)}
      />
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
