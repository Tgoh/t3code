import {
  summarizeToolGroup,
  toolGroupAction,
  workEntryDisplayIndicatesToolFailure,
} from "@t3tools/client-runtime/work-log/presentation";
import { IDLE_COMPACTING_LABELS } from "@t3tools/client-runtime/user-message";
import {
  turnChanges,
  turnHasChanges,
  type TurnRepositoryChanges,
} from "@t3tools/client-runtime/state/thread-repositories";
import type { AssetResource } from "@t3tools/contracts";
import { htmlRenderReferencesEqual } from "@t3tools/shared/htmlRender";
import { mcpAppReferencesEqual } from "@t3tools/shared/mcpApp";
import type { IAskId } from "treflex";
import { useComponentState, useDispatch, useInFlight } from "treflex-solid";
import { Dynamic } from "@solidjs/web";
import { type Component, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";

import { attachmentDetail } from "./attachmentIntake";
import { CommandOutput, ToolDetailNote, WORK_PRE } from "./CommandOutput";
import { compactionFailure, compactionLabel, compactionReason } from "./compaction";
import { CopyButton } from "./CopyButton";
import {
  Bot,
  Brain,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleAlert,
  CircleHelp,
  Download,
  File,
  FileDiff,
  FileSearch,
  Folder,
  FolderGit2,
  FolderOpen,
  GitFork,
  Globe,
  Link,
  ListTodo,
  MessageCircleQuestion,
  MessagesSquare,
  Minimize2,
  Pencil,
  Redo2,
  ShieldQuestion,
  SquarePen,
  Terminal,
  Wrench,
  Eye,
  Zap,
} from "./icons";
import { T3Mark } from "./brand";
import { SubagentNotification, SubagentRow } from "./SubagentRows";
import { INSPECTED_TYPES, ToolInspector } from "./ToolInspector";
import { notifiedSubagent } from "./subagents";
import Environment from "./Environment";
import type { IWireAttachment } from "./Infrastructure/commandEffects";
import { EMPTY_MEDIA_URL, type IMediaUrl, loadMediaUrl, mediaFailed } from "./markdownImage";
import type { IWireTurnItem } from "./Infrastructure/wire";
import { embedOf } from "./embeds";
import { HtmlRenderFrame } from "./HtmlRender";
import { McpAppFrame } from "./McpApp";
import { ItemRequestRow } from "./ItemRequestViews";
import { FileIcon, Markdown } from "./Markdown";
import {
  buildChangedFilesTree,
  changedFilesGroups,
  groupDiffPath,
  type IChangedFilesGroup,
  visibleChangedRows,
} from "./changedFilesTree";
import OpenThread, {
  diffTurnOf,
  fileChangeCounts,
  fileChangePath,
  isRowVisible,
  runMessage,
  timelineItem,
} from "./OpenThread";
import { focusComposerAtEnd } from "./composerFocus";
import { canForkItem } from "./rewind";
import { attachmentSource } from "./FilePanel";
import ThreadSession, {
  editFromHere,
  forkFromRun,
  type IRewindChoice,
  openAttachment,
} from "./ThreadSession";
import { dayAwareTimestamp, fullTimestamp } from "./timestamps";
import { Button, buttonVariants } from "./ui/Button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/AlertDialog";
import { Presence } from "./ui/Presence";
import { ADDED_TEXT, DIFF_COUNTS, REMOVED_TEXT } from "./ui/notes";
import { viewOf } from "./turnItemView";
import {
  attribution,
  displayText,
  fromItem,
  fromMessage,
  type IMessageFold,
  messageFold,
  steerLabel,
} from "./userMessage";
import { ImageDialog } from "./ImageDialog";
import { singleToolCallLabel, workEntryDisplayLabel, workLogEntry } from "./workLog";
import { useWorkspaceRoot } from "./workspaceRoot";

const WORK_TEXT = `${WORK_PRE} ml-7`;

const ERROR_TEXT =
  "m-0 ml-7 max-h-64 overflow-auto py-1 font-sans text-[14px] leading-[1.625] wrap-anywhere whitespace-pre-wrap text-[color-mix(in_srgb,var(--foreground)_80%,transparent)]";

const BUBBLE = "min-w-0 max-w-[80%] rounded-2xl bg-message";

const NOTE = "m-0 mr-1 flex items-center gap-1 text-[12px] text-muted-foreground [&_svg]:size-3";

const ACTIONS = "flex h-6 items-center gap-2 text-[12px] text-muted-foreground tabular-nums";

const ACTIONS_ON_HOVER =
  "opacity-0 transition-opacity duration-200 ease-[ease] group-hover/row:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100";

const IMAGE =
  "block h-48 max-w-full min-w-24 rounded-2xl object-cover outline outline-[color:var(--media-ring)] -outline-offset-1";

const FILE_OPEN =
  "group/file focus-visible:ring-ring/70 flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none";

const FOLD_LABEL = "max-w-[50%] flex-none truncate text-muted-foreground";

const WORK_LINE = "flex min-h-6 min-w-0 items-center gap-1.5 text-sm leading-relaxed";

export const WORK_ICON =
  "inline-flex size-6 flex-none items-center justify-center text-muted-foreground group-data-failed/row:text-tool-error-icon/40 group-data-[tone=error]/row:font-medium group-data-[tone=error]/row:text-destructive [&_svg]:stroke-2 [&_svg]:opacity-70 light:[&_svg]:brightness-60";

export const ROW_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70";

const SUMMARY = `group/line cursor-pointer list-none rounded-md group-data-action/row:pr-18 [&::-webkit-details-marker]:hidden ${ROW_FOCUS}`;

export const workLine = (tone?: string) =>
  tone === "quiet"
    ? `${WORK_LINE} text-muted-foreground`
    : tone === "error"
      ? `${WORK_LINE} font-medium text-destructive`
      : `${WORK_LINE} text-secondary-label`;

function Body(props: {
  id: string;
  text: string;
  format: "markdown" | "text" | "code";
  pre?: string | undefined;
}) {
  return (
    <Show
      when={props.format === "markdown"}
      fallback={<pre class={props.pre ?? WORK_PRE}>{props.text}</pre>}
    >
      <Markdown text={props.text} fromUser={false} id={props.id} />
    </Show>
  );
}

export function MessageTime(props: { at: string; class?: string }) {
  const environment = Environment.use();
  return (
    <span class={props.class} data-tip={fullTimestamp(props.at, environment.timestampFormat())}>
      {dayAwareTimestamp(props.at, environment.timestampFormat())}
    </span>
  );
}

const ROW_ICONS: Record<string, Component> = {
  reasoning: Brain,
  todo_list: ListTodo,
  command_execution: Terminal,
  file_change: SquarePen,
  file_search: FileSearch,
  web_search: Globe,
  dynamic_tool: Wrench,
  approval_request: ShieldQuestion,
  user_input_request: MessageCircleQuestion,
  secret_request: ShieldQuestion,
  link_request: Link,
  error: CircleAlert,
  fork: GitFork,
  compaction: Minimize2,
};

const NOTIFICATION_ICONS: Record<string, Component> = {
  subagent: Bot,
  delegated_task: Bot,
  command: Terminal,
  monitor: Eye,
  background_task: Zap,
  system: T3Mark,
};

function NotificationIcon(props: { item: Extract<IWireTurnItem, { type: "notification" }> }) {
  return (
    <span class={WORK_ICON}>
      <Dynamic
        component={
          props.item.outcome === "failed"
            ? CircleAlert
            : (NOTIFICATION_ICONS[props.item.source.kind] ?? Zap)
        }
      />
    </span>
  );
}

export function RowIcon(props: { type: string }) {
  return (
    <span class={WORK_ICON}>
      <Dynamic component={ROW_ICONS[props.type] ?? CircleHelp} />
    </span>
  );
}

type IWireCheckpoint = Extract<IWireTurnItem, { type: "checkpoint" }>;

const attachmentResource = (file: IWireAttachment): AssetResource => ({
  _tag: "attachment",
  attachmentId: file.id,
  ...(file.type === "image"
    ? {}
    : { fileName: file.name, mimeType: file.mimeType, disposition: "inline" as const }),
});

function UserAttachment(props: { environmentId: string; file: IWireAttachment; grouped: boolean }) {
  const local = useComponentState<IMediaUrl>(() => ({ ...EMPTY_MEDIA_URL }));
  const resource = untrack(() => attachmentResource(props.file));
  onSettled(() => {
    local.dispatch(loadMediaUrl, props.environmentId, resource);
  });
  return (
    <Show
      when={props.file.type === "image"}
      fallback={<AttachmentFile file={props.file} url={local.state.Url} />}
    >
      <AttachmentImage
        file={props.file}
        grouped={props.grouped}
        url={local.state.Url}
        failed={local.state.Failed}
        onError={() => local.dispatch(mediaFailed, props.environmentId, resource)}
      />
    </Show>
  );
}

function AttachmentFile(props: { file: IWireAttachment; url: string | null }) {
  const pastedText = () =>
    "source" in props.file &&
    props.file.source !== undefined &&
    "_tag" in props.file.source &&
    props.file.source._tag === "pasted-text";
  const label = () => (pastedText() ? "Pasted text" : props.file.name);
  const identity = () => (
    <>
      <span class="flex size-9 flex-none items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--background)_60%,transparent)] [&_svg]:size-4">
        <File />
      </span>
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-[14px] font-medium group-hover/file:underline">{label()}</span>
        <span class="text-[12px] text-muted-foreground tabular-nums">
          {attachmentDetail(props.file.name, props.file.sizeBytes, pastedText())}
        </span>
      </span>
    </>
  );
  const environment = Environment.use();
  const dispatch = useDispatch();
  // A side pane's attachment opens in the panel it sits in, which is the selected thread's.
  const preview = () => {
    const selected = environment.state.Local.SelectedThreadId;
    const session =
      selected === null ? undefined : environment.state.Local.ThreadSessions[selected];
    if (session !== undefined)
      void dispatch(openAttachment, session.$Id, attachmentSource(props.file));
  };
  return (
    <div class="flex w-64 max-w-full items-center gap-1 rounded-2xl bg-message py-2 pr-1 pl-2">
      <button type="button" class={FILE_OPEN} aria-label={`Preview ${label()}`} onClick={preview}>
        {identity()}
      </button>
      <Show when={props.url}>
        {(url) => (
          <>
            <a
              class={buttonVariants({ variant: "ghost-muted", size: "icon-xs" })}
              href={url()}
              download={props.file.name}
              aria-label={`Download ${label()}`}
              data-tip={`Download ${label()}`}
            >
              <Download />
            </a>
          </>
        )}
      </Show>
    </div>
  );
}

function AttachmentImage(props: {
  file: IWireAttachment;
  grouped: boolean;
  url: string | null;
  failed: boolean;
  onError: () => void;
}) {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <Show
      when={!props.failed}
      fallback={<span class="rounded-2xl bg-message px-3 py-2 text-[14px]">{props.file.name}</span>}
    >
      <Show when={props.url} fallback={<span class={`${IMAGE} w-48 bg-message`} />}>
        {(url) => (
          <>
            <button
              class="block max-w-full cursor-zoom-in rounded-2xl border-0 bg-transparent p-0"
              aria-label={`Preview ${props.file.name}`}
              onClick={() => setExpanded(true)}
            >
              <img
                class={`${IMAGE} w-auto data-grouped:rounded-br-md`}
                data-grouped={props.grouped ? "" : undefined}
                src={url()}
                alt={props.file.name}
                onError={() => props.onError()}
              />
            </button>
            <Presence when={expanded()}>
              {() => (
                <ImageDialog src={url()} alt={props.file.name} onClose={() => setExpanded(false)} />
              )}
            </Presence>
          </>
        )}
      </Show>
    </Show>
  );
}

function DiffCounts(props: { additions: number; deletions: number }) {
  return (
    <span class={DIFF_COUNTS}>
      <span class={ADDED_TEXT}>+{props.additions}</span>{" "}
      <span class={REMOVED_TEXT}>-{props.deletions}</span>
    </span>
  );
}

const CHANGED_ROW =
  "flex h-7 w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent py-1.5 pr-2 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&_svg]:size-3.5 [&_svg]:shrink-0";

// Follows ChangedFilesCard, ChangedFilesGroupSection and ChangedFilesTree in stock's
// apps/web/src/components/chat/ChangedFilesTree.tsx. The server sends at most 200 files per
// folder and `filesTotal` for the rest.
function ChangedFiles(props: {
  item: IWireCheckpoint;
  turn: number | null;
  repositories: ReadonlyArray<TurnRepositoryChanges> | undefined;
  class: string;
}) {
  const session = ThreadSession.use();
  const source = () => ({
    files: props.item.files,
    ...(props.item.filesTotal === undefined ? {} : { filesTotal: props.item.filesTotal }),
    ...(props.repositories === undefined ? {} : { repositories: props.repositories }),
  });
  const totals = () => turnChanges(source()).totals;
  const groups = createMemo(() =>
    changedFilesGroups(source(), session.projectName() ?? "Project folder"),
  );
  const listed = () => groups()?.flatMap((group) => group.Files) ?? props.item.files;
  const hiddenCount = () => totals().count - listed().length;
  const hasFolders = () => listed().some((file) => /[/\\]/.test(file.path));
  const runId = () => props.item.runId ?? props.item.id;
  const open = () => session.state.ChangedFiles[runId()]?.Open === true;
  const allExpanded = () => session.state.ChangedFiles[runId()]?.Expanded === true;
  const firstPath = () => {
    const held = groups();
    if (held === null) return props.item.files[0]?.path ?? null;
    const first = held.find((group) => group.Files.length > 0);
    const path = first?.Files[0]?.path;
    return first === undefined || path === undefined ? null : groupDiffPath(first, path);
  };
  const openTurnDiff = (path: string | null) => {
    if (props.turn !== null) void session.openDiff("turn", props.turn, path);
  };
  return (
    <article class={`${props.class} min-w-0 rounded-lg bg-muted`} data-changed-files>
      <header class="flex items-center gap-1 pr-3 text-[12px] leading-4 font-medium">
        <button
          type="button"
          class="group flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent py-2 pl-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-expanded={open() ? "true" : "false"}
          onClick={() => void session.toggleChangedFilesOpen(runId())}
        >
          <ChevronRight
            class={`size-3.5 shrink-0 text-muted-foreground/70 group-hover:text-foreground/80 ${open() ? "rotate-90" : ""}`}
          />
          <span class="truncate">
            {totals().count.toLocaleString()} changed file{totals().count === 1 ? "" : "s"}
          </span>
          <DiffCounts additions={totals().additions} deletions={totals().deletions} />
        </button>
        <Show when={open() && hasFolders()}>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={allExpanded() ? "Collapse all folders" : "Expand all folders"}
            data-tip={allExpanded() ? "Collapse all folders" : "Expand all folders"}
            onClick={() => void session.toggleChangedFilesExpanded(runId())}
          >
            <Show when={allExpanded()} fallback={<ChevronsUpDown class="size-3" />}>
              <ChevronsDownUp class="size-3" />
            </Show>
          </Button>
        </Show>
        <Show when={props.turn !== null}>
          <Button
            size="xs"
            variant="ghost-muted"
            data-tip="Open this turn's diff"
            onClick={() => openTurnDiff(firstPath())}
          >
            <FileDiff class="size-3" />
            Open diff
          </Button>
        </Show>
      </header>
      <Show when={open()}>
        <div class="px-2 pt-0 pb-2">
          <Show
            when={groups()}
            fallback={
              <ChangedFilesTree
                files={props.item.files}
                depth={0}
                allExpanded={allExpanded()}
                disabled={props.turn === null}
                onOpen={openTurnDiff}
              />
            }
          >
            {(held) => (
              <For each={held()} keyed={(group) => group.Key}>
                {(group) => (
                  <ChangedFilesGroupSection
                    group={group()}
                    allExpanded={allExpanded()}
                    disabled={props.turn === null}
                    onOpen={(path) => openTurnDiff(groupDiffPath(group(), path))}
                  />
                )}
              </For>
            )}
          </Show>
        </div>
        <Show when={hiddenCount() > 0}>
          <div class="px-3 pb-2">
            <Button
              size="xs"
              variant="ghost-muted"
              disabled={props.turn === null}
              onClick={() => openTurnDiff(firstPath())}
            >
              {hiddenCount().toLocaleString()} more file{hiddenCount() === 1 ? "" : "s"} in the full
              diff
            </Button>
          </div>
        </Show>
      </Show>
    </article>
  );
}

function ChangedFilesGroupSection(props: {
  group: IChangedFilesGroup;
  allExpanded: boolean;
  disabled: boolean;
  onOpen: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = createSignal(false);
  return (
    <section data-changed-files-group={props.group.Name}>
      <button
        type="button"
        class={`${CHANGED_ROW} group pl-2`}
        aria-expanded={collapsed() ? "false" : "true"}
        onClick={() => setCollapsed(!collapsed())}
      >
        <ChevronRight
          class={`text-muted-foreground/70 group-hover:text-foreground/80 ${collapsed() ? "" : "rotate-90"}`}
        />
        <FolderGit2 class="text-muted-foreground/75" />
        <span class="min-w-0 truncate font-mono text-[11px] leading-4 text-foreground/90">
          {props.group.Name}
        </span>
        <span class="flex-1" />
        <Show when={props.group.Totals.additions > 0 || props.group.Totals.deletions > 0}>
          <DiffCounts
            additions={props.group.Totals.additions}
            deletions={props.group.Totals.deletions}
          />
        </Show>
      </button>
      <Show when={!collapsed()}>
        <Show
          when={props.group.Note}
          fallback={
            <ChangedFilesTree
              files={props.group.Files}
              depth={1}
              allExpanded={props.allExpanded}
              disabled={props.disabled || props.group.RelativePath === undefined}
              onOpen={props.onOpen}
            />
          }
        >
          {(note) => (
            <p class="py-1.5 pr-2 pl-[38px] text-[11px] text-muted-foreground">{note()}</p>
          )}
        </Show>
      </Show>
    </section>
  );
}

function ChangedFilesTree(props: {
  files: IChangedFilesGroup["Files"];
  depth: number;
  allExpanded: boolean;
  disabled: boolean;
  onOpen: (path: string) => void;
}) {
  const tree = createMemo(() => buildChangedFilesTree(props.files));
  const hasFolders = () => tree().some((node) => node.kind === "directory");
  // A folder's own toggle lasts until the all-folders toggle flips, as stock's overrides do.
  const [overrides, setOverrides] = createSignal<{ all: boolean; open: Record<string, boolean> }>({
    all: false,
    open: {},
  });
  const openOverrides = () => (overrides().all === props.allExpanded ? overrides().open : {});
  const rows = () => visibleChangedRows(tree(), openOverrides(), props.allExpanded);
  const isOpen = (path: string) => openOverrides()[path] ?? props.allExpanded;
  const toggleFolder = (path: string) =>
    setOverrides({ all: props.allExpanded, open: { ...openOverrides(), [path]: !isOpen(path) } });
  return (
    <For each={rows()} keyed={(row) => `${row.node.kind}:${row.node.path}`}>
      {(row) => {
        const padding = () => `${8 + (props.depth + row().depth) * 14}px`;
        // The key fixes kind, path and name; only the stat changes while a row is mounted.
        const node = untrack(() => row().node);
        const stat = () => row().node.stat;
        return node.kind === "directory" ? (
          <button
            type="button"
            class={`${CHANGED_ROW} group text-muted-foreground`}
            style={{ "padding-left": padding() }}
            aria-expanded={isOpen(node.path) ? "true" : "false"}
            onClick={() => toggleFolder(node.path)}
          >
            <ChevronRight class={isOpen(node.path) ? "rotate-90" : ""} />
            <Show when={isOpen(node.path)} fallback={<Folder />}>
              <FolderOpen />
            </Show>
            <span class="min-w-0 truncate font-mono text-[11px] leading-4 group-hover:text-foreground">
              {node.name}
            </span>
            <span class="flex-1" />
            <DiffCounts additions={stat().additions} deletions={stat().deletions} />
          </button>
        ) : (
          <button
            type="button"
            class={`${CHANGED_ROW} group`}
            style={{ "padding-left": padding() }}
            disabled={props.disabled}
            data-tip={node.path}
            onClick={() => props.onOpen(node.path)}
          >
            <Show when={hasFolders() || props.depth + row().depth > 0}>
              <span aria-hidden="true" class="size-3.5 shrink-0" />
            </Show>
            <FileIcon path={node.path} class="size-3.5 shrink-0" />
            <span class="min-w-0 flex-1 truncate font-mono text-[12px] leading-4 text-[color-mix(in_srgb,var(--foreground)_85%,transparent)] group-hover:text-foreground">
              {node.name}
            </span>
            <DiffCounts additions={stat().additions} deletions={stat().deletions} />
          </button>
        );
      }}
    </For>
  );
}

interface IRowProps {
  id: string;
}

function useRow(props: IRowProps) {
  const thread = OpenThread.use();
  return {
    thread,
    item: () => timelineItem(thread.state, props.id),
    inherited: () => thread.state.Rows[props.id]?.visibility === "inherited",
  };
}

export function FoldHeader(props: { fold: IMessageFold; expanded: boolean; onToggle: () => void }) {
  const environment = Environment.use();
  return (
    <div class="flex min-w-0 items-center gap-1.5 px-3 py-2 text-[14px] [&>svg]:size-4 [&>svg]:flex-none [&>svg]:text-muted-foreground">
      <Dynamic component={props.fold.Kind === "agent" ? MessagesSquare : CalendarClock} />
      <Show
        when={props.fold.Sender?.Openable ? props.fold.Sender : null}
        fallback={<span class={FOLD_LABEL}>{props.fold.Label}</span>}
      >
        {(sender) => (
          <button
            type="button"
            class={`${FOLD_LABEL} cursor-pointer border-0 bg-transparent p-0 hover:text-foreground hover:underline`}
            data-tip="Open thread"
            onClick={() => environment.selectThread(sender().Ref.threadId)}
          >
            {props.fold.Label}
          </button>
        )}
      </Show>
      <button
        type="button"
        class="group/toggle flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left"
        aria-expanded={props.expanded ? "true" : "false"}
        onClick={() => props.onToggle()}
      >
        <span class="min-w-0 flex-1 truncate">{props.fold.Summary.normalize("NFC")}</span>
        <ChevronDown class="size-3.5 flex-none text-muted-foreground transition-transform duration-150 ease-[ease] group-aria-expanded/toggle:rotate-180" />
      </button>
    </div>
  );
}

export function QueuedMessage(props: { runId: string }) {
  const thread = OpenThread.use();
  const environment = Environment.use();
  const sent = createMemo(() => {
    const held = runMessage(thread.state, props.runId);
    return held === undefined ? null : fromMessage(held);
  });
  const fold = createMemo(() => {
    const held = sent();
    return held === null
      ? null
      : messageFold(
          held,
          thread.state.EnvironmentId,
          (threadId) => environment.state.Replica.Shell.Threads[threadId]?.title,
        );
  });
  const text = () => {
    const held = sent();
    return held === null ? "" : displayText(held);
  };
  const [expanded, setExpanded] = createSignal(false);
  return (
    <Show when={fold()} fallback={<span class="min-w-0 flex-1">{text()}</span>}>
      {(held) => (
        <div class="min-w-0 flex-1 rounded-2xl border border-dashed border-input">
          <FoldHeader
            fold={held()}
            expanded={expanded()}
            onToggle={() => setExpanded((open) => !open)}
          />
          <Show when={expanded()}>
            <span class="block max-h-96 overflow-auto px-3 pb-2 whitespace-pre-wrap">{text()}</span>
          </Show>
        </div>
      )}
    </Show>
  );
}

function UserRow(props: IRowProps) {
  const { thread, item, inherited } = useRow(props);
  const environment = Environment.use();
  const session = ThreadSession.use();
  const message = () => {
    const held = item();
    return held?.type === "user_message" ? held : null;
  };
  const sent = createMemo(() => {
    const held = message();
    return held === null ? null : fromItem(held);
  });
  const text = () => {
    const held = sent();
    return held === null ? "" : displayText(held);
  };
  const fold = createMemo(() => {
    const held = sent();
    return held === null
      ? null
      : messageFold(
          held,
          thread.state.EnvironmentId,
          (threadId) => environment.state.Replica.Shell.Threads[threadId]?.title,
        );
  });
  const steer = () => steerLabel(message()?.inputIntent, message()?.status);
  const expanded = () => session.state.ExpandedRows[props.id] === true;
  const attachments = () => message()?.attachments ?? [];
  const createdAt = () => {
    const held = message();
    return held === null ? undefined : (held.startedAt ?? held.updatedAt);
  };
  const content = (folded: boolean) => (
    <>
      <For each={attachments()}>
        {(file) => (
          <UserAttachment
            environmentId={thread.state.EnvironmentId}
            file={file}
            grouped={folded || Boolean(text())}
          />
        )}
      </For>
      <Show when={text()}>
        {(body) => (
          <Show
            when={!folded}
            fallback={<Markdown text={body()} fromUser message={sent() ?? undefined} />}
          >
            <div
              class={`${BUBBLE} p-3 data-grouped:rounded-tr-md`}
              data-grouped={attachments().length > 0 ? "" : undefined}
            >
              <Markdown text={body()} fromUser message={sent() ?? undefined} />
            </div>
          </Show>
        )}
      </Show>
    </>
  );
  return (
    <article
      class="group/row flex min-w-0 flex-col items-end gap-1 pb-4 data-inherited:opacity-70"
      data-inherited={inherited() ? "" : undefined}
    >
      <Show when={sent() !== null && attribution(sent()!) === "t3code"}>
        <p class={NOTE}>Sent by T3 Code</p>
      </Show>
      <Show when={steer()}>
        {(label) => (
          <p class={NOTE} data-tip={label().Tip}>
            <Redo2 />
            {label().Text}
          </p>
        )}
      </Show>
      <Show when={fold()} fallback={content(false)}>
        {(held) => (
          <div
            class={`${BUBBLE} data-expanded:w-[80%]`}
            data-expanded={expanded() ? "" : undefined}
          >
            <FoldHeader
              fold={held()}
              expanded={expanded()}
              onToggle={() => void session.toggleRowExpanded(props.id)}
            />
            <Show when={expanded()}>
              <div class="flex max-h-96 flex-col gap-2 overflow-auto px-3 pb-3">
                {content(true)}
              </div>
            </Show>
          </div>
        )}
      </Show>
      <Show when={fold() === null || expanded()}>
        <div class={`${ACTIONS} ${ACTIONS_ON_HOVER} pr-1`}>
          <Show when={createdAt()}>{(at) => <MessageTime at={at()} />}</Show>
          <EditFromHere id={props.id} />
          <Show when={text()}>{(body) => <CopyButton text={body()} label="Copy message" />}</Show>
        </div>
      </Show>
    </article>
  );
}

function EditFromHere(props: IRowProps) {
  const session = ThreadSession.use();
  const turn = () => session.revertTargets()[props.id];
  const rewinding = useInFlight(editFromHere, () => session.state);
  return (
    <Show when={turn() !== undefined}>
      <Button
        variant="ghost"
        size="xs"
        aria-label="Edit from here"
        data-tip="Edit from here"
        disabled={rewinding() || session.threadWorking()}
        onClick={() => {
          const at = turn();
          if (at === undefined) return;
          void session.editFromHere(props.id, at).then((filled) => {
            if (filled) focusComposerAtEnd(session.state.ThreadId);
          });
        }}
      >
        <Pencil class="size-3" />
      </Button>
    </Show>
  );
}

function ForkFromHere(props: IRowProps) {
  const { thread, item } = useRow(props);
  const session = ThreadSession.use();
  const forking = useInFlight(forkFromRun, () => session.state);
  const runId = () => {
    const held = item();
    return held === undefined || held.runId === null || !canForkItem(thread.state, held)
      ? null
      : held.runId;
  };
  return (
    <Show when={runId()}>
      {(run) => (
        <Button
          variant="ghost"
          size="xs"
          aria-label="Fork from this response"
          data-tip="Fork from this response"
          disabled={forking()}
          onClick={() =>
            void session.forkFromRun(
              thread.state.Rows[props.id]?.sourceThreadId ?? thread.state.ThreadId,
              run(),
            )
          }
        >
          <GitFork class="size-3" />
        </Button>
      )}
    </Show>
  );
}

export function RewindDialog() {
  const session = ThreadSession.use();
  return (
    <Presence when={session.rewindConfirm()}>
      {(entry) => {
        const id = () => entry().Id as IAskId<IRewindChoice>;
        const choose = (choice?: IRewindChoice) => void session.chooseRewind(id(), choice);
        return (
          <AlertDialog onClose={() => choose()}>
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>Edit from here?</AlertDialogTitle>
                <AlertDialogDescription>
                  <Show
                    when={entry().Request.FileRestore === "repositories"}
                    fallback="Rewind chat to before this message. Your prompt and attachments return to the composer. “Revert files too” also undoes your own edits."
                  >
                    Rewind chat to before this message. Your prompt and attachments return to the
                    composer. “Revert repositories too” also undoes your own edits in this thread’s
                    repository worktrees. Files in the project folder itself stay as they are.
                  </Show>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose variant="outline">Cancel</AlertDialogClose>
                <Button
                  variant="destructive-outline"
                  disabled={entry().Request.FileRestore === null}
                  onClick={() => choose("restoreFiles")}
                >
                  {entry().Request.FileRestore === "repositories"
                    ? "Revert repositories too"
                    : "Revert files too"}
                </Button>
                <Button onClick={() => choose("keepChanges")}>Revert and keep changes</Button>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
        );
      }}
    </Presence>
  );
}

/** A reply's copy and time, shown on the last reply of a settled response. */
export function MessageMeta(props: IRowProps & { standalone?: boolean }) {
  const { item } = useRow(props);
  const text = () => {
    const held = item();
    return held === undefined ? undefined : viewOf(held).Body;
  };
  const updatedAt = () => (item()?.status === "completed" ? item()?.updatedAt : undefined);
  return (
    <div
      class={
        props.standalone === true
          ? `${ACTIONS} px-1 pt-0.5 pb-4`
          : `${ACTIONS} ${ACTIONS_ON_HOVER} mt-1.5`
      }
    >
      <Show when={updatedAt()}>
        {(at) => (
          <>
            <Show when={text()}>{(body) => <CopyButton text={body()} label="Copy message" />}</Show>
            <ForkFromHere id={props.id} />
            <MessageTime at={at()} />
          </>
        )}
      </Show>
    </div>
  );
}

const MESSAGE_TONES: Record<string, string> = {
  assistant:
    "group/row min-w-0 px-1 pt-0.5 pb-[18px] [&_.chat-markdown]:text-[color-mix(in_srgb,var(--foreground)_90%,transparent)]",
  plan: "mb-4 min-w-0 rounded-xl border border-border bg-card px-4 py-3",
};

function MessageRow(props: IRowProps & { meta: boolean; files?: string | undefined }) {
  const { item, inherited } = useRow(props);
  const view = createMemo(() => {
    const held = item();
    return held === undefined ? undefined : viewOf(held);
  });
  return (
    <article
      class={`${MESSAGE_TONES[view()?.Tone ?? ""] ?? "min-w-0"} data-inherited:opacity-70`}
      data-inherited={inherited() ? "" : undefined}
    >
      <Show when={view()?.Tone === "plan"}>
        <header class="mb-2 text-[12px] font-medium text-muted-foreground">{view()?.Label}</header>
      </Show>
      <Show when={view()?.Body}>
        {(text) => <Body id={props.id} text={text()} format={view()?.Format ?? "text"} />}
      </Show>
      <Show when={view()?.Tone === "assistant" && props.files}>
        {(id) => <TurnChangedFiles id={id()} class="mt-4" />}
      </Show>
      <Show when={view()?.Tone === "assistant" && props.meta}>
        <MessageMeta id={props.id} />
      </Show>
    </article>
  );
}

// Follows AssistantChangedFilesSection in stock's TimelineAssistantRows.tsx, which draws nothing
// for a turn with no changes (`turnHasChanges`).
function TurnChangedFiles(props: IRowProps & { class: string }) {
  const { thread, item } = useRow(props);
  const card = createMemo(() => {
    const held = item();
    if (held?.type !== "checkpoint") return null;
    const repositories =
      held.runId === null ? undefined : thread.turnRepositories().get(held.runId);
    return turnHasChanges({ files: held.files, repositories })
      ? { Item: held, repositories }
      : null;
  });
  return (
    <Show when={card()}>
      {(held) => (
        <ChangedFiles
          item={held().Item}
          turn={diffTurnOf(thread.state, held().Item)}
          repositories={held().repositories}
          class={props.class}
        />
      )}
    </Show>
  );
}

function ChangedFilesRow(props: IRowProps) {
  return <TurnChangedFiles id={props.id} class="mx-1 mb-12" />;
}

// Stock draws these as their own cards, so they keep this client's wording.
const EVENT_TYPES = new Set<IWireTurnItem["type"]>([
  "fork",
  "handoff",
  "run_interrupt_request",
  "run_interrupt_result",
  "checkpoint",
]);

export function WorkRow(props: IRowProps & { single?: boolean; grouped?: boolean }) {
  const { thread, item, inherited } = useRow(props);
  const session = ThreadSession.use();
  const workspaceRoot = useWorkspaceRoot();
  const view = createMemo(() => {
    const held = item();
    if (held === undefined) return undefined;
    const base = viewOf(
      held,
      held.type === "file_change" ? fileChangeCounts(thread.state, held) : null,
    );
    if (EVENT_TYPES.has(held.type)) return { ...base, Failed: false };
    const entry = workLogEntry(held);
    const label = !props.single
      ? workEntryDisplayLabel(entry, workspaceRoot())
      : toolGroupAction(entry) === "edit"
        ? summarizeToolGroup([entry]).summary
        : singleToolCallLabel(entry, workspaceRoot());
    return { ...base, Label: label, Failed: workEntryDisplayIndicatesToolFailure(entry) };
  });
  const counts = () => {
    const held = item();
    return held?.type === "file_change" ? fileChangeCounts(thread.state, held) : null;
  };
  const diffTurn = createMemo(() => {
    const held = item();
    return held === undefined ? null : diffTurnOf(thread.state, held);
  });
  const expanded = () => session.state.ExpandedRows[props.id] === true;
  const notification = () => {
    const held = item();
    return held?.type === "notification" ? held : null;
  };
  const live = () => {
    const status = item()?.status;
    return status === "running" || status === "pending" || status === "waiting" ? status : null;
  };
  const label = () => (
    <>
      <Show when={notification()} fallback={<RowIcon type={item()?.type ?? ""} />}>
        {(held) => <NotificationIcon item={held()} />}
      </Show>
      <span class="min-w-0 flex-initial truncate">{view()?.Label}</span>
      <Show when={counts()}>
        {(held) => <DiffCounts additions={held().additions} deletions={held().deletions} />}
      </Show>
      <Show when={live()}>
        <span class="flex-none text-[12px] text-info-foreground">{live()}</span>
      </Show>
    </>
  );
  const detail = () => session.state.ToolDetails[props.id];
  const inspected = () => {
    const held = item();
    return held !== undefined && INSPECTED_TYPES.has(held.type) ? held : undefined;
  };
  const bodyText = () => {
    const fetched = detail()?.Item;
    return fetched != null && fetched.type === item()?.type ? viewOf(fetched).Body : view()?.Body;
  };
  const body = (pre?: string) => (
    <Show when={bodyText()}>
      {(text) => <Body id={props.id} text={text()} format={view()?.Format ?? "text"} pre={pre} />}
    </Show>
  );
  const tone = () => view()?.Tone;
  return (
    <article
      class="group/row relative min-w-0 rounded-md px-0.5 py-0.5 data-grouped:py-0 data-inherited:opacity-70"
      data-grouped={props.grouped ? "" : undefined}
      data-tone={tone()}
      data-inherited={inherited() ? "" : undefined}
      data-action={diffTurn() !== null ? "" : undefined}
      data-failed={view()?.Failed === true ? "" : undefined}
    >
      <Show
        when={view()?.Collapsed && (view()?.Body || view()?.LiveOutput || view()?.Detail)}
        fallback={
          <>
            <div class={`${workLine(tone())} group-data-action/row:pr-18`}>{label()}</div>
            {body(
              view()?.Format !== "text" ? WORK_PRE : tone() === "error" ? ERROR_TEXT : WORK_TEXT,
            )}
          </>
        }
      >
        {/* Setting open fires toggle too, so only a change from the held state toggles it. */}
        <details
          open={expanded()}
          onToggle={(event) => {
            if (event.currentTarget.open === expanded()) return;
            const fetch = view()?.LiveOutput
              ? ("output" as const)
              : view()?.Detail
                ? ("detail" as const)
                : null;
            const source =
              fetch === null
                ? undefined
                : {
                    ThreadId: thread.state.Rows[props.id]?.sourceThreadId ?? thread.state.ThreadId,
                    Fetch: fetch,
                  };
            session.toggleRowExpanded(props.id, source);
          }}
        >
          <summary
            class={`${workLine(tone())} ${SUMMARY} ${tone() === "quiet" || tone() === "error" ? "" : "hover:text-foreground"}`}
          >
            {label()}
            <span
              class="ml-auto flex size-4 flex-none items-center justify-center"
              aria-hidden="true"
            >
              <ChevronRight class="size-3 text-muted-foreground opacity-70 transition-transform duration-200 in-open:rotate-90" />
            </span>
          </summary>
          <div class="ml-7 pt-0.5 pb-1.5">
            <Show
              when={inspected()}
              fallback={
                <>
                  <Show when={view()?.LiveOutput && expanded()}>
                    <CommandOutput itemId={props.id} />
                  </Show>
                  <Show when={detail()}>{(held) => <ToolDetailNote detail={held()} />}</Show>
                  {body()}
                </>
              }
            >
              {(held) => (
                <Show when={expanded()}>
                  <ToolInspector
                    id={props.id}
                    item={held()}
                    detail={detail()}
                    liveOutput={view()?.LiveOutput === true}
                  />
                </Show>
              )}
            </Show>
          </div>
        </details>
      </Show>
      <Show when={diffTurn()}>
        {(turn) => (
          <Button
            variant="ghost-muted"
            size="xs"
            class="absolute top-0.5 right-0.5"
            onClick={() => {
              const held = item();
              const path = held?.type === "file_change" ? fileChangePath(thread.state, held) : null;
              void session.openDiff("turn", turn(), path);
            }}
          >
            View diff
          </Button>
        )}
      </Show>
    </article>
  );
}

// Follows ContextCompactionTimelineRow in apps/web/src/components/chat/MessagesTimeline.tsx.
function CompactionDivider(props: { label: string; failure?: string | null; failed?: boolean }) {
  const line = "h-px flex-1 bg-border/70 group-data-failed/divider:bg-destructive/30";
  return (
    <div
      role="separator"
      aria-label={props.failure ? `${props.label}: ${props.failure}` : props.label}
      class="group/divider flex w-full items-center gap-3 py-1 text-xs text-muted-foreground data-failed:text-destructive"
      data-failed={props.failed ? "" : undefined}
    >
      <span class={line} />
      <span class="flex min-w-0 items-center gap-1.5 [&_svg]:size-3 [&_svg]:flex-none">
        <Show when={props.failed} fallback={<Minimize2 />}>
          <CircleAlert />
        </Show>
        <span class="truncate">{props.label}</span>
        <Show when={props.failure}>
          <span class="min-w-0 truncate opacity-80">· {props.failure}</span>
        </Show>
      </span>
      <span class={line} />
    </div>
  );
}

export function CompactionRow(props: { id: string; age: string | null }) {
  const { thread, item } = useRow(props);
  const compaction = createMemo(() => {
    const held = item();
    return held?.type === "compaction" ? held : null;
  });
  return (
    <Show when={compaction()}>
      {(held) => (
        <CompactionDivider
          label={compactionLabel(held(), compactionReason(thread.state, held()), props.age)}
          failure={compactionFailure(held())}
          failed={held().status === "failed"}
        />
      )}
    </Show>
  );
}

/** A bare `/compact` prompt waiting for its compaction to arrive. */
export function CompactingRow(props: { id: string; pending: boolean }) {
  const { thread, item } = useRow(props);
  const label = () => {
    if (!props.pending) return "Context compaction";
    const held = item();
    const reason = held === undefined ? undefined : compactionReason(thread.state, held);
    return reason === undefined ? "Compacting context" : IDLE_COMPACTING_LABELS[reason];
  };
  return <CompactionDivider label={label()} />;
}

function NotificationRow(props: IRowProps) {
  const { thread, item, inherited } = useRow(props);
  const card = createMemo(() => {
    const held = item();
    if (held?.type !== "notification" || inherited()) return null;
    const agent = notifiedSubagent(thread.state.Subagents, held);
    return agent === null ? null : { Item: held, Agent: agent };
  });
  return (
    <Show when={card()} fallback={<WorkRow id={props.id} />}>
      {(held) => <SubagentNotification item={held().Item} agent={held().Agent} />}
    </Show>
  );
}

const ROWS: Record<string, Component<IRowProps & { meta: boolean; files?: string | undefined }>> = {
  user: UserRow,
  message: MessageRow,
  "changed-files": ChangedFilesRow,
  work: WorkRow,
  subagent: SubagentRow,
  notification: NotificationRow,
  asked: AskedRow,
  "html-render": HtmlRenderRow,
  "mcp-app": McpAppRow,
};

// Follows HtmlRenderTimelineRow in apps/web/src/components/chat/TimelineAssistantRows.tsx.
function HtmlRenderRow(props: IRowProps) {
  const { item } = useRow(props);
  const embed = createMemo(
    () => {
      const held = item();
      const found = held === undefined ? null : embedOf(held);
      return found?.Kind === "html-render" ? found.HtmlRender : null;
    },
    {
      equals: (left, right) =>
        left === right ||
        (left !== null && right !== null && htmlRenderReferencesEqual(left, right)),
    },
  );
  return (
    <Show when={embed()} keyed>
      {(htmlRender) => (
        <div class="min-w-0 px-1">
          <HtmlRenderFrame htmlRender={htmlRender} />
        </div>
      )}
    </Show>
  );
}

// Follows McpAppTimelineRow in apps/web/src/components/chat/TimelineAssistantRows.tsx.
function McpAppRow(props: IRowProps) {
  const { thread, item } = useRow(props);
  const app = createMemo(
    () => {
      const held = item();
      const found = held === undefined ? null : embedOf(held);
      return found?.Kind === "mcp-app" ? found.App : null;
    },
    {
      equals: (left, right) =>
        left === right || (left !== null && right !== null && mcpAppReferencesEqual(left, right)),
    },
  );
  const row = () => thread.state.Rows[props.id];
  return (
    <>
      <WorkRow id={props.id} />
      <Show when={app()} keyed>
        {(held) => (
          <div class="min-w-0 px-1">
            <McpAppFrame
              app={held}
              threadId={row()?.sourceThreadId ?? thread.state.ThreadId}
              itemId={props.id}
            />
          </div>
        )}
      </Show>
    </>
  );
}

function AskedRow(props: IRowProps) {
  const { item } = useRow(props);
  return <Show when={item()}>{(held) => <ItemRequestRow id={props.id} item={held()} />}</Show>;
}

function rowKind(item: IWireTurnItem): string | null {
  switch (item.type) {
    case "user_message":
      return "user";
    case "assistant_message":
    case "proposed_plan":
    case "todo_list":
      return "message";
    case "checkpoint":
      return "changed-files";
    case "approval_request":
      return item.status === "waiting" ? null : "work";
    case "dynamic_tool":
      return embedOf(item)?.Kind ?? (viewOf(item).Tone === "assistant" ? "message" : "work");
    case "subagent":
    case "notification":
      return item.type;
    case "secret_request":
    case "link_request":
      return "asked";
    default:
      return "work";
  }
}

export function TimelineRow(props: IRowProps & { meta: boolean; files?: string | undefined }) {
  const thread = OpenThread.use();
  const kind = createMemo(() => {
    const item = timelineItem(thread.state, props.id);
    return item === undefined || !isRowVisible(thread.state, props.id) ? null : rowKind(item);
  });
  return (
    <Dynamic component={ROWS[kind() ?? ""]} id={props.id} meta={props.meta} files={props.files} />
  );
}
