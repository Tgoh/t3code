// @effect-diagnostics globalDate:off globalTimers:off -- View-only ticks for relative times, outside any Effect runtime.
import { useResource } from "treflex-solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";

import { T3Mark } from "./brand";
import Environment from "./Environment";
import { ChevronDown, ChevronRight, FolderPlus, Folders, SquarePen, X } from "./icons";
import type { IWireThreadShell } from "./Infrastructure/wire";
import { AddProjectPanel } from "./AddProject";
import { FolderHeader, ProjectMenu } from "./ProjectFolder";
import Root from "./Root";
import Shell, { isBusy, projectFolders, sidebarSections, sidebarStatus } from "./Shell";
import { StageArt } from "./StageArt";
import { type ICardSection, ThreadCard, ThreadMenu } from "./ThreadCard";
import { modelDisplay } from "./ThreadSession";
import { MINUTE } from "./timestamps";

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

function readStored<T>(key: string, fallback: T): T {
  try {
    const held = localStorage.getItem(key);
    return held === null ? fallback : (JSON.parse(held) as T);
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows and blocked storage just forget the choice.
  }
}

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

export const Sidebar = Shell.provider(() => {
  const root = Root.use();
  const environment = Environment.use();
  const shell = Shell.use();
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
  const anyWorking = createMemo(() =>
    shell
      .sidebarThreads()
      .some((thread) => isBusy(sidebarStatus(thread, shell.subagentRequests()[thread.id]))),
  );
  createEffect(() => {
    if (!anyWorking()) return;
    setSecond(Date.now());
    const ticking = setInterval(() => setSecond(Date.now()), SECOND);
    onCleanup(() => clearInterval(ticking));
  });
  const sections = createMemo(() =>
    sidebarSections(shell.sidebarThreads(), now(), shell.subagentRequests()),
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
  const [grouped, setGrouped] = createSignal(readStored(GROUP_KEY, false));
  const [closedFolders, setClosedFolders] = createSignal(
    new Set(readStored<string[]>(CLOSED_FOLDERS_KEY, [])),
  );
  const toggleFolder = (projectId: string) => {
    const next = new Set(closedFolders());
    if (!next.delete(projectId)) next.add(projectId);
    setClosedFolders(next);
    writeStored(CLOSED_FOLDERS_KEY, [...next]);
  };
  const folders = createMemo(
    () =>
      new Map(
        grouped()
          ? projectFolders(sections().Active, shell.state.Projects).map((folder) => [
              folder.ProjectId,
              folder,
            ])
          : [],
      ),
  );
  const [addingProject, setAddingProject] = createSignal(false);
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
  const projects = () =>
    Object.values(shell.state.Projects).filter((project) => project.archivedAt == null);
  const targetProject = () => environment.currentProjectId() ?? projects()[0]?.id ?? null;
  const card = (thread: IWireThreadShell, section: ICardSection) => (
    <ThreadCard
      thread={thread}
      section={section}
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
          class="icon-button"
          aria-label="Add project"
          data-tip="Add project"
          aria-pressed={addingProject()}
          onClick={() => setAddingProject((held) => !held)}
        >
          <FolderPlus />
        </button>
        <button
          class="icon-button"
          classList={{ pressed: grouped() }}
          aria-label="Group by project"
          data-tip={grouped() ? "Stop grouping by project" : "Group by project"}
          aria-pressed={grouped()}
          onClick={() => {
            setGrouped(!grouped());
            writeStored(GROUP_KEY, grouped());
          }}
        >
          <Folders />
        </button>
      </div>
      <Show when={addingProject()}>
        <AddProjectPanel onClose={() => setAddingProject(false)} />
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
      <Show
        when={shell.sidebarThreads().length > 0 || folders().size > 0}
        fallback={
          <p class="empty">{shell.shellSynchronized() ? "No threads yet." : "Loading threads…"}</p>
        }
      >
        <ul class="thread-list">
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
                  <>
                    <FolderHeader
                      folder={folder()}
                      open={!closedFolders().has(projectId)}
                      renaming={renamingProject() === projectId}
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
                      {(thread) => card(thread, "active")}
                    </For>
                  </>
                );
              }}
            </For>
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
            onClose={() => setProjectMenu(null)}
          />
        )}
      </Show>
    </nav>
  );
});
