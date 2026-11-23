// @effect-diagnostics globalDate:off -- View-only timers and snooze presets, outside any Effect runtime.
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import {
  resolveSnoozePresets,
  type SnoozePreset,
} from "@t3tools/client-runtime/state/thread-settled";
import { findSearchTokenRanges, type SearchRange } from "@t3tools/shared/paletteSearch";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";

import { ProjectBadge, ProviderIcon } from "./brand";
import Environment from "./Environment";
import { Highlighted } from "./Highlighted";
import {
  AlarmClockOff,
  Archive,
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
  RefreshCw,
  ShieldQuestion,
  Trash2,
  Undo2,
} from "./icons";
import type { IThreadCommand } from "./Infrastructure/commandEffects";
import type { IWireThreadShell } from "./Infrastructure/wire";
import { useNavigation } from "./navigation";
import Shell, {
  activityAt,
  canArchive,
  canSnooze,
  isBusy,
  type ISidebarStatus,
  isSnoozed,
  sidebarStatus,
  workingStartedAt,
} from "./Shell";
import { modelDisplay } from "./ThreadSession";
import { relativeTime, shortTimestamp, timeUntil } from "./timestamps";
import {
  MenuItem,
  MenuItemDetail,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "./ui/Menu";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/AlertDialog";
import { Button } from "./ui/Button";
import { toastManager } from "./ui/toastStore";
import { hoverCard } from "./ui/Tooltip";
import { longPress, useSidebarSheet } from "./viewport";

const HOVER_LINE =
  "flex min-w-0 items-center gap-2 [&_.provider-icon]:opacity-60 [&_.provider-icon]:grayscale [&_span]:min-w-0 [&_span]:truncate [&_svg.lucide]:size-3";
const hoverLine = `${HOVER_LINE} [&_span]:text-[color-mix(in_srgb,var(--foreground)_75%,transparent)]`;

const CARD_LINE = "relative flex h-5 min-w-0 items-center gap-1.5 bg-inherit";
const TITLE_LINE = "relative flex min-h-5 min-w-0 items-start gap-1.5 bg-inherit";
const MARK = "[&_mark]:bg-transparent [&_mark]:font-bold [&_mark]:text-inherit";
// On touch a tap leaves :hover and focus on the card it selected, so there the status stays and
// the actions open by long-press; only keyboard focus swaps them.
const CARD_SLOT =
  "inline-flex h-5 flex-none items-center group-hover/card:invisible group-focus-visible/card:invisible group-has-[:focus-visible]/card:invisible [@media(hover:hover)]:group-focus-within/card:invisible";
// Laid over the line's end on the row's own background, so showing them can't rewrap the title.
const CARD_ACTIONS =
  "invisible absolute top-0 -right-1 inline-flex h-5 items-center gap-0.5 bg-inherit pl-1 before:absolute before:inset-y-0 before:right-full before:w-4 before:bg-inherit before:[mask-image:linear-gradient(to_right,transparent,black)] group-hover/card:visible group-focus-visible/card:visible group-has-[:focus-visible]/card:visible [@media(hover:hover)]:group-focus-within/card:visible";
const CARD_ACTION =
  "inline-flex h-5 cursor-pointer items-center gap-1 rounded-sm border-0 bg-transparent px-1 py-0 text-[12px] leading-4 text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5";

export const STATUS_TONE: Record<NonNullable<ISidebarStatus>, string> = {
  preparing: "text-info-foreground",
  working: "text-info-foreground",
  waiting: "text-sidebar-muted-foreground",
  approval: "text-warning-foreground",
  input: "text-(--input-status)",
  failed: "text-error-foreground",
  done: "text-success-foreground",
};

export const STATUS_LABEL: Record<NonNullable<ISidebarStatus>, string> = {
  preparing: "Setting up",
  working: "Working",
  waiting: "Waiting",
  approval: "Approval",
  input: "Input",
  failed: "Failed",
  done: "Done",
};

function StatusIcon(props: { status: NonNullable<ISidebarStatus> }) {
  return (
    <Switch>
      <Match when={isBusy(props.status) || props.status === "waiting"}>
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
  status: ISidebarStatus;
  statusText: string;
}) {
  const environment = Environment.use();
  return (
    <div class="flex min-w-0 flex-col gap-2 px-1 py-2">
      <div class="truncate leading-tight font-medium">{props.thread.title}</div>
      <div class="grid gap-1.5 pl-0.5 text-muted-foreground">
        <Show when={props.status}>
          {(held) => (
            <div class={`${HOVER_LINE} font-medium ${STATUS_TONE[held()]}`}>
              <StatusIcon status={held()} />
              <span>{props.statusText}</span>
            </div>
          )}
        </Show>
        <div class={hoverLine}>
          <ProjectBadge
            project={environment.state.Replica.Shell.Projects[props.thread.projectId]}
            size={12}
          />
          <span>{props.projectName}</span>
        </div>
        <Show when={props.thread.branch}>
          {(branch) => (
            <div class={hoverLine}>
              <GitBranch />
              <span>{branch()}</span>
            </div>
          )}
        </Show>
        <div class={hoverLine}>
          <ProviderIcon driver={props.model.Driver} size={12} />
          <span>{props.model.Name}</span>
        </div>
        <Show when={props.previousProviders.length > 0}>
          <div class={hoverLine}>
            <ArrowRightLeft />
            <span>Handed off from {props.previousProviders.join(", ")}</span>
          </div>
        </Show>
        <Show when={props.thread.lastError}>
          <div
            class={
              props.thread.lastErrorClass === "usage_limit"
                ? `${HOVER_LINE} text-warning-foreground [&_span]:text-warning-foreground`
                : `${HOVER_LINE} text-error-foreground [&_span]:text-error-foreground`
            }
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
      class="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 py-0 text-[14px] leading-[18px] font-medium outline-none focus:border-foreground"
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
  /** Inside a project folder: one line, without the project. */
  compact: boolean;
  showProvider: boolean;
  renaming: boolean;
  second: number;
  onMenu: (x: number, y: number) => void;
  onRenameEnd: () => void;
  /** Starts a drag that reorders the row; a touch drag's long-press also stands in for the menu's. */
  onDragStart?: ((event: PointerEvent) => void) | undefined;
  dragging?: boolean;
  /** In the sidebar's multi-selection; a search result never is. */
  multiSelected?: boolean;
  /** Takes a click that changes the multi-selection, returning whether it did. */
  onSelectionClick?: ((event: MouseEvent) => boolean) | undefined;
  /** As a search result: where the title matches, the matching message, and the keyboard's row. */
  search?:
    | {
        ranges: ReadonlyArray<SearchRange>;
        snippet: string | null;
        query: string;
        highlighted: boolean;
        id: string;
        onSelect: () => void;
        onHover: () => void;
      }
    | undefined;
}) {
  const environment = Environment.use();
  const shell = Shell.use();
  const sidebar = useSidebarSheet();
  const selected = () => shell.sidebarRowThreadId() === props.thread.id;
  const now = () => environment.minute();
  const providers = () => environment.state.Replica.Providers;
  const model = () => modelDisplay(providers(), props.thread.modelSelection);
  const projectName = () =>
    shell.state.Projects[props.thread.projectId]?.title ?? "Unknown project";
  const select = () => {
    sidebar.choseThread();
    if (props.search) props.search.onSelect();
    else void environment.selectThread(props.thread.id);
  };
  const renamed = (title: string | null) => {
    props.onRenameEnd();
    const trimmed = title?.trim();
    // Follows the empty-title warning in apps/web/src/components/Sidebar.tsx.
    if (trimmed === "")
      toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
    else if (trimmed && trimmed !== props.thread.title) {
      environment.threadCommand(props.thread.id, { Kind: "rename", Title: trimmed });
    }
  };
  const status = () => {
    const held = sidebarStatus(props.thread, shell.subagentRequests()[props.thread.id]);
    return held === "done" && selected() ? null : held;
  };
  const workingFor = () => {
    const started = workingStartedAt(props.thread);
    return started === null ? null : formatWorkingDurationLabel(props.second - Date.parse(started));
  };
  const statusText = () => {
    const held = status();
    if (held === null) return "";
    const elapsed = isBusy(held) || held === "waiting" ? workingFor() : null;
    return elapsed === null ? STATUS_LABEL[held] : `${STATUS_LABEL[held]} ${elapsed}`;
  };
  const hover = {
    get thread() {
      return props.thread;
    },
    get projectName() {
      return projectName();
    },
    get model() {
      return model();
    },
    get previousProviders() {
      return (props.thread.providerInstanceHistory ?? [])
        .filter((instanceId) => instanceId !== props.thread.modelSelection.instanceId)
        .map(
          (instanceId) =>
            providers().find((provider) => provider.InstanceId === instanceId)?.Name ?? instanceId,
        );
    },
    get status() {
      return status();
    },
    get statusText() {
      return statusText();
    },
  };
  const act = (event: MouseEvent, command: IThreadCommand) => {
    event.stopPropagation();
    environment.threadCommand(props.thread.id, command);
  };
  const press = longPress((x, y) => props.onMenu(x, y));
  const title = () => (
    <Show
      when={props.renaming}
      fallback={
        <span
          class={`line-clamp-2 min-w-0 flex-1 text-[14px] wrap-anywhere leading-5 font-medium text-sidebar-foreground group-data-receded/card:font-normal group-data-receded/card:text-[color-mix(in_srgb,var(--sidebar-foreground)_75%,transparent)] group-data-receded/card:group-hover/card:text-sidebar-foreground data-regenerating:opacity-60 ${MARK}`}
          data-regenerating={props.thread.titleRegeneration != null ? "" : undefined}
          aria-busy={props.thread.titleRegeneration != null ? "true" : undefined}
        >
          <Show when={props.search} fallback={props.thread.title}>
            {(search) => <Highlighted text={props.thread.title} ranges={search().ranges} />}
          </Show>
          <Show when={props.thread.titleRegeneration != null}>
            <span role="status" class="sr-only">
              Regenerating title
            </span>
          </Show>
        </span>
      }
    >
      <RenameInput title={props.thread.title} onDone={renamed} />
    </Show>
  );
  const provider = () => (
    <Show when={props.showProvider}>
      <span class="flex h-5 flex-none items-center">
        <ProviderIcon driver={model().Driver} size={14} />
      </span>
    </Show>
  );
  return (
    <li
      class="data-dragging:opacity-40"
      id={props.search?.id}
      role={props.search ? "option" : undefined}
      aria-selected={props.search ? (props.search.highlighted ? "true" : "false") : undefined}
      data-pin-id={props.onDragStart ? props.thread.id : undefined}
      data-pin-folder={props.onDragStart ? props.thread.projectId : undefined}
      data-dragging={props.dragging ? "" : undefined}
    >
      <div
        class="group/card block w-full cursor-pointer rounded-md border-0 bg-transparent px-2.5 py-2 text-left not-data-selected:not-data-multi-selected:hover:bg-sidebar-row-hover not-data-selected:not-data-multi-selected:focus-visible:bg-sidebar-row-hover not-data-selected:not-data-multi-selected:has-[:focus-visible]:bg-sidebar-row-hover data-multi-selected:not-data-selected:bg-sidebar-row-selected data-multi-selected:not-data-selected:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--sidebar-border)_70%,transparent)] data-compact:py-1.5 data-dimmed:opacity-70 data-dimmed:hover:opacity-100 data-highlighted:not-data-selected:bg-sidebar-row-hover data-highlighted:not-data-selected:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ring)_50%,transparent)] data-selected:bg-sidebar-row-active data-selected:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--sidebar-border)_70%,transparent)] [@media(hover:none)]:select-none [@media(hover:none)]:[-webkit-touch-callout:none]"
        role="button"
        tabindex="0"
        data-tip=""
        data-tip-side="right"
        data-tip-align="start"
        ref={hoverCard(ThreadHoverCard, hover)}
        data-compact={props.compact ? "" : undefined}
        data-pinned={props.thread.pinnedAt != null ? "" : undefined}
        data-selected={selected() ? "" : undefined}
        data-multi-selected={props.multiSelected === true ? "" : undefined}
        aria-pressed={props.onSelectionClick && props.multiSelected === true ? "true" : undefined}
        data-highlighted={props.search?.highlighted === true ? "" : undefined}
        data-receded={
          !selected() &&
          props.multiSelected !== true &&
          (status() === null ||
            isBusy(status()) ||
            status() === "waiting" ||
            status() === "approval")
            ? ""
            : undefined
        }
        data-dimmed={
          !selected() && props.multiSelected !== true && isBusy(status()) ? "" : undefined
        }
        onClick={(event) => {
          if (press.swallowsClick() || props.onSelectionClick?.(event) === true) return;
          select();
        }}
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
        onPointerDown={(event) => {
          const drag = props.renaming ? undefined : props.onDragStart;
          if (drag !== undefined && !(event.target as Element).closest("button, input")) {
            drag(event);
            if (event.pointerType === "touch") return;
          }
          press.onPointerDown(event);
        }}
        onPointerMove={(event) => {
          press.onPointerMove(event);
          if (props.search && !props.search.highlighted) props.search.onHover();
        }}
        onPointerUp={press.onPointerUp}
        onPointerCancel={press.onPointerCancel}
      >
        <span class={props.compact ? TITLE_LINE : CARD_LINE}>
          <Show
            when={props.compact}
            fallback={
              <>
                <ProjectBadge
                  project={environment.state.Replica.Shell.Projects[props.thread.projectId]}
                />
                <span class="min-w-0 flex-1 truncate text-[12px] leading-4 text-secondary-label">
                  {projectName()}
                </span>
              </>
            }
          >
            {title()}
            {provider()}
          </Show>
          {/* Outside the slot, which hover and focus hide from the accessibility tree too. */}
          <span class="sr-only">{statusText()}</span>
          <span class={CARD_SLOT}>
            <Show
              when={status()}
              fallback={
                <span class="flex-none text-[12px] leading-4 text-secondary-label tabular-nums">
                  {props.section === "snoozed"
                    ? timeUntil(props.thread.snoozedUntil ?? "", now())
                    : relativeTime(activityAt(props.thread) ?? props.thread.updatedAt, now())}
                </span>
              }
            >
              {(held) => (
                <span
                  class={`inline-flex flex-none items-center gap-1 text-[12px] leading-4 font-medium ${STATUS_TONE[held()]}`}
                >
                  <StatusIcon status={held()} />
                  <Show when={isBusy(held()) && workingFor()}>
                    {(elapsed) => (
                      <span class="tabular-nums" aria-hidden="true">
                        {elapsed()}
                      </span>
                    )}
                  </Show>
                </span>
              )}
            </Show>
          </span>
          <span class={CARD_ACTIONS}>
            <Switch>
              <Match when={props.section === "settled"}>
                <button
                  type="button"
                  class={CARD_ACTION}
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
                  class={CARD_ACTION}
                  aria-label="Wake thread now"
                  data-tip="Wake thread now"
                  onClick={(event) => act(event, { Kind: "unsnooze" })}
                >
                  <AlarmClockOff />
                </button>
              </Match>
              <Match when={selected()}>
                <button
                  type="button"
                  class={CARD_ACTION}
                  aria-label="Settle thread"
                  data-tip="Settle thread"
                  onClick={(event) => {
                    event.stopPropagation();
                    environment.settleThread(props.thread.id);
                  }}
                >
                  <Check />
                  Settle
                </button>
              </Match>
            </Switch>
            <button
              type="button"
              class={CARD_ACTION}
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
        <Show when={!props.compact}>
          <span class={`${TITLE_LINE} mt-1 [&_.provider-icon]:opacity-60`}>
            {title()}
            {provider()}
          </span>
        </Show>
        <Show when={props.search?.snippet}>
          {(snippet) => (
            <span class={`mt-1 line-clamp-2 text-[12px] leading-4 text-secondary-label ${MARK}`}>
              <Highlighted
                text={snippet()}
                ranges={findSearchTokenRanges(snippet(), props.search?.query ?? "")}
              />
            </span>
          )}
        </Show>
      </div>
    </li>
  );
}

function useSnoozePresets(canSnoozeNow: () => boolean) {
  const environment = Environment.use();
  return createMemo(() =>
    canSnoozeNow()
      ? resolveSnoozePresets(new Date(environment.minute()), {
          formatTime: (date) => shortTimestamp(date.toISOString(), environment.timestampFormat()),
        })
      : [],
  );
}

function SnoozeSubmenu(props: {
  label: string;
  presets: ReadonlyArray<SnoozePreset>;
  onSnooze: (until: string) => void;
  onCustom: () => void;
}) {
  return (
    <MenuSub>
      <MenuSubTrigger>
        <Clock />
        {props.label}
      </MenuSubTrigger>
      <MenuSubPopup>
        <For each={props.presets}>
          {(preset) => (
            <MenuItem onClick={() => props.onSnooze(preset.snoozedUntil)}>
              {preset.label}
              <MenuItemDetail>{preset.whenLabel}</MenuItemDetail>
            </MenuItem>
          )}
        </For>
        <Show when={props.presets.length > 0}>
          <MenuSeparator />
        </Show>
        <MenuItem onClick={props.onCustom}>Custom…</MenuItem>
      </MenuSubPopup>
    </MenuSub>
  );
}

export function ThreadMenu(props: {
  thread: IWireThreadShell;
  x: number;
  y: number;
  onRename: () => void;
  onConfirm: (kind: IThreadConfirmation) => void;
  onCustomSnooze: () => void;
  onClose: () => void;
}) {
  const environment = Environment.use();
  const shell = Shell.use();
  const navigation = useNavigation();
  const now = () => environment.minute();
  const subagent = () => shell.subagentRequests()[props.thread.id];
  const snoozed = () => isSnoozed(props.thread, now(), subagent());
  const settled = () => props.thread.settledOverride === "settled";
  const pinned = () => props.thread.pinnedAt != null;
  const canSnoozeNow = () => !snoozed() && canSnooze(props.thread, subagent(), now());
  const presets = useSnoozePresets(canSnoozeNow);
  const regenerating = () => props.thread.titleRegeneration != null;
  const run = (command: IThreadCommand) => environment.threadCommand(props.thread.id, command);
  return (
    <MenuPopup
      anchor={{ X: props.x, Y: props.y }}
      side="bottom"
      align="start"
      sideOffset={0}
      label="Thread actions"
      onClose={props.onClose}
    >
      <Show when={canSnoozeNow()}>
        <SnoozeSubmenu
          label="Snooze"
          presets={presets()}
          onSnooze={(until) => run({ Kind: "snooze", Until: until })}
          onCustom={props.onCustomSnooze}
        />
      </Show>
      <Show when={snoozed()}>
        <MenuItem onClick={() => run({ Kind: "unsnooze" })}>
          <AlarmClockOff />
          Wake now
        </MenuItem>
      </Show>
      <Show when={canSnoozeNow() || snoozed()}>
        <MenuSeparator />
      </Show>
      <Switch>
        <Match when={settled()}>
          <MenuItem onClick={() => run({ Kind: "unsettle" })}>
            <Undo2 />
            Un-settle
          </MenuItem>
        </Match>
        <Match when={environment.state.Local.SelectedThreadId === props.thread.id}>
          <MenuItem onClick={() => environment.settleThread(props.thread.id)}>
            <Check />
            Settle
          </MenuItem>
        </Match>
      </Switch>
      <Show
        when={pinned()}
        fallback={
          <MenuItem onClick={() => run({ Kind: "pin" })}>
            <Pin />
            Pin
          </MenuItem>
        }
      >
        <MenuItem
          onClick={() =>
            environment.confirmThreadUnpin() ? props.onConfirm("unpin") : run({ Kind: "unpin" })
          }
        >
          <PinOff />
          Unpin
        </MenuItem>
      </Show>
      <MenuItem onClick={props.onRename}>
        <PenLine />
        Rename
        <Show when={navigation.shortcut("thread.rename")}>
          {(shortcut) => <MenuShortcut>{shortcut()}</MenuShortcut>}
        </Show>
      </MenuItem>
      <MenuItem
        disabled={regenerating()}
        onClick={() => void environment.regenerateTitles([props.thread.id])}
      >
        <RefreshCw />
        {regenerating() ? "Regenerating…" : "Regenerate title"}
        <Show when={navigation.shortcut("thread.regenerateTitle")}>
          {(shortcut) => <MenuShortcut>{shortcut()}</MenuShortcut>}
        </Show>
      </MenuItem>
      <MenuItem onClick={() => run({ Kind: "markUnread" })}>
        <Mail />
        Mark unread
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        disabled={!canArchive(props.thread)}
        onClick={() =>
          environment.confirmThreadArchive()
            ? props.onConfirm("archive")
            : void environment.archiveThread(props.thread.id)
        }
      >
        <Archive />
        Archive
      </MenuItem>
      <MenuItem
        variant="destructive"
        onClick={() =>
          environment.confirmThreadDelete() ? props.onConfirm("delete") : run({ Kind: "delete" })
        }
      >
        <Trash2 />
        Delete
      </MenuItem>
    </MenuPopup>
  );
}

// Follows handleMultiSelectContextMenu in apps/web/src/components/Sidebar.tsx, and
// buildBulkTitleRegenerationContextMenuItem and buildBulkUnpinContextMenuItem in Sidebar.logic.ts.
export function BulkThreadMenu(props: {
  threads: IWireThreadShell[];
  x: number;
  y: number;
  onDelete: () => void;
  onCustomSnooze: () => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const environment = Environment.use();
  const shell = Shell.use();
  const count = () => props.threads.length;
  const ids = () => props.threads.map((thread) => thread.id);
  const pinned = () => props.threads.filter((thread) => thread.pinnedAt != null);
  const unsettled = () => props.threads.filter((thread) => thread.settledOverride !== "settled");
  const regeneratable = () => props.threads.filter((thread) => thread.titleRegeneration == null);
  const canSnoozeAll = () =>
    props.threads.every((thread) =>
      canSnooze(thread, shell.subagentRequests()[thread.id], environment.minute()),
    );
  const presets = useSnoozePresets(canSnoozeAll);
  const each = (threads: IWireThreadShell[], command: IThreadCommand) => {
    for (const thread of threads) void environment.threadCommand(thread.id, command);
    props.onDone();
  };
  return (
    <MenuPopup
      anchor={{ X: props.x, Y: props.y }}
      side="bottom"
      align="start"
      sideOffset={0}
      label={`Actions for ${count()} threads`}
      onClose={props.onClose}
    >
      <Show when={pinned().length > 0}>
        <MenuItem onClick={() => each(pinned(), { Kind: "unpin" })}>
          <PinOff />
          Unpin ({pinned().length})
        </MenuItem>
      </Show>
      <MenuItem
        disabled={unsettled().length === 0}
        onClick={() => {
          void environment.settleThreads(unsettled().map((thread) => thread.id));
          props.onDone();
        }}
      >
        <Check />
        Settle ({count()})
      </MenuItem>
      <Show when={canSnoozeAll()}>
        <SnoozeSubmenu
          label={`Snooze (${count()})`}
          presets={presets()}
          onSnooze={(until) => each(props.threads, { Kind: "snooze", Until: until })}
          onCustom={props.onCustomSnooze}
        />
      </Show>
      <MenuItem
        disabled={regeneratable().length === 0}
        onClick={() => {
          void environment.regenerateTitles(regeneratable().map((thread) => thread.id));
          props.onDone();
        }}
      >
        <RefreshCw />
        {regeneratable().length === 0
          ? `Regenerating… (${count()})`
          : `Regenerate titles (${regeneratable().length})`}
      </MenuItem>
      <MenuItem onClick={() => each(props.threads, { Kind: "markUnread" })}>
        <Mail />
        Mark unread ({count()})
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        variant="destructive"
        onClick={() => {
          if (environment.confirmThreadDelete()) props.onDelete();
          else {
            for (const id of ids()) void environment.threadCommand(id, { Kind: "delete" });
            props.onDone();
          }
        }}
      >
        <Trash2 />
        Delete ({count()})
      </MenuItem>
    </MenuPopup>
  );
}

export type IThreadConfirmation = "unpin" | "archive" | "delete";

// Follows requestThreadUnpinConfirmation and confirmAndDeleteThread in
// apps/web/src/hooks/useThreadActions.ts, the archive confirmation in Sidebar.tsx, and the
// bulk delete one in handleMultiSelectContextMenu, shown as ConfirmDialogHost.tsx shows them.
const CONFIRMATION_COPY: Record<IThreadConfirmation, { Title: string; Description: string }> = {
  unpin: {
    Title: "Unpin thread",
    Description: "This will move the thread out of your pinned section.",
  },
  archive: { Title: "Archive thread", Description: "" },
  delete: {
    Title: "Delete thread",
    Description: "This permanently clears conversation history for this thread.",
  },
};

export function ThreadConfirmDialog(props: {
  kind: IThreadConfirmation;
  /** The thread's title, or how many threads a bulk delete takes. */
  title: string | number;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const copy = () =>
    typeof props.title === "number"
      ? {
          Title: `Delete ${props.title} ${props.title === 1 ? "thread" : "threads"}?`,
          Description: "This permanently clears conversation history for these threads.",
        }
      : {
          Title: `${CONFIRMATION_COPY[props.kind].Title} "${props.title}"?`,
          Description: CONFIRMATION_COPY[props.kind].Description,
        };
  return (
    <AlertDialog onClose={props.onClose}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy().Title}</AlertDialogTitle>
          <Show when={copy().Description}>
            <AlertDialogDescription class="whitespace-pre-line">
              {copy().Description}
            </AlertDialogDescription>
          </Show>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose variant="outline">Cancel</AlertDialogClose>
          <Button
            variant={props.kind === "delete" ? "destructive" : "default"}
            onClick={() => {
              props.onClose();
              props.onConfirm();
            }}
          >
            Confirm
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
