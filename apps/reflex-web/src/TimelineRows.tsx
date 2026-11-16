import {
  summarizeToolGroup,
  toolGroupAction,
  workEntryDisplayIndicatesToolFailure,
} from "@t3tools/client-runtime/work-log/presentation";
import { type IActionGenerator, type IEntity } from "treflex";
import { useComponentState } from "treflex-solid";
import { type Component, createMemo, createSignal, For, onMount, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

import { attachmentDetail } from "./attachmentIntake";
import { CommandOutput } from "./CommandOutput";
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
  Globe,
  Link,
  ListTodo,
  MessageCircleQuestion,
  MessagesSquare,
  Redo2,
  ShieldQuestion,
  SquarePen,
  Terminal,
  Wrench,
} from "./icons";
import Environment from "./Environment";
import { assetUrlEffect, type IWireAttachment } from "./Infrastructure/commandEffects";
import type { IWireTurnItem } from "./Infrastructure/wire";
import { Markdown } from "./Markdown";
import OpenThread, {
  diffTurnOf,
  fileChangeCounts,
  isRowVisible,
  runMessage,
  timelineItem,
} from "./OpenThread";
import ThreadSession from "./ThreadSession";
import { dayAwareTimestamp, fullTimestamp } from "./timestamps";
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

function Body(props: { text: string; format: "markdown" | "text" | "code"; fromUser?: boolean }) {
  return (
    <Show
      when={props.format === "markdown"}
      fallback={<pre class={props.format === "code" ? "work-code" : "work-text"}>{props.text}</pre>}
    >
      <Markdown text={props.text} fromUser={props.fromUser === true} />
    </Show>
  );
}

export function MessageTime(props: { at: string }) {
  return (
    <span class="message-time" data-tip={fullTimestamp(props.at)}>
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
  subagent: Bot,
  approval_request: ShieldQuestion,
  user_input_request: MessageCircleQuestion,
  secret_request: ShieldQuestion,
  link_request: Link,
  error: CircleAlert,
};

export function RowIcon(props: { type: string }) {
  return (
    <span class="work-icon">
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
  } catch {
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
      <span class="attachment-file-icon">
        <File />
      </span>
      <span class="attachment-file-text">
        <span class="attachment-file-name">{label()}</span>
        <span class="attachment-file-detail">
          {attachmentDetail(props.file.name, props.file.sizeBytes, pastedText())}
        </span>
      </span>
    </>
  );
  return (
    <div class="attachment-file-card">
      <Show when={props.url} fallback={<span class="attachment-file-open">{identity()}</span>}>
        {(url) => (
          <>
            <a
              class="attachment-file-open"
              href={url()}
              target="_blank"
              rel="noopener"
              aria-label={`Preview ${label()}`}
            >
              {identity()}
            </a>
            <a
              class="icon-button"
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
    <Show when={!props.failed} fallback={<span class="attachment-chip">{props.file.name}</span>}>
      <Show when={props.url} fallback={<span class="attachment-image placeholder" />}>
        {(url) => (
          <>
            <button
              class="attachment-open"
              aria-label={`Preview ${props.file.name}`}
              onClick={() => setExpanded(true)}
            >
              <img
                class="attachment-image"
                classList={{ grouped: props.grouped }}
                src={url()}
                alt={props.file.name}
                onError={() => props.onError()}
              />
            </button>
            <Show when={expanded()}>
              <ImageDialog src={url()} alt={props.file.name} onClose={() => setExpanded(false)} />
            </Show>
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
    <span class="diff-counts">
      <span class="added-text">+{props.additions}</span>{" "}
      <span class="removed-text">-{props.deletions}</span>
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
            class="meta-files"
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
    <article class="row changed-files">
      <header>
        <span>
          {totals().count} changed file{totals().count === 1 ? "" : "s"}
        </span>
        <DiffCounts additions={totals().additions} deletions={totals().deletions} />
        <span class="composer-spacer" />
        <Show when={props.turn}>
          {(turn) => (
            <button
              class="open-diff"
              data-tip="Open this turn's diff"
              onClick={() => session.openDiff("turn", turn())}
            >
              <FileDiff />
              Open diff
            </button>
          )}
        </Show>
      </header>
      <ul>
        <For each={props.item.files}>
          {(file) => (
            <li>
              <File />
              <span class="changed-path">{file.path}</span>
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
    <div class="fold-header">
      <Dynamic component={props.fold.Kind === "agent" ? MessagesSquare : CalendarClock} />
      <Show
        when={props.fold.Sender?.Openable ? props.fold.Sender : null}
        fallback={<span class="fold-label">{props.fold.Label}</span>}
      >
        {(sender) => (
          <button
            type="button"
            class="fold-label link"
            data-tip="Open thread"
            onClick={() => environment.selectThread(sender().Ref.threadId)}
          >
            {props.fold.Label}
          </button>
        )}
      </Show>
      <button
        type="button"
        class="fold-toggle"
        aria-expanded={props.expanded}
        onClick={() => props.onToggle()}
      >
        <span class="fold-summary">{props.fold.Summary}</span>
        <ChevronDown class="fold-chevron" classList={{ open: props.expanded }} />
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
    <Show when={fold()} fallback={<span class="queued-text">{text()}</span>}>
      {(held) => (
        <div class="queued-fold">
          <FoldHeader
            fold={held()}
            expanded={expanded()}
            onToggle={() => setExpanded((open) => !open)}
          />
          <Show when={expanded()}>
            <span class="queued-text">{text()}</span>
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
            <div class="bubble" classList={{ grouped: attachments().length > 0 }}>
              <Markdown text={body()} fromUser message={sent() ?? undefined} />
            </div>
          </Show>
        )}
      </Show>
    </>
  );
  return (
    <article class="row user" classList={{ inherited: inherited() }}>
      <Show when={sent() !== null && attribution(sent()!) === "t3code"}>
        <p class="message-note">Sent by T3 Code</p>
      </Show>
      <Show when={steer()}>
        {(label) => (
          <p class="message-note" data-tip={label().Tip}>
            <Redo2 />
            {label().Text}
          </p>
        )}
      </Show>
      <Show when={fold()} fallback={content(false)}>
        {(held) => (
          <div class="bubble folded" classList={{ expanded: expanded() }}>
            <FoldHeader
              fold={held()}
              expanded={expanded()}
              onToggle={() => setExpanded((open) => !open)}
            />
            <Show when={expanded()}>
              <div class="fold-body">{content(true)}</div>
            </Show>
          </div>
        )}
      </Show>
      <Show when={fold() === null || expanded()}>
        <div class="message-actions">
          <Show when={createdAt()}>{(at) => <MessageTime at={at()} />}</Show>
          <Show when={text()}>{(body) => <CopyButton text={body()} label="Copy message" />}</Show>
        </div>
      </Show>
    </article>
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
    <div class="message-actions" classList={{ standalone: props.standalone === true }}>
      <Show when={updatedAt()}>
        {(at) => (
          <>
            <Show when={text()}>{(body) => <CopyButton text={body()} label="Copy message" />}</Show>
            <MessageTime at={at()} />
          </>
        )}
      </Show>
      <Show when={props.files}>{(id) => <FilesSummary id={id()} />}</Show>
    </div>
  );
}

function MessageRow(props: IRowProps & { meta: boolean }) {
  const { item, inherited } = useRow(props);
  const view = createMemo(() => {
    const held = item();
    return held === undefined ? undefined : viewOf(held);
  });
  return (
    <article class={`row ${view()?.Tone}`} classList={{ inherited: inherited() }}>
      <Show when={view()?.Tone === "plan"}>
        <header class="plan-title">{view()?.Label}</header>
      </Show>
      <Show when={view()?.Body}>
        {(text) => <Body text={text()} format={view()?.Format ?? "text"} />}
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
  "secret_request",
  "link_request",
  "subagent",
  "checkpoint",
  "compaction",
]);

export function WorkRow(props: IRowProps & { single?: boolean }) {
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
  const expanded = () => session.expandedTimelineRows()[props.id] === true;
  const live = () => {
    const status = item()?.status;
    return status === "running" || status === "pending" || status === "waiting" ? status : null;
  };
  const label = () => (
    <>
      <RowIcon type={item()?.type ?? ""} />
      <span class="work-label">{view()?.Label}</span>
      <Show when={counts()}>
        {(held) => <DiffCounts additions={held().additions} deletions={held().deletions} />}
      </Show>
      <Show when={live()}>
        <span class="work-live">{live()}</span>
      </Show>
    </>
  );
  const body = () => (
    <Show when={view()?.Body}>
      {(text) => <Body text={text()} format={view()?.Format ?? "text"} />}
    </Show>
  );
  return (
    <article
      class={`row work ${view()?.Tone}`}
      classList={{
        inherited: inherited(),
        "with-action": diffTurn() !== null,
        failed: view()?.Failed === true,
      }}
    >
      <Show
        when={view()?.Collapsed && (view()?.Body || view()?.LiveOutput)}
        fallback={
          <>
            <div class="work-line">{label()}</div>
            {body()}
          </>
        }
      >
        {/* Setting open fires toggle too, so only a change from the held state toggles it. */}
        <details
          open={expanded()}
          onToggle={(event) => {
            if (event.currentTarget.open !== expanded()) session.toggleRowExpanded(props.id);
          }}
        >
          <summary class="work-line">
            {label()}
            <ChevronRight class="work-chevron" />
          </summary>
          <div class="work-detail">
            <Show when={view()?.LiveOutput && expanded()}>
              <CommandOutput
                environmentId={thread.state.EnvironmentId}
                threadId={thread.state.Rows[props.id]?.sourceThreadId ?? thread.state.ThreadId}
                itemId={props.id}
              />
            </Show>
            {body()}
          </div>
        </details>
      </Show>
      <Show when={diffTurn()}>
        {(turn) => (
          <button class="diff-link" onClick={() => session.openDiff("turn", turn())}>
            View diff
          </button>
        )}
      </Show>
    </article>
  );
}

const ROWS: Record<string, Component<IRowProps & { meta: boolean }>> = {
  user: UserRow,
  message: MessageRow,
  "changed-files": ChangedFilesRow,
  work: WorkRow,
};

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
