import {
  summarizeToolGroup,
  type ToolGroupSummaryKind,
  toolGroupSummaryKind,
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
import { Dynamic } from "solid-js/web";

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
import { runStatus } from "./Shell";
import ThreadSession from "./ThreadSession";
import {
  entryFacts,
  type IEntryFacts,
  type ILatestRun,
  type ILayoutRow,
  layoutResponse,
  sameFacts,
} from "./timelineLayout";
import { MessageMeta, MessageTime, TimelineRow, WORK_ICON, WorkRow } from "./TimelineRows";
import { useWorkingTimer } from "./TurnStatus";
import { workLogEntry, workLogEntryIsToolLike } from "./workLog";

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
      Expanded: (key) => session.expandedTimelineRows()[key] === true,
    }),
  );
  const rows = createMemo(() => new Map(layout().map((row) => [row.Key, row])));
  const keys = createMemo(() => layout().map((row) => row.Key), [], { equals: sameKeys });
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
      <Match when={of("single")}>{(row) => <WorkRow id={row().Id} single />}</Match>
      <Match when={of("group")}>{(row) => <GroupRow row={row()} />}</Match>
      <Match when={of("fold")}>{(row) => <FoldRow row={row()} />}</Match>
      <Match when={of("meta")}>
        {(row) => <MessageMeta id={row().Id} files={row().Files} standalone />}
      </Match>
    </Switch>
  );
}

function RunningLabel() {
  const timer = useWorkingTimer();
  return <>{timer() === null ? "Working" : `Working for ${timer()}`}</>;
}

function FoldRow(props: { row: IRowOf<"fold"> }) {
  const session = ThreadSession.use();
  return (
    <div class="group/fold mb-1.5 flex items-center gap-1 border-b border-[color-mix(in_srgb,var(--border)_60%,transparent)] pt-1 pr-0.5 pb-2 pl-1 text-[14px] leading-6 text-muted-foreground tabular-nums">
      <button
        class="inline-flex cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1 py-0 hover:text-foreground [&_svg]:size-3.5"
        aria-expanded={props.row.Expanded}
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
        class="ml-auto opacity-0 group-hover/fold:opacity-100 pointer-coarse:opacity-100"
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
    <div class="px-0.5 pt-0.5 pb-2">
      <button
        class="group/row flex min-h-6 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent p-0 text-left text-secondary-label hover:text-foreground"
        data-failed={failed() ? "" : undefined}
        aria-expanded={props.row.Expanded}
        onClick={() => session.toggleRowExpanded(props.row.Key)}
      >
        <span class={WORK_ICON}>
          <Dynamic component={SUMMARY_ICONS[toolGroupSummaryKind(entries())] ?? Wrench} />
        </span>
        <span class="min-w-0 flex-initial truncate">{summary()}</span>
        <ChevronRight class="size-3.5 text-muted-foreground opacity-0 group-hover/row:opacity-100 group-aria-expanded/row:rotate-90 group-aria-expanded/row:opacity-100" />
        <span class="flex-1" />
        <MessageTime
          at={props.row.At}
          class="text-[12px] opacity-0 group-hover/row:opacity-100 pointer-coarse:opacity-100"
        />
      </button>
      <Show when={props.row.Expanded}>
        <div class="flex max-h-[min(18rem,50dvh)] flex-col overflow-y-auto pt-0.5">
          <For each={props.row.Ids}>{(id) => <WorkRow id={id} />}</For>
        </div>
      </Show>
    </div>
  );
}
