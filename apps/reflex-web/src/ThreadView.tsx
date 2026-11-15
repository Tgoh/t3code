// @effect-diagnostics globalTimers:off -- A view-only reset of the copied icon, outside any Effect runtime.
import { type IActionGenerator, type IEntity } from "treflex";
import { useComponentState, useResource } from "treflex-solid";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Dynamic } from "solid-js/web";

import { ProjectBadge } from "./brand";
import { CommandOutput } from "./CommandOutput";
import { Composer } from "./Composer";
import { CopyButton } from "./CopyButton";
import { DiffPanel } from "./DiffPanel";
import Environment from "./Environment";
import HistoryWindow from "./HistoryWindow";
import {
  Bot,
  Brain,
  ChevronDown,
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
  PanelBottom,
  PanelRight,
  ShieldQuestion,
  SquarePen,
  Terminal,
  Wrench,
  X,
} from "./icons";
import {
  attachmentUrlEffect,
  type IApprovalDecision,
  type IWireAttachment,
} from "./Infrastructure/commandEffects";
import type { IWireTurnItem } from "./Infrastructure/wire";
import { Markdown } from "./Markdown";
import OpenThread, {
  diffTurnOf,
  fileChangeCounts,
  isRowVisible,
  latestDiffTurn,
  pendingRequest,
  timelineItem,
} from "./OpenThread";
import RuntimeRequest from "./RuntimeRequest";
import { hasUnseenCompletion, runStatus } from "./Shell";
import { TerminalPanel } from "./TerminalPanel";
import ThreadSession, { questionAnswers } from "./ThreadSession";
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

function RowIcon(props: { type: string }) {
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
  const [expanded, setExpanded] = createSignal(false);
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
        <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
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

function TimelineRow(props: IRowProps) {
  const thread = OpenThread.use();
  const kind = createMemo(() => {
    const item = timelineItem(thread.state, props.id);
    return item === undefined || !isRowVisible(thread.state, props.id) ? null : rowKind(item);
  });
  return <Dynamic component={ROWS[kind() ?? ""]} id={props.id} />;
}

const PendingApproval = RuntimeRequest.provider(() => {
  const thread = OpenThread.use();
  const request = RuntimeRequest.use();
  const item = createMemo(() => {
    const held = pendingRequest(thread.state, request.state.id)?.Item;
    return held?.type === "approval_request" ? held : null;
  });
  const options = () => {
    const given = item()?.options;
    return given?.length
      ? given
      : ([
          { decision: "decline", label: "Decline" },
          { decision: "accept", label: "Approve" },
        ] as const);
  };
  return (
    <div class="pending-approval">
      <div class="work-line">
        <RowIcon type="command_execution" />
        <code class="approval-subject">{item()?.prompt ?? item()?.requestKind}</code>
      </div>
      <div class="approval-actions">
        <span class="approval-state">
          <ShieldQuestion />
          Waiting for approval
        </span>
        <For each={options()}>
          {(option) => (
            <>
              <span class="approval-dot">·</span>
              <button
                classList={{ strong: option.decision === "accept" }}
                disabled={request.answering()}
                onClick={() =>
                  request.answerRequest(
                    thread.state.EnvironmentId,
                    thread.state.ThreadId,
                    option.decision as IApprovalDecision,
                    null,
                  )
                }
              >
                {option.label}
              </button>
            </>
          )}
        </For>
      </div>
      <Show when={request.answerError()}>
        {(error) => <p class="composer-error">Couldn't answer: {error()}</p>}
      </Show>
    </div>
  );
});

const RequestBanner = RuntimeRequest.provider(() => {
  const thread = OpenThread.use();
  const session = ThreadSession.use();
  const request = RuntimeRequest.use();
  const pending = createMemo(() => pendingRequest(thread.state, request.state.id));
  const view = () => {
    const item = pending()?.Item;
    return item == null ? null : viewOf(item);
  };
  const questions = () => {
    const item = pending()?.Item;
    return item?.type === "user_input_request" ? item.questions : null;
  };
  const answers = () => {
    const asked = questions();
    return asked === null ? null : questionAnswers(session.state, request.state.id, asked);
  };
  return (
    <div class="composer-banner warning">
      <div class="banner-title">
        <ShieldQuestion />
        <strong>{view()?.Label ?? `Request: ${request.state.kind}`}</strong>
      </div>
      <Show when={view()?.Body?.replace(/\n?Status: \w+$/, "")}>
        {(body) => <pre class="banner-body">{body()}</pre>}
      </Show>
      <Show when={questions()}>
        {(asked) => (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const given = answers();
              if (given !== null)
                request.answerRequest(
                  thread.state.EnvironmentId,
                  thread.state.ThreadId,
                  null,
                  given,
                );
            }}
          >
            <For each={asked()}>
              {(question) => (
                <label class="question">
                  {question.header}
                  <input
                    list={`options-${question.id}`}
                    value={session.state.QuestionAnswers[request.state.id]?.[question.id] ?? ""}
                    onInput={(event) =>
                      session.setQuestionAnswer(
                        request.state.id,
                        question.id,
                        event.currentTarget.value,
                      )
                    }
                  />
                  <datalist id={`options-${question.id}`}>
                    <For each={question.options}>{(option) => <option value={option.label} />}</For>
                  </datalist>
                </label>
              )}
            </For>
            <div class="request-actions">
              <button class="button primary" disabled={request.answering() || answers() === null}>
                Answer
              </button>
            </div>
          </form>
        )}
      </Show>
      <Show when={questions() === null}>
        <p class="banner-body">Answer this one in the stock client.</p>
      </Show>
      <Show when={request.answerError()}>
        {(error) => <p class="composer-error">Couldn't answer: {error()}</p>}
      </Show>
    </div>
  );
});

const LoadEarlier = HistoryWindow.provider(() => {
  const history = HistoryWindow.use();
  return (
    <>
      <Show when={history.state.HasMore}>
        <button
          class="button load-earlier"
          disabled={history.loadingEarlier()}
          onClick={() => history.loadEarlier()}
        >
          {history.loadingEarlier() ? "Loading…" : "Load earlier"}
        </button>
      </Show>
      <Show when={history.state.Error}>
        <p class="thread-notice">{history.state.Error}</p>
      </Show>
    </>
  );
});

const ThreadBody = ThreadSession.provider(() => {
  const thread = OpenThread.use();
  const session = ThreadSession.use();
  const environment = Environment.use();
  const stream = useResource(() => thread.state, "Thread/Stream");
  const retrying = () => {
    const status = stream.status();
    return status.State === "live" && status.Detail === "retrying";
  };
  const endedReason = () => {
    const status = stream.status();
    return status.State === "ended" ? status.Reason : null;
  };
  const runState = () => {
    const run = thread.latestRun();
    return run === null ? null : runStatus(run.status);
  };
  // Once per completion, so a thread marked unread while open stays unread until the next one.
  let visitedCompletion: string | null | undefined;
  createEffect(() => {
    const row = environment.state.Replica.Shell.Threads[thread.state.ThreadId];
    if (row === undefined || !hasUnseenCompletion(row)) return;
    if (visitedCompletion === row.latestRunCompletedAt) return;
    visitedCompletion = row.latestRunCompletedAt;
    environment.threadCommand(row.id, { Kind: "visit", VisitedAt: row.updatedAt });
  });
  const terminalOpen = () => session.state.Terminal.Open;
  const diffOpen = () => session.state.Panels.Diff.Open;
  let scroller!: HTMLDivElement;
  let content!: HTMLDivElement;
  const [stuck, setStuck] = createSignal(true);
  let lastTop = 0;
  const scrollToEnd = () => {
    scroller.scrollTop = scroller.scrollHeight;
  };
  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (stuck()) scrollToEnd();
    });
    observer.observe(content);
    onCleanup(() => observer.disconnect());
  });
  return (
    <div class="thread-layout">
      <section class="thread">
        <header class="thread-header">
          <div class="breadcrumb">
            <Show when={session.projectName()}>
              {(name) => (
                <>
                  <button
                    class="crumb-link"
                    aria-label={`New thread in ${name()}`}
                    data-tip={`New thread in ${name()}`}
                    onClick={() => {
                      const projectId = thread.state.Thread?.projectId;
                      if (projectId !== undefined) environment.newThread(projectId);
                    }}
                  >
                    <ProjectBadge name={name()} size={14} />
                    <span class="crumb-project">{name()}</span>
                  </button>
                  <span class="crumb-separator">/</span>
                </>
              )}
            </Show>
            <h1 data-tip={thread.state.Thread?.title}>
              {thread.state.Thread?.title ?? "Loading thread…"}
            </h1>
            <Show when={!thread.threadSynchronized()}>
              <span class="crumb-note">syncing</span>
            </Show>
          </div>
          <div class="panel-controls">
            <Show when={thread.state.Thread !== null}>
              <button
                class="icon-button toggle"
                classList={{ pressed: terminalOpen() }}
                aria-label="Toggle terminal drawer"
                data-tip="Toggle terminal drawer"
                aria-pressed={terminalOpen()}
                onClick={() => (terminalOpen() ? session.closeTerminal() : session.openTerminal())}
              >
                <PanelBottom />
              </button>
            </Show>
            <button
              class="icon-button toggle"
              classList={{ pressed: diffOpen() }}
              aria-label="Toggle thread diff"
              data-tip="Toggle thread diff"
              aria-pressed={diffOpen()}
              disabled={!diffOpen() && latestDiffTurn(thread.state) === null}
              onClick={() => (diffOpen() ? session.closeDiff() : session.openDiff("thread", null))}
            >
              <PanelRight />
            </button>
          </div>
        </header>
        <Show when={endedReason()}>
          {(reason) => <p class="thread-notice">This thread's stream ended: {reason()}</p>}
        </Show>
        <Show when={retrying()}>
          <p class="thread-notice">Can't load this thread right now. Retrying.</p>
        </Show>
        <div
          class="timeline"
          ref={scroller}
          onScroll={() => {
            const top = scroller.scrollTop;
            if (scroller.scrollHeight - top - scroller.clientHeight < 40) setStuck(true);
            // Only an upward scroll detaches: the scroll event can land after more content
            // arrived, which leaves a follow-up scroll looking far from the end.
            else if (top < lastTop) setStuck(false);
            lastTop = top;
          }}
        >
          <div class="timeline-lane" ref={content}>
            <Show when={thread.state.History} keyed>
              {(history) => <LoadEarlier state={history} />}
            </Show>
            <For each={thread.state.Timeline}>{(id) => <TimelineRow id={id} />}</For>
            <For each={thread.pendingApprovalIds()}>
              {(id) => <PendingApproval state={thread.state.RuntimeRequests[id]!} />}
            </For>
            <Show when={thread.state.Thread !== null && thread.state.Timeline.length === 0}>
              <p class="empty">Nothing here yet.</p>
            </Show>
          </div>
        </div>
        <div class="composer-lane">
          <Show when={!stuck()}>
            <button class="scroll-to-end" onClick={scrollToEnd}>
              <ChevronDown />
              Scroll to end
            </button>
          </Show>
          <For each={thread.pendingQuestionIds()}>
            {(id) => <RequestBanner state={thread.state.RuntimeRequests[id]!} />}
          </For>
          <Show when={thread.queuedRuns().length > 0}>
            <div class="composer-banner">
              <div class="banner-title">
                <strong>Queued</strong>
                <Show when={runState() !== "running" && runState() !== "waiting"}>
                  <button class="button" onClick={() => session.queueAction(null)}>
                    Resume
                  </button>
                </Show>
              </div>
              <For each={thread.queuedRuns()}>
                {(run) => (
                  <p class="queued">
                    <button class="button" onClick={() => session.queueAction(run.RunId)}>
                      Cancel
                    </button>
                    <span>{run.Text}</span>
                  </p>
                )}
              </For>
            </div>
          </Show>
          <Composer active={runState() === "running" || runState() === "waiting"} />
        </div>
        <Show when={terminalOpen()}>
          <TerminalPanel />
        </Show>
      </section>
      <Show when={diffOpen()}>
        <DiffPanel />
      </Show>
    </div>
  );
});

export const ThreadView = OpenThread.provider(() => {
  const thread = OpenThread.use();
  const environment = Environment.use();
  return (
    <Show when={environment.state.Local.ThreadSessions[thread.state.ThreadId]} keyed>
      {(session) => <ThreadBody state={session} />}
    </Show>
  );
});
