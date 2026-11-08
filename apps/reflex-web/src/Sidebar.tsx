// @effect-diagnostics globalDate:off globalTimers:off -- View-only ticks for relative times, outside any Effect runtime.
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import { resolveSnoozePresets } from "@t3tools/client-runtime/state/thread-settled";
import { useResource } from "reflex-solid";
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
} from "./icons";
import type { IThreadCommand, IWireModelSelection } from "./Infrastructure/commandEffects";
import type { IWireThreadShell } from "./Infrastructure/wire";
import Shell, {
  type ISidebarStatus,
  isSnoozed,
  sidebarSections,
  sidebarStatus,
  workingStartedAt,
} from "./Shell";
import { StageArt } from "./StageArt";
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
  onSelect: () => void;
  onCommand: (command: IThreadCommand) => void;
  onMenu: (x: number, y: number) => void;
  onRenamed: (title: string | null) => void;
}) {
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
    props.onCommand(command);
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
        onClick={props.onSelect}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          props.onSelect();
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

function ThreadMenu(props: {
  thread: IWireThreadShell;
  x: number;
  y: number;
  now: number;
  onCommand: (command: IThreadCommand) => void;
  onRename: () => void;
  onClose: () => void;
}) {
  const [menuElement, setMenuElement] = createSignal<HTMLDivElement>();
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
    props.onCommand(command);
    props.onClose();
  };
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
    <div class="thread-menu" role="menu" aria-label="Thread actions" ref={setMenuElement}>
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
    </div>
  );
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

export const Sidebar = Shell.provider<{
  selected: string | null;
  currentProjectId: string | null;
  commandError: string | undefined;
  modelOf: (selection: IWireModelSelection) => IModelDisplay;
  providerName: (instanceId: string) => string;
  onSelect: (id: string) => void;
  onNewThread: (projectId: string) => void;
  onCommand: (threadId: string, command: IThreadCommand) => void;
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
  // A collapsed shelf still shows the open thread, so its row doesn't vanish on settling it.
  const shelf = (threads: IWireThreadShell[], open: boolean, limit = Infinity) =>
    open ? threads.slice(0, limit) : threads.filter((thread) => thread.id === props.selected);
  const projects = () =>
    Object.values(shell.state.Projects).filter((project) => project.archivedAt == null);
  const targetProject = () => props.currentProjectId ?? projects()[0]?.id ?? null;
  const card = (thread: IWireThreadShell, section: ICardSection) => (
    <ThreadCard
      thread={thread}
      section={section}
      projectName={shell.state.Projects[thread.projectId]?.title ?? "Unknown project"}
      model={props.modelOf(thread.modelSelection)}
      previousProviders={(thread.providerInstanceHistory ?? [])
        .filter((instanceId) => instanceId !== thread.modelSelection.instanceId)
        .map((instanceId) => props.providerName(instanceId))}
      selected={props.selected === thread.id}
      renaming={renaming() === thread.id}
      now={now()}
      second={second()}
      onSelect={() => props.onSelect(thread.id)}
      onCommand={(command) => props.onCommand(thread.id, command)}
      onMenu={(x, y) => setMenu({ Id: thread.id, X: x, Y: y })}
      onRenamed={(title) => {
        setRenaming(null);
        const trimmed = title?.trim();
        if (trimmed && trimmed !== thread.title) {
          props.onCommand(thread.id, { Kind: "rename", Title: trimmed });
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
      <Show when={props.commandError}>
        <p class="sidebar-error">That didn't work: {props.commandError}</p>
      </Show>
      <Show
        when={shell.sidebarThreads().length > 0}
        fallback={
          <p class="empty">{shell.state.Synchronized ? "No threads yet." : "Loading threads…"}</p>
        }
      >
        <ul class="thread-list">
          <For each={sections().Pinned}>{(thread) => card(thread, "pinned")}</For>
          <Show when={sections().Pinned.length > 0 && sections().Active.length > 0}>
            <li class="section-divider" />
          </Show>
          <For each={sections().Active}>{(thread) => card(thread, "active")}</For>
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
            onCommand={(command) => props.onCommand(thread.id, command)}
            onRename={() => setRenaming(thread.id)}
            onClose={() => setMenu(null)}
          />
        )}
      </Show>
    </nav>
  );
});
