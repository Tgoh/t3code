// @effect-diagnostics globalDate:off globalTimers:off -- A view-only tick for the working timer, outside any Effect runtime.
import {
  liveThoughtLine,
  summarizeToolGroup,
  type ToolGroupSummaryKind,
  toolGroupSummaryKind,
  workEntryDisplayIndicatesToolFailure,
} from "@t3tools/client-runtime/work-log/presentation";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import {
  type Accessor,
  type Component,
  createMemo,
  createSignal,
  For,
  getOwner,
  Match,
  onCleanup,
  runWithOwner,
  Show,
  Switch,
} from "solid-js";
import { Dynamic } from "solid-js/web";

import Environment from "./Environment";
import {
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  FileSearch,
  Globe,
  SquarePen,
  Terminal,
  Wrench,
} from "./icons";
import OpenThread, { isRowVisible, timelineItem } from "./OpenThread";
import { runStatus, workingStartedAt } from "./Shell";
import ThreadSession from "./ThreadSession";
import {
  entryFacts,
  type IEntryFacts,
  type ILatestRun,
  type ILayoutRow,
  layoutResponse,
  sameFacts,
} from "./timelineLayout";
import {
  MessageMeta,
  MessageTime,
  RowIcon,
  TimelineRow,
  useWorkspaceRoot,
  WorkRow,
} from "./TimelineRows";
import { liveWorkEntryLabel, workLogEntry, workLogEntryIsToolLike } from "./workLog";

type IRowOf<K extends ILayoutRow["Kind"]> = Extract<ILayoutRow, { Kind: K }>;

const sameRun = (left: ILatestRun | null, right: ILatestRun | null) =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.Id === right.Id &&
    left.Status === right.Status &&
    left.StartedAt === right.StartedAt &&
    left.CompletedAt === right.CompletedAt);

const sameKeys = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((key, index) => key === right[index]);

// Each row's facts are a memo of their own that stays equal through text deltas, so the layout
// re-runs only when a row in this response arrives, starts or settles.
export function TimelineResponse(props: { ids: readonly string[]; latest: boolean }) {
  const thread = OpenThread.use();
  const session = ThreadSession.use();
  const owner = getOwner();
  const facts = new Map<string, Accessor<IEntryFacts | null>>();
  const factsOf = (id: string) => {
    let held = facts.get(id);
    if (held === undefined) {
      held = runWithOwner(owner, () =>
        createMemo(
          () => {
            const item = timelineItem(thread.state, id);
            return item === undefined || !isRowVisible(thread.state, id) ? null : entryFacts(item);
          },
          null,
          { equals: sameFacts },
        ),
      )!;
      facts.set(id, held);
    }
    return held();
  };
  const latestRun = createMemo<ILatestRun | null>(
    () => {
      const run = thread.latestRun();
      return run === null
        ? null
        : {
            Id: run.id,
            Status: run.status,
            StartedAt: run.startedAt ?? null,
            CompletedAt: run.completedAt ?? null,
          };
    },
    null,
    { equals: sameRun },
  );
  const working = () => {
    const run = latestRun();
    const status = run === null ? null : runStatus(run.Status as never);
    return status === "running" || status === "waiting";
  };
  // The parent's segments change on every added row, but an earlier response keeps its array.
  const ids = createMemo(() => props.ids);
  const latest = createMemo(() => props.latest);
  const layout = createMemo(() =>
    layoutResponse({
      Entries: ids().flatMap((id) => factsOf(id) ?? []),
      Latest: latest(),
      LatestRun: latestRun(),
      Working: working(),
      PendingApproval: latest() && thread.pendingApprovalIds().length > 0,
      Expanded: (key) => session.expandedTimelineRows()[key] === true,
    }),
  );
  const rows = createMemo(() => new Map(layout().map((row) => [row.Key, row])));
  const keys = createMemo(() => layout().map((row) => row.Key), [], { equals: sameKeys });
  return <For each={keys()}>{(key) => <LayoutRow row={() => rows().get(key)} ids={ids} />}</For>;
}

function LayoutRow(props: { row: () => ILayoutRow | undefined; ids: () => readonly string[] }) {
  const of = <K extends ILayoutRow["Kind"]>(kind: K) => {
    const row = props.row();
    return row?.Kind === kind ? (row as IRowOf<K>) : undefined;
  };
  return (
    <Switch>
      <Match when={of("item")}>{(row) => <TimelineRow id={row().Id} meta={row().Meta} />}</Match>
      <Match when={of("single")}>{(row) => <WorkRow id={row().Id} single />}</Match>
      <Match when={of("group")}>{(row) => <GroupRow row={row()} />}</Match>
      <Match when={of("fold")}>{(row) => <FoldRow row={row()} />}</Match>
      <Match when={of("live")}>{(row) => <LiveRow row={row()} />}</Match>
      <Match when={of("working")}>
        <WorkingRow />
      </Match>
      <Match when={of("thinking")}>{(row) => <ThinkingRow row={row()} ids={props.ids} />}</Match>
      <Match when={of("meta")}>
        {(row) => <MessageMeta id={row().Id} files={row().Files} standalone />}
      </Match>
    </Switch>
  );
}

function FoldRow(props: { row: IRowOf<"fold"> }) {
  const session = ThreadSession.use();
  return (
    <div class="turn-fold">
      <button
        class="turn-fold-toggle"
        aria-expanded={props.row.Expanded}
        onClick={() => session.toggleRowExpanded(props.row.Key)}
      >
        <span>{props.row.Label}</span>
        <Show when={props.row.Expanded} fallback={<ChevronRight />}>
          <ChevronDown />
        </Show>
      </button>
      <MessageTime at={props.row.At} />
    </div>
  );
}

const SUMMARY_ICONS: Partial<Record<ToolGroupSummaryKind, Component>> = {
  command: Terminal,
  edit: SquarePen,
  read: FileSearch,
  "code-search": FileSearch,
  search: Globe,
  reasoning: Brain,
  "agent-tool": Bot,
};

function useEntries(ids: () => readonly string[]) {
  const thread = OpenThread.use();
  return createMemo(() =>
    ids().flatMap((id) => {
      const item = timelineItem(thread.state, id);
      return item === undefined ? [] : [workLogEntry(item)];
    }),
  );
}

function GroupList(props: { ids: readonly string[] }) {
  return (
    <div class="work-group-list">
      <For each={props.ids}>{(id) => <WorkRow id={id} />}</For>
    </div>
  );
}

// Follows the work-toggle row of deriveMessagesTimelineRows and WorkGroupToggleTimelineRow.
function GroupRow(props: { row: IRowOf<"group"> }) {
  const session = ThreadSession.use();
  const entries = useEntries(() => props.row.Ids);
  const summary = createMemo(() => {
    const held = entries();
    return held.length === 1 && !workLogEntryIsToolLike(held[0]!)
      ? held[0]!.label
      : summarizeToolGroup(held).summary;
  });
  const failed = () => {
    const last = entries().findLast(workLogEntryIsToolLike);
    return last !== undefined && workEntryDisplayIndicatesToolFailure(last);
  };
  return (
    <div class="work-group">
      <button
        class="work-line work-toggle"
        classList={{ failed: failed() }}
        aria-expanded={props.row.Expanded}
        onClick={() => session.toggleRowExpanded(props.row.Key)}
      >
        <span class="work-icon">
          <Dynamic component={SUMMARY_ICONS[toolGroupSummaryKind(entries())] ?? Wrench} />
        </span>
        <span class="work-label">{summary()}</span>
        <ChevronRight class="work-chevron" classList={{ open: props.row.Expanded }} />
        <span class="composer-spacer" />
        <MessageTime at={props.row.At} />
      </button>
      <Show when={props.row.Expanded}>
        <GroupList ids={props.row.Ids} />
      </Show>
    </div>
  );
}

// Reasoning past this length can't change the first line, so the preview reads no further.
const THOUGHT_PREVIEW_LENGTH = 8_192;

// Follows LiveWorkEntryTimelineRow in apps/web/src/components/chat/TimelineWorkGroupRows.tsx.
function LiveRow(props: { row: IRowOf<"live"> }) {
  const thread = OpenThread.use();
  const session = ThreadSession.use();
  const workspaceRoot = useWorkspaceRoot();
  const entry = createMemo(() => {
    const item = timelineItem(thread.state, props.row.Id);
    return item === undefined ? null : workLogEntry(item);
  });
  const thought = createMemo(() => {
    const id = props.row.ThoughtId;
    const item = id === null || props.row.Expanded ? undefined : timelineItem(thread.state, id);
    return item?.type === "reasoning"
      ? liveThoughtLine(item.text.slice(0, THOUGHT_PREVIEW_LENGTH))
      : "";
  });
  const label = () => {
    const held = entry();
    if (held === null) return "";
    if (thought() !== "" && props.row.ThoughtId === props.row.Id)
      return props.row.Active ? "Thinking" : "Thought";
    return liveWorkEntryLabel(held, workspaceRoot(), props.row.Active);
  };
  const failed = () => {
    const held = entry();
    return held !== null && workEntryDisplayIndicatesToolFailure(held);
  };
  return (
    <div class="work-group">
      <button
        class="work-live-toggle"
        aria-expanded={props.row.Expanded}
        onClick={() => session.toggleRowExpanded(props.row.GroupKey)}
      >
        <Show when={thought()}>
          {(line) => (
            <span class="work-line">
              <span class="work-icon">
                <Brain />
              </span>
              <span class="work-thought">{line()}</span>
            </span>
          )}
        </Show>
        <span class="work-line" classList={{ failed: failed() }}>
          <RowIcon type={entry()?.itemType ?? ""} />
          <span class="work-label" classList={{ "live-label": props.row.Active }}>
            {label()}
          </span>
        </span>
      </button>
      <Show when={props.row.Expanded}>
        <GroupList ids={props.row.Ids} />
      </Show>
    </div>
  );
}

const SECOND = 1_000;

function useNow() {
  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), SECOND);
  onCleanup(() => clearInterval(tick));
  return now;
}

// Follows formatWorkingTimerNow in apps/web/src/components/chat/TimelineWorkGroupRows.logic.ts.
function workingTimer(since: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / SECOND));
  return seconds < 60 ? `${seconds}s` : formatDuration(seconds * SECOND);
}

function WorkingRow() {
  const thread = OpenThread.use();
  const environment = Environment.use();
  const now = useNow();
  const since = () => {
    const row = environment.state.Replica.Shell.Threads[thread.state.ThreadId];
    return row === undefined ? null : workingStartedAt(row);
  };
  return (
    <div class="working-row">
      <Show when={since()} fallback="Working...">
        {(start) => <>Working for {workingTimer(start(), now())}</>}
      </Show>
    </div>
  );
}

// Follows liveAnswerPreview: the latest line of the reply or reasoning after the prompt.
function ThinkingRow(props: { row: IRowOf<"thinking">; ids: () => readonly string[] }) {
  const thread = OpenThread.use();
  const session = ThreadSession.use();
  const preview = createMemo(() => {
    const ids = props.ids();
    for (let index = ids.length - 1; index >= 0; index -= 1) {
      const item = timelineItem(thread.state, ids[index]!);
      if (item === undefined) continue;
      if (item.type === "user_message" || item.type === "notification") break;
      const text =
        item.type === "assistant_message" || item.type === "reasoning"
          ? item.text.slice(0, THOUGHT_PREVIEW_LENGTH)
          : "";
      const line = liveThoughtLine(text);
      if (line !== "") return line;
    }
    return null;
  });
  const line = () => (
    <span class="work-line">
      <span class="work-icon">
        <Brain />
      </span>
      <span class="work-label">{preview() ?? "Thinking"}</span>
    </span>
  );
  return (
    <Show when={props.row.GroupKey} fallback={<div class="work-group">{line()}</div>}>
      {(key) => (
        <div class="work-group">
          <button
            class="work-live-toggle"
            aria-expanded={props.row.Expanded}
            onClick={() => session.toggleRowExpanded(key())}
          >
            {line()}
          </button>
          <Show when={props.row.Expanded}>
            <GroupList ids={props.row.Ids} />
          </Show>
        </div>
      )}
    </Show>
  );
}
