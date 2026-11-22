import {
  summarizeToolGroup,
  toolGroupAction,
  workEntryDisplayIndicatesToolFailure,
} from "@t3tools/client-runtime/work-log/presentation";
import { type IActionGenerator, type IAskId, type IEntity } from "treflex";
import { useComponentState, useInFlight } from "treflex-solid";
import { type Component, createMemo, createSignal, For, onMount, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

import { attachmentDetail } from "./attachmentIntake";
import { CommandOutput, WORK_PRE } from "./CommandOutput";
import { compactionLabel, compactionReason } from "./compaction";
import { CopyButton } from "./CopyButton";
import {
  Bot,
  Brain,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Download,
  File,
  FileDiff,
  FileSearch,
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
import { notifiedSubagent } from "./subagents";
import Environment from "./Environment";
import { assetUrlEffect, type IWireAttachment } from "./Infrastructure/commandEffects";
import type { IWireTurnItem } from "./Infrastructure/wire";
import { ItemRequestRow } from "./ItemRequestViews";
import { Markdown } from "./Markdown";
import OpenThread, {
  diffTurnOf,
  fileChangeCounts,
  isRowVisible,
  runMessage,
  timelineItem,
} from "./OpenThread";
import { focusComposerAtEnd } from "./composerFocus";
import { canForkItem } from "./rewind";
import ThreadSession, { editFromHere, forkFromRun, type IRewindChoice } from "./ThreadSession";
import { dayAwareTimestamp, fullTimestamp } from "./timestamps";
import { Button, buttonVariants } from "./ui/Button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/Modal";
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
import { serverError } from "./Infrastructure/serverError";
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
  "flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left text-inherit no-underline";

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
  return (
    <span class={props.class} data-tip={fullTimestamp(props.at)}>
      {dayAwareTimestamp(props.at)}
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

// Follows workEntryIconName in apps/web/src/components/chat/TimelineWorkEntryRow.logic.ts.
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

interface IAttachmentImage extends IEntity {
  Url: string | null;
  Failed: boolean;
}

function* loadAttachmentUrl(
  draft: IAttachmentImage,
  environmentId: string,
  file: IWireAttachment,
): IActionGenerator {
  try {
    const asset = yield* assetUrlEffect({
      EnvironmentId: environmentId,
      Resource: {
        _tag: "attachment",
        attachmentId: file.id,
        ...(file.type === "image"
          ? {}
          : { fileName: file.name, mimeType: file.mimeType, disposition: "inline" }),
      },
    });
    draft.Url = asset.Url;
  } catch (error) {
    serverError(error);
    draft.Failed = true;
  }
}

function UserAttachment(props: { environmentId: string; file: IWireAttachment; grouped: boolean }) {
  const local = useComponentState<IAttachmentImage>(() => ({ Url: null, Failed: false }));
  onMount(() => local.dispatch(loadAttachmentUrl, props.environmentId, props.file));
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
        onError={() => local.dispatch(markFailed)}
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
        <span class="truncate text-[14px] font-medium in-[a:hover]:underline">{label()}</span>
        <span class="text-[12px] text-muted-foreground tabular-nums">
          {attachmentDetail(props.file.name, props.file.sizeBytes, pastedText())}
        </span>
      </span>
    </>
  );
  return (
    <div class="flex w-64 max-w-full items-center gap-1 rounded-2xl bg-message py-2 pr-1 pl-2">
      <Show when={props.url} fallback={<span class={FILE_OPEN}>{identity()}</span>}>
        {(url) => (
          <>
            <a
              class={FILE_OPEN}
              href={url()}
              target="_blank"
              rel="noopener"
              aria-label={`Preview ${label()}`}
            >
              {identity()}
            </a>
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

function* markFailed(draft: IAttachmentImage): IActionGenerator {
  draft.Failed = true;
}

function DiffCounts(props: { additions: number; deletions: number }) {
  return (
    <span class={DIFF_COUNTS}>
      <span class={ADDED_TEXT}>+{props.additions}</span>{" "}
      <span class={REMOVED_TEXT}>-{props.deletions}</span>
    </span>
  );
}

function checkpointTotals(item: IWireCheckpoint) {
  return (
    item.filesTotal ?? {
      count: item.files.length,
      additions: item.files.reduce((total, file) => total + file.additions, 0),
      deletions: item.files.reduce((total, file) => total + file.deletions, 0),
    }
  );
}

function FilesSummary(props: { id: string }) {
  const { thread, item } = useRow(props);
  const session = ThreadSession.use();
  const checkpoint = () => {
    const held = item();
    return held?.type === "checkpoint" ? held : null;
  };
  return (
    <Show when={checkpoint()}>
      {(held) => {
        const totals = () => checkpointTotals(held());
        const turn = () => diffTurnOf(thread.state, held());
        return (
          <button
            class="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-0 disabled:cursor-default enabled:hover:bg-accent enabled:hover:text-foreground [&_svg]:size-3.5"
            data-tip={turn() === null ? undefined : "Open this turn's diff"}
            disabled={turn() === null}
            onClick={() => {
              const at = turn();
              if (at !== null) session.openDiff("turn", at);
            }}
          >
            <FileDiff />
            {totals().count} file{totals().count === 1 ? "" : "s"}
            <DiffCounts additions={totals().additions} deletions={totals().deletions} />
          </button>
        );
      }}
    </Show>
  );
}

function ChangedFiles(props: { item: IWireCheckpoint; turn: number | null }) {
  const session = ThreadSession.use();
  const totals = () => checkpointTotals(props.item);
  return (
    <article class="mx-1 mb-12 min-w-0 rounded-lg bg-muted" data-changed-files>
      <header class="flex items-center gap-3 px-3 py-2 text-[12px] leading-4 font-medium">
        <span>
          {totals().count} changed file{totals().count === 1 ? "" : "s"}
        </span>
        <DiffCounts additions={totals().additions} deletions={totals().deletions} />
        <span class="flex-1" />
        <Show when={props.turn}>
          {(turn) => (
            <button
              class="inline-flex h-6 cursor-pointer items-center gap-1 rounded-lg border border-transparent bg-transparent px-1.5 py-0 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
              data-tip="Open this turn's diff"
              onClick={() => session.openDiff("turn", turn())}
            >
              <FileDiff />
              Open diff
            </button>
          )}
        </Show>
      </header>
      <ul class="m-0 list-none px-2 pt-0 pb-2">
        <For each={props.item.files}>
          {(file) => (
            <li class="flex h-7 items-center gap-2 px-2 font-mono text-[12px] leading-4 [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
              <File />
              <span class="min-w-0 flex-1 truncate text-[color-mix(in_srgb,var(--foreground)_85%,transparent)]">
                {file.path}
              </span>
              <DiffCounts additions={file.additions} deletions={file.deletions} />
            </li>
          )}
        </For>
      </ul>
    </article>
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
        aria-expanded={props.expanded}
        onClick={() => props.onToggle()}
      >
        <span class="min-w-0 flex-1 truncate">{props.fold.Summary.normalize("NFC")}</span>
        <ChevronDown class="size-3.5 flex-none text-muted-foreground transition-transform duration-150 ease-[ease] group-aria-expanded/toggle:rotate-180" />
      </button>
    </div>
  );
}

// Follows QueuedMessage in apps/web/src/components/chat/QueuedRunsControl.tsx.
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
  const [expanded, setExpanded] = createSignal(false);
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
              onToggle={() => setExpanded((open) => !open)}
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

// Follows RevertUserMessageButton in apps/web/src/components/chat/TimelineUserMessageRow.tsx.
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
            if (filled) focusComposerAtEnd();
          });
        }}
      >
        <Pencil class="size-3" />
      </Button>
    </Show>
  );
}

// Follows AssistantForkButton in apps/web/src/components/chat/TimelineAssistantRows.tsx.
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

// Follows RevertConfirmHost in apps/web/src/components/chat/ChatOverlayHosts.tsx.
export function RewindDialog() {
  const session = ThreadSession.use();
  return (
    <Presence when={session.rewindConfirm()}>
      {(entry) => {
        const id = () => entry().Id as IAskId<IRewindChoice>;
        const choose = (choice?: IRewindChoice) => void session.chooseRewind(id(), choice);
        return (
          <Dialog aria-labelledby="rewind-title" onClose={() => choose()}>
            <DialogHeader>
              <DialogTitle id="rewind-title">Edit from here?</DialogTitle>
              <DialogDescription>
                Rewind chat to before this message. Your prompt and attachments return to the
                composer. “Revert files too” also undoes your own edits.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter class="flex-wrap">
              <Button variant="outline" autofocus onClick={() => choose()}>
                Cancel
              </Button>
              <Button
                variant="destructive-outline"
                disabled={!entry().Request.CanRestoreFiles}
                onClick={() => choose("restoreFiles")}
              >
                Revert files too
              </Button>
              <Button onClick={() => choose("keepChanges")}>Revert and keep changes</Button>
            </DialogFooter>
          </Dialog>
        );
      }}
    </Presence>
  );
}

/** A reply's copy and time, shown on the last reply of a settled response. */
export function MessageMeta(props: IRowProps & { standalone?: boolean; files?: string | null }) {
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
      <Show when={props.files}>{(id) => <FilesSummary id={id()} />}</Show>
    </div>
  );
}

const MESSAGE_TONES: Record<string, string> = {
  assistant:
    "group/row min-w-0 px-1 pt-0.5 pb-[18px] [&_.chat-markdown]:text-[color-mix(in_srgb,var(--foreground)_90%,transparent)] [&:has(+[data-changed-files])]:pb-0",
  plan: "mb-4 min-w-0 rounded-xl border border-border bg-card px-4 py-3",
};

function MessageRow(props: IRowProps & { meta: boolean }) {
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
      <Show when={view()?.Tone === "assistant" && props.meta}>
        <MessageMeta id={props.id} />
      </Show>
    </article>
  );
}

function ChangedFilesRow(props: IRowProps) {
  const { thread, item } = useRow(props);
  const checkpoint = () => {
    const held = item();
    return held?.type === "checkpoint" ? held : null;
  };
  return (
    <Show when={checkpoint()}>
      {(held) => <ChangedFiles item={held()} turn={diffTurnOf(thread.state, held())} />}
    </Show>
  );
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
    if (held.type === "compaction") {
      return {
        ...base,
        Label: compactionLabel(held, compactionReason(thread.state, held)),
        Failed: false,
      };
    }
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
  const body = (pre?: string) => (
    <Show when={view()?.Body}>
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
        when={view()?.Collapsed && (view()?.Body || view()?.LiveOutput)}
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
            const output = view()?.LiveOutput
              ? { ThreadId: thread.state.Rows[props.id]?.sourceThreadId ?? thread.state.ThreadId }
              : undefined;
            session.toggleRowExpanded(props.id, output);
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
            <Show when={view()?.LiveOutput && expanded()}>
              <CommandOutput itemId={props.id} />
            </Show>
            {body()}
          </div>
        </details>
      </Show>
      <Show when={diffTurn()}>
        {(turn) => (
          <Button
            variant="ghost-muted"
            size="xs"
            class="absolute top-0.5 right-0.5"
            onClick={() => session.openDiff("turn", turn())}
          >
            View diff
          </Button>
        )}
      </Show>
    </article>
  );
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

const ROWS: Record<string, Component<IRowProps & { meta: boolean }>> = {
  user: UserRow,
  message: MessageRow,
  "changed-files": ChangedFilesRow,
  work: WorkRow,
  subagent: SubagentRow,
  notification: NotificationRow,
  asked: AskedRow,
};

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
      return (item.filesTotal?.count ?? item.files.length) === 0 ? null : "changed-files";
    case "approval_request":
      return item.status === "waiting" ? null : "work";
    case "dynamic_tool":
      return viewOf(item).Tone === "assistant" ? "message" : "work";
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

export function TimelineRow(props: IRowProps & { meta: boolean }) {
  const thread = OpenThread.use();
  const kind = createMemo(() => {
    const item = timelineItem(thread.state, props.id);
    return item === undefined || !isRowVisible(thread.state, props.id) ? null : rowKind(item);
  });
  return <Dynamic component={ROWS[kind() ?? ""]} id={props.id} meta={props.meta} />;
}
