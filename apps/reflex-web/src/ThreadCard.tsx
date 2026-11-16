// @effect-diagnostics globalDate:off -- View-only snooze presets from the sidebar's tick, outside any Effect runtime.
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import { resolveSnoozePresets } from "@t3tools/client-runtime/state/thread-settled";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";

import { ProjectBadge, ProviderIcon } from "./brand";
import Environment from "./Environment";
import {
  AlarmClockOff,
  ArrowRightLeft,
  Check,
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
  Trash2,
  Undo2,
} from "./icons";
import type { IThreadCommand } from "./Infrastructure/commandEffects";
import type { IWireThreadShell } from "./Infrastructure/wire";
import { MenuItem, Popup } from "./Menu";
import Shell, {
  activityAt,
  canSnooze,
  isBusy,
  type ISidebarStatus,
  isSnoozed,
  sidebarStatus,
  workingStartedAt,
} from "./Shell";
import { relativeTime, timeUntil } from "./timestamps";
import { hoverCard } from "./tooltip";

const STATUS_LABEL: Record<NonNullable<ISidebarStatus>, string> = {
  preparing: "Setting up",
  working: "Working",
  approval: "Approval",
  input: "Input",
  failed: "Failed",
  done: "Done",
};

function StatusIcon(props: { status: NonNullable<ISidebarStatus> }) {
  return (
    <Switch>
      <Match when={isBusy(props.status)}>
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

export type ICardSection = "active" | "pinned" | "snoozed" | "settled";

export function RenameInput(props: { title: string; onDone: (title: string | null) => void }) {
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

export function ThreadCard(props: {
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
  const shell = Shell.use();
  const select = () => environment.selectThread(props.thread.id);
  const status = () => {
    const held = sidebarStatus(props.thread, shell.subagentRequests()[props.thread.id]);
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
            !props.selected && (status() === null || isBusy(status()) || status() === "approval"),
          dimmed: !props.selected && isBusy(status()),
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
                    : relativeTime(activityAt(props.thread) ?? props.thread.updatedAt, props.now)}
                </span>
              }
            >
              {(held) => (
                <span class={`card-status ${held()}`}>
                  <StatusIcon status={held()} />
                  {STATUS_LABEL[held()]}
                  <Show when={isBusy(held()) && workingFor()}>
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

export function ThreadMenu(props: {
  thread: IWireThreadShell;
  x: number;
  y: number;
  now: number;
  onRename: () => void;
  onClose: () => void;
}) {
  const environment = Environment.use();
  const shell = Shell.use();
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const subagent = () => shell.subagentRequests()[props.thread.id];
  const snoozed = () => isSnoozed(props.thread, props.now, subagent());
  const settled = () => props.thread.settledOverride === "settled";
  const pinned = () => props.thread.pinnedAt != null;
  const presets = createMemo(() =>
    snoozed() || !canSnooze(props.thread, subagent(), props.now)
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
