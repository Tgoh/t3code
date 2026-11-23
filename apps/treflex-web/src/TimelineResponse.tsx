import {
  resolveViewedImageAsset,
  summarizeToolGroup,
  type ToolGroupSummaryKind,
  toolGroupSummaryKind,
  workEntriesViewedImagePaths,
  workEntryDisplayIndicatesToolFailure,
} from "@t3tools/client-runtime/work-log/presentation";
import {
  type Accessor,
  type Component,
  createMemo,
  For,
  getOwner,
  Match,
  runWithOwner,
  Show,
  Switch,
} from "solid-js";
import { Dynamic } from "@solidjs/web";
import { latestProviderTurnForAttempt } from "@t3tools/contracts";

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
import { ViewedImage } from "./Markdown";
import OpenThread, { isRowVisible, timelineItem } from "./OpenThread";
import { runStatus } from "./Shell";
import { SubagentGroup } from "./SubagentRows";
import ThreadSession from "./ThreadSession";
import {
  attemptOf,
  attemptsByRoot,
  entryFacts,
  type IEntryFacts,
  type ILatestRun,
  type ILayoutRow,
  layoutResponse,
  sameFacts,
} from "./timelineLayout";
import {
  CompactingRow,
  CompactionRow,
  MessageMeta,
  MessageTime,
  ROW_FOCUS,
  TimelineRow,
  WORK_ICON,
  WorkRow,
} from "./TimelineRows";
import { useWorkingTimer } from "./TurnStatus";
import { workLogEntry, workLogEntryIsToolLike } from "./workLog";
import { useWorkspaceRoot } from "./workspaceRoot";

type IRowOf<K extends ILayoutRow["Kind"]> = Extract<ILayoutRow, { Kind: K }>;

const sameRun = (left: ILatestRun | null, right: ILatestRun | null) =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.Id === right.Id &&
    left.Status === right.Status &&
    left.StartedAt === right.StartedAt &&
    left.CompletedAt === right.CompletedAt &&
    left.TurnEnded === right.TurnEnded);

const ACTIVITY_RUN_STATUSES = new Set(["preparing", "starting", "running", "waiting"]);

const sameKeys = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((key, index) => key === right[index]);

// Each row's facts are a memo of their own that stays equal through text deltas, so the layout
// re-runs only when a row in this response arrives, starts or settles.
export function TimelineResponse(props: { ids: readonly string[]; latest: boolean }) {
  const thread = OpenThread.use();
  const session = ThreadSession.use();
  const environment = Environment.use();
  const owner = getOwner();
  const byRoot = createMemo(() => attemptsByRoot(thread.state));
  const facts = new Map<string, Accessor<IEntryFacts | null>>();
  const factsOf = (id: string) => {
    let held = facts.get(id);
    if (held === undefined) {
      held = runWithOwner(owner, () =>
        createMemo(
          () => {
            const item = timelineItem(thread.state, id);
            return item === undefined || !isRowVisible(thread.state, id)
              ? null
              : entryFacts(item, attemptOf(thread.state, byRoot(), item));
          },
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
      if (run === null) return null;
      // Follows turnEnded in summarizeThreadRun, packages/client-runtime/src/state/threadExecution.ts.
      const turn =
        props.latest && ACTIVITY_RUN_STATUSES.has(run.status)
          ? latestProviderTurnForAttempt(
              Object.values(thread.state.ProviderTurns),
              run.activeAttemptId as never,
            )
          : undefined;
      return {
        Id: run.id,
        Status: run.status,
        StartedAt: run.startedAt ?? null,
        CompletedAt: run.completedAt ?? null,
        TurnEnded: turn !== undefined && turn.status !== "pending" && turn.status !== "running",
      };
    },
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
      Expanded: (key) => session.state.ExpandedRows[key] === true,
      Visibility: environment.toolCallVisibility(),
    }),
  );
  const rows = createMemo(() => new Map(layout().map((row) => [row.Key, row])));
  const keys = createMemo(() => layout().map((row) => row.Key), { equals: sameKeys });
  return <For each={keys()}>{(key) => <LayoutRow row={() => rows().get(key)} />}</For>;
}

function LayoutRow(props: { row: () => ILayoutRow | undefined }) {
  const of = <K extends ILayoutRow["Kind"]>(kind: K) => {
    const row = props.row();
    return row?.Kind === kind ? (row as IRowOf<K>) : undefined;
  };
  return (
    <Switch>
      <Match when={of("item")}>{(row) => <TimelineRow id={row().Id} meta={row().Meta} />}</Match>
      <Match when={of("single")}>
        {(row) => (
          <>
            <WorkRow id={row().Id} single />
            <ViewedImages ids={[row().Id]} />
          </>
        )}
      </Match>
      <Match when={of("group")}>{(row) => <GroupRow row={row()} />}</Match>
      <Match when={of("subagents")}>
        {(row) => <SubagentGroup rowKey={row().Key} ids={row().Ids} expanded={row().Expanded} />}
      </Match>
      <Match when={of("fold")}>{(row) => <FoldRow row={row()} />}</Match>
      <Match when={of("meta")}>
        {(row) => <MessageMeta id={row().Id} files={row().Files} standalone />}
      </Match>
      <Match when={of("attempt")}>{(row) => <AttemptRow row={row()} />}</Match>
      <Match when={of("compaction")}>
        {(row) => <CompactionRow id={row().Id} age={row().Age} />}
      </Match>
      <Match when={of("compacting")}>
        {(row) => <CompactingRow id={row().Id} pending={row().Pending} />}
      </Match>
    </Switch>
  );
}

// Follows ViewedImagesTimelineRow in apps/web/src/components/chat/TimelineWorkEntryRow.tsx: the
// images a tool group opened stay in view while the group is collapsed.
function ViewedImages(props: { ids: readonly string[] }) {
  const thread = OpenThread.use();
  const workspaceRoot = useWorkspaceRoot();
  const paths = createMemo(
    () =>
      workEntriesViewedImagePaths(
        props.ids.flatMap((id) => {
          const item = timelineItem(thread.state, id);
          return item === undefined ? [] : [workLogEntry(item)];
        }),
      ),
    { equals: sameKeys },
  );
  const imageOf = (path: string) => {
    const threadId = thread.state.Thread?.id;
    return threadId === undefined
      ? null
      : resolveViewedImageAsset(path, {
          threadId: threadId as never,
          workspaceRoot: workspaceRoot(),
        });
  };
  return (
    <Show when={paths().length > 0}>
      <div class="flex flex-wrap items-start gap-2 px-0.5 pb-2">
        <For each={paths()}>
          {(path) => (
            <Show when={imageOf(path)} keyed>
              {(image) => (
                <ViewedImage
                  resource={image.resource}
                  fragment={image.srcFragment}
                  alt={image.alt}
                  size="strip"
                />
              )}
            </Show>
          )}
        </For>
      </div>
    </Show>
  );
}

// Follows AttemptFoldTimelineRow in apps/web/src/components/chat/MessagesTimeline.tsx.
function AttemptRow(props: { row: IRowOf<"attempt"> }) {
  const session = ThreadSession.use();
  return (
    <button
      class={`mb-1.5 flex w-full cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-left transition-colors select-none hover:bg-muted/35 [&_svg]:size-3.5 [&_svg]:flex-none [&_svg]:text-muted-foreground ${ROW_FOCUS}`}
      aria-expanded={props.row.Expanded ? "true" : "false"}
      onClick={() => session.toggleRowExpanded(props.row.Key)}
    >
      <Show when={props.row.Expanded} fallback={<ChevronRight />}>
        <ChevronDown />
      </Show>
      <span class="text-xs font-medium text-foreground/80">Superseded attempt</span>
      <span class="text-[11px] text-muted-foreground">Cut off by a steer</span>
    </button>
  );
}

function RunningLabel() {
  const timer = useWorkingTimer();
  return <>{timer() === null ? "Working" : `Working for ${timer()}`}</>;
}

function FoldRow(props: { row: IRowOf<"fold"> }) {
  const session = ThreadSession.use();
  return (
    <div class="group/fold mb-1.5 flex items-center gap-1 border-b border-[color-mix(in_srgb,var(--border)_60%,transparent)] pt-1 pr-0.5 pb-2 text-sm leading-relaxed text-muted-foreground tabular-nums">
      <button
        class={`inline-flex cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1 py-0 transition-colors select-none hover:text-foreground [&_svg]:size-3.5 ${ROW_FOCUS}`}
        aria-expanded={props.row.Expanded ? "true" : "false"}
        onClick={() => session.toggleRowExpanded(props.row.Key)}
      >
        <span>
          <Show when={props.row.Running} fallback={props.row.Label}>
            <RunningLabel />
          </Show>
        </span>
        <Show when={props.row.Expanded} fallback={<ChevronRight />}>
          <ChevronDown />
        </Show>
      </button>
      <MessageTime
        at={props.row.At}
        class="ml-auto me-1 text-xs opacity-0 group-hover/fold:opacity-100 group-focus-within/fold:opacity-100 pointer-coarse:opacity-100"
      />
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

// Follows the work-toggle row of deriveMessagesTimelineRows and WorkGroupToggleTimelineRow.
function GroupRow(props: { row: IRowOf<"group"> }) {
  const thread = OpenThread.use();
  const session = ThreadSession.use();
  const entries = createMemo(() =>
    props.row.Ids.flatMap((id) => {
      const item = timelineItem(thread.state, id);
      return item === undefined ? [] : [workLogEntry(item)];
    }),
  );
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
    <div class="pb-2 data-expanded:pb-1" data-expanded={props.row.Expanded ? "" : undefined}>
      <button
        class={`group/row relative flex min-h-6 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-0.5 py-0.5 text-left text-sm leading-relaxed text-secondary-label ${ROW_FOCUS}`}
        aria-label={failed() ? `${summary()}, tool call failed` : undefined}
        aria-expanded={props.row.Expanded ? "true" : "false"}
        onClick={() => session.toggleRowExpanded(props.row.Key)}
      >
        <span class={WORK_ICON}>
          <Dynamic component={SUMMARY_ICONS[toolGroupSummaryKind(entries())] ?? Wrench} />
        </span>
        <span class="min-w-0 flex-1 truncate">{summary()}</span>
        <MessageTime
          at={props.row.At}
          class="pointer-events-none absolute me-1 text-xs opacity-0 group-hover/row:pointer-events-auto group-hover/row:static group-hover/row:opacity-100 group-focus-visible/row:static group-focus-visible/row:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:static pointer-coarse:opacity-100"
        />
      </button>
      <Show when={props.row.Expanded}>
        <div class="flex max-h-[min(18rem,50dvh)] flex-col overflow-y-auto">
          <For each={props.row.Ids}>{(id) => <WorkRow id={id} grouped />}</For>
        </div>
      </Show>
      <ViewedImages ids={props.row.Ids} />
    </div>
  );
}
