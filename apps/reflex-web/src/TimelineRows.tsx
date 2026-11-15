import { type IActionGenerator, type IEntity } from "treflex";
import { useComponentState } from "treflex-solid";
import { type Component, createMemo, createSignal, For, onMount, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

import { CommandOutput } from "./CommandOutput";
import { CopyButton } from "./CopyButton";
import {
  Bot,
  Brain,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  File,
  FileDiff,
  FileSearch,
  Globe,
  Link,
  ListTodo,
  MessageCircleQuestion,
  ShieldQuestion,
  SquarePen,
  Terminal,
  Wrench,
  X,
} from "./icons";
import { attachmentUrlEffect, type IWireAttachment } from "./Infrastructure/commandEffects";
import type { IWireTurnItem } from "./Infrastructure/wire";
import { Markdown } from "./Markdown";
import OpenThread, { diffTurnOf, fileChangeCounts, isRowVisible, timelineItem } from "./OpenThread";
import ThreadSession from "./ThreadSession";
import { dayAwareTimestamp, fullTimestamp } from "./timestamps";
import { viewOf } from "./turnItemView";

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

function MessageTime(props: { at: string }) {
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
  attachmentId: string,
): IActionGenerator {
  try {
    draft.Url = yield* attachmentUrlEffect({
      EnvironmentId: environmentId,
      AttachmentId: attachmentId,
    });
  } catch {
    draft.Failed = true;
  }
}

function AttachmentImage(props: {
  environmentId: string;
  file: IWireAttachment;
  grouped: boolean;
}) {
  const local = useComponentState<IAttachmentImage>(() => ({ Url: null, Failed: false }));
  onMount(() => local.dispatch(loadAttachmentUrl, props.environmentId, props.file.id));
  const [expanded, setExpanded] = createSignal(false);
  return (
    <Show
      when={props.file.mimeType.startsWith("image/") && !local.state.Failed}
      fallback={<span class="attachment-chip">{props.file.name}</span>}
    >
      <Show when={local.state.Url} fallback={<span class="attachment-image placeholder" />}>
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
                onError={() => local.dispatch(markFailed)}
              />
            </button>
            <Show when={expanded()}>
              <dialog
                class="image-dialog"
                ref={(dialog) => queueMicrotask(() => dialog.showModal())}
                onClose={() => setExpanded(false)}
                onClick={(event) => event.currentTarget.close()}
              >
                <img src={url()} alt={props.file.name} />
                <button class="icon-button image-dialog-close" aria-label="Close preview">
                  <X />
                </button>
              </dialog>
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

function ChangedFiles(props: { item: IWireCheckpoint; turn: number | null }) {
  const session = ThreadSession.use();
  const totals = () =>
    props.item.filesTotal ?? {
      count: props.item.files.length,
      additions: props.item.files.reduce((total, file) => total + file.additions, 0),
      deletions: props.item.files.reduce((total, file) => total + file.deletions, 0),
    };
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

function UserRow(props: IRowProps) {
  const { thread, item, inherited } = useRow(props);
  const message = () => {
    const held = item();
    return held?.type === "user_message" ? held : null;
  };
  const attachments = () => message()?.attachments ?? [];
  const createdAt = () => {
    const held = message();
    return held === null ? undefined : (held.startedAt ?? held.updatedAt);
  };
  return (
    <article class="row user" classList={{ inherited: inherited() }}>
      <For each={attachments()}>
        {(file) => (
          <AttachmentImage
            environmentId={thread.state.EnvironmentId}
            file={file}
            grouped={Boolean(message()?.text)}
          />
        )}
      </For>
      <Show when={message()?.text}>
        {(text) => (
          <div class="bubble" classList={{ grouped: attachments().length > 0 }}>
            <Body text={text()} format="markdown" fromUser />
          </div>
        )}
      </Show>
      <div class="message-actions">
        <Show when={createdAt()}>{(at) => <MessageTime at={at()} />}</Show>
        <Show when={message()?.text}>
          {(text) => <CopyButton text={text()} label="Copy message" />}
        </Show>
      </div>
    </article>
  );
}

function MessageRow(props: IRowProps) {
  const { item, inherited } = useRow(props);
  const view = createMemo(() => {
    const held = item();
    return held === undefined ? undefined : viewOf(held);
  });
  const updatedAt = () => (item()?.status === "completed" ? item()?.updatedAt : undefined);
  return (
    <article class={`row ${view()?.Tone}`} classList={{ inherited: inherited() }}>
      <Show when={view()?.Tone === "plan"}>
        <header class="plan-title">{view()?.Label}</header>
      </Show>
      <Show when={view()?.Body}>
        {(text) => <Body text={text()} format={view()?.Format ?? "text"} />}
      </Show>
      <Show when={view()?.Tone === "assistant"}>
        <div class="message-actions">
          <Show when={updatedAt()}>
            {(at) => (
              <>
                <Show when={view()?.Body}>
                  {(text) => <CopyButton text={text()} label="Copy message" />}
                </Show>
                <MessageTime at={at()} />
              </>
            )}
          </Show>
        </div>
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

function WorkRow(props: IRowProps) {
  const { thread, item, inherited } = useRow(props);
  const session = ThreadSession.use();
  const view = createMemo(() => {
    const held = item();
    if (held === undefined) return undefined;
    return viewOf(held, held.type === "file_change" ? fileChangeCounts(thread.state, held) : null);
  });
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
      classList={{ inherited: inherited(), "with-action": diffTurn() !== null }}
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

const ROWS: Record<string, Component<IRowProps>> = {
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
    default:
      return "work";
  }
}

export function TimelineRow(props: IRowProps) {
  const thread = OpenThread.use();
  const kind = createMemo(() => {
    const item = timelineItem(thread.state, props.id);
    return item === undefined || !isRowVisible(thread.state, props.id) ? null : rowKind(item);
  });
  return <Dynamic component={ROWS[kind() ?? ""]} id={props.id} />;
}
