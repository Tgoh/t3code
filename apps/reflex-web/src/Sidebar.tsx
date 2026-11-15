// @effect-diagnostics globalDate:off globalTimers:off -- View-only ticks for relative times, outside any Effect runtime.
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import { resolveSnoozePresets } from "@t3tools/client-runtime/state/thread-settled";
import { useResource } from "treflex-solid";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";

import { ProjectBadge, ProviderIcon, T3Mark } from "./brand";
import Environment from "./Environment";
import {
  AlarmClockOff,
  ArrowRightLeft,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock,
  Ellipsis,
  FolderPlus,
  Folders,
  GitBranch,
  Mail,
  MessageCircleQuestion,
  PenLine,
  Pin,
  PinOff,
  ShieldQuestion,
  SquarePen,
  Trash2,
  Undo2,
  X,
} from "./icons";
import type { IProjectCommand, IThreadCommand } from "./Infrastructure/commandEffects";
import type { IWireProject, IWireThreadShell } from "./Infrastructure/wire";
import Root from "./Root";
import Shell, {
  type IProjectFolder,
  type ISidebarStatus,
  isSnoozed,
  projectFolders,
  sidebarSections,
  sidebarStatus,
  workingStartedAt,
} from "./Shell";
import { StageArt } from "./StageArt";
import { modelDisplay } from "./ThreadSession";
import { hoverCard } from "./tooltip";

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

const MINUTE = 60_000;
const SECOND = 1_000;
const SETTLED_PAGE = 25;

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

function timeUntil(iso: string, now: number): string {
  const minutes = Math.ceil(Math.max(0, Date.parse(iso) - now) / MINUTE);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.ceil(hours / 24)}d`;
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

type ICardSection = "active" | "pinned" | "snoozed" | "settled";

function RenameInput(props: { title: string; onDone: (title: string | null) => void }) {
  const [finished, setFinished] = createSignal(false);
  const finish = (title: string | null) => {
    if (finished()) return;
    setFinished(true);
    props.onDone(title);
  };
  return (
    <input
      class="card-rename"
      aria-label="Thread title"
      value={props.title}
      ref={(input) =>
        queueMicrotask(() => {
          input.focus();
          input.select();
        })
      }
      onClick={(event) => event.stopPropagation()}
      onBlur={(event) => finish(event.currentTarget.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(event.currentTarget.value);
        if (event.key === "Escape") finish(null);
      }}
    />
  );
}

function ThreadCard(props: {
  thread: IWireThreadShell;
  section: ICardSection;
  projectName: string;
  model: IModelDisplay;
  previousProviders: string[];
  selected: boolean;
  renaming: boolean;
  now: number;
  second: number;
  onMenu: (x: number, y: number) => void;
  onRenamed: (title: string | null) => void;
}) {
  const environment = Environment.use();
  const select = () => environment.selectThread(props.thread.id);
  const status = () => {
    const held = sidebarStatus(props.thread);
    return held === "done" && props.selected ? null : held;
  };
  const workingFor = () => {
    const started = workingStartedAt(props.thread);
    return started === null ? null : formatWorkingDurationLabel(props.second - Date.parse(started));
  };
  const act = (event: MouseEvent, command: IThreadCommand) => {
    event.stopPropagation();
    environment.threadCommand(props.thread.id, command);
  };
  return (
    <li>
      <div
        class="thread-card"
        role="button"
        tabindex="0"
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
        onClick={select}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          select();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onMenu(event.clientX, event.clientY);
        }}
      >
        <span class="card-line">
          <ProjectBadge name={props.projectName} />
          <span class="card-project">{props.projectName}</span>
          <span class="card-slot">
            <Show
              when={status()}
              fallback={
                <span class="card-time">
                  {props.section === "snoozed"
                    ? timeUntil(props.thread.snoozedUntil ?? "", props.now)
                    : relativeTime(
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
          <span class="card-actions">
            <Switch>
              <Match when={props.section === "settled"}>
                <button
                  type="button"
                  class="card-action"
                  aria-label="Un-settle thread"
                  data-tip="Un-settle thread"
                  onClick={(event) => act(event, { Kind: "unsettle" })}
                >
                  <Undo2 />
                </button>
              </Match>
              <Match when={props.section === "snoozed"}>
                <button
                  type="button"
                  class="card-action"
                  aria-label="Wake thread now"
                  data-tip="Wake thread now"
                  onClick={(event) => act(event, { Kind: "unsnooze" })}
                >
                  <AlarmClockOff />
                </button>
              </Match>
              <Match when={true}>
                <button
                  type="button"
                  class="card-action"
                  aria-label="Settle thread"
                  data-tip="Settle thread"
                  onClick={(event) => act(event, { Kind: "settle" })}
                >
                  <Check />
                  Settle
                </button>
              </Match>
            </Switch>
            <button
              type="button"
              class="card-action"
              aria-label="More actions"
              data-tip="More actions"
              onClick={(event) => {
                event.stopPropagation();
                props.onMenu(event.clientX, event.clientY);
              }}
            >
              <Ellipsis />
            </button>
          </span>
        </span>
        <span class="card-line title-line">
          <Show
            when={props.renaming}
            fallback={<span class="card-title">{props.thread.title}</span>}
          >
            <RenameInput title={props.thread.title} onDone={props.onRenamed} />
          </Show>
          <ProviderIcon driver={props.model.Driver} size={14} />
        </span>
      </div>
    </li>
  );
}

function MenuItem(props: {
  icon: JSX.Element;
  label: string;
  detail?: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      class="menu-item"
      classList={{ danger: props.danger === true }}
      role="menuitem"
      onClick={props.onSelect}
    >
      {props.icon}
      <span class="menu-label">{props.label}</span>
      <Show when={props.detail}>
        <span class="menu-detail">{props.detail}</span>
      </Show>
    </button>
  );
}

function Popup(props: {
  x: number;
  y: number;
  label: string;
  onClose: () => void;
  children: JSX.Element;
}) {
  const [menuElement, setMenuElement] = createSignal<HTMLDivElement>();
  onMount(() => {
    const menu = menuElement();
    if (menu === undefined) return;
    const margin = 8;
    menu.style.left = `${Math.min(props.x, window.innerWidth - menu.offsetWidth - margin)}px`;
    menu.style.top = `${Math.max(margin, Math.min(props.y, window.innerHeight - menu.offsetHeight - margin))}px`;
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) props.onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    });
  });
  return (
    <div class="thread-menu" role="menu" aria-label={props.label} ref={setMenuElement}>
      {props.children}
    </div>
  );
}

function ProjectMenu(props: {
  project: IWireProject;
  x: number;
  y: number;
  onRename: () => void;
  onClose: () => void;
}) {
  const environment = Environment.use();
  const command = (command: IProjectCommand) =>
    environment.projectCommand(props.project.id, command);
  const choose = (act: () => void) => {
    act();
    props.onClose();
  };
  return (
    <Popup x={props.x} y={props.y} label="Project actions" onClose={props.onClose}>
      <MenuItem
        icon={<SquarePen />}
        label="New thread"
        onSelect={() => choose(() => environment.newThread(props.project.id))}
      />
      <Show
        when={props.project.pinnedAt != null}
        fallback={
          <MenuItem
            icon={<Pin />}
            label="Pin project"
            onSelect={() => choose(() => command({ Kind: "pin" }))}
          />
        }
      >
        <MenuItem
          icon={<PinOff />}
          label="Unpin project"
          onSelect={() => choose(() => command({ Kind: "unpin" }))}
        />
      </Show>
      <MenuItem icon={<PenLine />} label="Rename" onSelect={() => choose(props.onRename)} />
    </Popup>
  );
}

function ThreadMenu(props: {
  thread: IWireThreadShell;
  x: number;
  y: number;
  now: number;
  onRename: () => void;
  onClose: () => void;
}) {
  const environment = Environment.use();
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const snoozed = () => isSnoozed(props.thread, props.now);
  const settled = () => props.thread.settledOverride === "settled";
  const pinned = () => props.thread.pinnedAt != null;
  const presets = createMemo(() =>
    snoozed() || props.thread.pendingRuntimeRequest !== null
      ? []
      : resolveSnoozePresets(new Date(props.now)),
  );
  const choose = (command: IThreadCommand) => {
    environment.threadCommand(props.thread.id, command);
    props.onClose();
  };
  return (
    <Popup x={props.x} y={props.y} label="Thread actions" onClose={props.onClose}>
      <For each={presets()}>
        {(preset) => (
          <MenuItem
            icon={<Clock />}
            label={preset.label}
            detail={preset.whenLabel}
            onSelect={() => choose({ Kind: "snooze", Until: preset.snoozedUntil })}
          />
        )}
      </For>
      <Show when={snoozed()}>
        <MenuItem
          icon={<AlarmClockOff />}
          label="Wake now"
          onSelect={() => choose({ Kind: "unsnooze" })}
        />
      </Show>
      <Show when={presets().length > 0 || snoozed()}>
        <div class="menu-separator" />
      </Show>
      <Show
        when={settled()}
        fallback={
          <MenuItem icon={<Check />} label="Settle" onSelect={() => choose({ Kind: "settle" })} />
        }
      >
        <MenuItem
          icon={<Undo2 />}
          label="Un-settle"
          onSelect={() => choose({ Kind: "unsettle" })}
        />
      </Show>
      <Show
        when={pinned()}
        fallback={<MenuItem icon={<Pin />} label="Pin" onSelect={() => choose({ Kind: "pin" })} />}
      >
        <MenuItem icon={<PinOff />} label="Unpin" onSelect={() => choose({ Kind: "unpin" })} />
      </Show>
      <MenuItem
        icon={<PenLine />}
        label="Rename"
        onSelect={() => {
          props.onRename();
          props.onClose();
        }}
      />
      <MenuItem
        icon={<Mail />}
        label="Mark unread"
        onSelect={() => choose({ Kind: "markUnread" })}
      />
      <div class="menu-separator" />
      <Show
        when={confirmingDelete()}
        fallback={
          <MenuItem
            icon={<Trash2 />}
            label="Delete"
            danger
            onSelect={() => setConfirmingDelete(true)}
          />
        }
      >
        <MenuItem
          icon={<Trash2 />}
          label="Delete this thread?"
          detail="Can't be undone"
          danger
          onSelect={() => choose({ Kind: "delete" })}
        />
      </Show>
    </Popup>
  );
}

function FolderHeader(props: {
  folder: IProjectFolder;
  open: boolean;
  renaming: boolean;
  onToggle: () => void;
  onMenu: (x: number, y: number) => void;
  onRenamed: (title: string | null) => void;
}) {
  const environment = Environment.use();
  const title = () => props.folder.Project?.title ?? "Unknown project";
  const needsYou = () =>
    props.folder.Threads.some((thread) => {
      const status = sidebarStatus(thread);
      return status !== null && status !== "working";
    });
  return (
    <li>
      <div
        class="section-header folder-header"
        role="button"
        tabindex="0"
        aria-expanded={props.open}
        onClick={props.onToggle}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          props.onToggle();
        }}
        onContextMenu={(event) => {
          if (props.folder.Project === undefined) return;
          event.preventDefault();
          props.onMenu(event.clientX, event.clientY);
        }}
      >
        <ChevronRight class="section-chevron" classList={{ open: props.open }} />
        <ProjectBadge name={title()} size={12} />
        <Show when={props.renaming} fallback={<span class="folder-title">{title()}</span>}>
          <RenameInput title={title()} onDone={props.onRenamed} />
        </Show>
        <Show when={props.folder.Project?.pinnedAt != null}>
          <Pin class="folder-pin" />
        </Show>
        <Show when={!props.open && needsYou()}>
          <span class="folder-dot" aria-label="Needs you" />
        </Show>
        <span class="section-count">{props.folder.Threads.length}</span>
        <Show when={props.folder.Project !== undefined}>
          <span class="card-actions folder-actions">
            <button
              type="button"
              class="card-action"
              aria-label={`New thread in ${title()}`}
              data-tip="New thread"
              onClick={(event) => {
                event.stopPropagation();
                environment.newThread(props.folder.ProjectId);
              }}
            >
              <SquarePen />
            </button>
            <button
              type="button"
              class="card-action"
              aria-label="Project actions"
              data-tip="Project actions"
              onClick={(event) => {
                event.stopPropagation();
                props.onMenu(event.clientX, event.clientY);
              }}
            >
              <Ellipsis />
            </button>
          </span>
        </Show>
      </div>
    </li>
  );
}

function folderTitle(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || path
  );
}

function AddProjectForm(props: { onClose: () => void }) {
  const environment = Environment.use();
  const [path, setPath] = createSignal("");
  const submit = () => {
    const root = path().trim();
    if (root === "") return;
    environment.projectCommand(null, {
      Kind: "create",
      Title: folderTitle(root),
      WorkspaceRoot: root,
    });
    props.onClose();
  };
  return (
    <form
      class="add-project"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        class="card-rename"
        aria-label="Project folder"
        placeholder="Folder on the server, e.g. E:\Code\app"
        value={path()}
        ref={(input) => queueMicrotask(() => input.focus())}
        onInput={(event) => setPath(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onClose();
        }}
      />
      <button type="submit" class="card-action" disabled={path().trim() === ""}>
        Add
      </button>
    </form>
  );
}

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
    shell.sidebarThreads().some((thread) => sidebarStatus(thread) === "working"),
  );
  createEffect(() => {
    if (!anyWorking()) return;
    setSecond(Date.now());
    const ticking = setInterval(() => setSecond(Date.now()), SECOND);
    onCleanup(() => clearInterval(ticking));
  });
  const sections = createMemo(() => sidebarSections(shell.sidebarThreads(), now()));
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
        <AddProjectForm onClose={() => setAddingProject(false)} />
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
