import { workEntryDisplayIndicatesToolFailure } from "@t3tools/client-runtime/work-log/presentation";
import { turnItemIsWorkspacePreparation } from "@t3tools/client-runtime/state/turn-item-presentation";
import { isOrchestrationV2WorkActive, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { sentMessageFromToolItem } from "@t3tools/shared/toolOutput";

import type { IWireTurnItem } from "./Infrastructure/wire";
import {
  workEntryIndicatesToolSuccess,
  workEntryIsActiveTurnActivity,
  workEntryIsVisibleInGroup,
  workLogEntryIsToolLike,
  workLogEntry,
} from "./workLog";

/**
 * What the layout needs to know about one row, kept to fields that settle, so a streaming text
 * delta leaves it equal and the response isn't laid out again.
 */
export interface IEntryFacts {
  Id: string;
  Kind: "user" | "steer" | "assistant" | "sent" | "plan" | "event" | "checkpoint" | "work";
  Type: IWireTurnItem["type"];
  RunId: string | null;
  At: string;
  End: string;
  Streaming: boolean;
  InProgress: boolean;
  ToolLike: boolean;
  Failed: boolean;
  Success: boolean;
  Activity: boolean;
  Visible: boolean;
  VisibleLive: boolean;
  Standalone: boolean;
  Compaction: boolean;
  QuestionAnswer: boolean;
  Thought: boolean;
  FailedRun: "usage_limit" | "other" | null;
  Persistent: boolean;
  LiveSubagent: boolean;
}

const STANDALONE_EVENTS = new Set<IWireTurnItem["type"]>([
  "fork",
  "handoff",
  "run_interrupt_request",
  "run_interrupt_result",
  "secret_request",
  "link_request",
  "subagent",
]);

const PERSISTENT_TYPES = new Set<IWireTurnItem["type"]>([
  "fork",
  "thread_created",
  "secret_request",
  "link_request",
]);

const isSteer = (item: IWireTurnItem) =>
  item.type === "user_message" &&
  (item.inputIntent === "steer" || item.inputIntent === "promoted_queued_to_steer");

/** Follows timelineEntryStartsResponse in apps/web/src/components/chat/MessagesTimeline.logic.ts. */
export function startsResponse(item: IWireTurnItem): boolean {
  return (item.type === "user_message" && !isSteer(item)) || item.type === "notification";
}

const NO_WORK = {
  InProgress: false,
  ToolLike: false,
  Failed: false,
  Success: false,
  Activity: false,
  Visible: false,
  VisibleLive: false,
  Standalone: false,
  Compaction: false,
  QuestionAnswer: false,
  Thought: false,
  FailedRun: null,
} as const;

/** A row's facts, or null for a row the timeline doesn't show (a waiting approval, an empty checkpoint). */
export function entryFacts(item: IWireTurnItem): IEntryFacts | null {
  if (
    turnItemIsWorkspacePreparation(item as unknown as OrchestrationV2TurnItem) &&
    !("deferredWork" in item && item.deferredWork !== undefined)
  )
    return null;
  const at = item.startedAt ?? item.updatedAt;
  const base = {
    Id: item.id,
    Type: item.type,
    RunId: item.runId,
    At: at,
    End: at,
    Streaming: false,
    Persistent: PERSISTENT_TYPES.has(item.type),
    LiveSubagent: item.type === "subagent" && isOrchestrationV2WorkActive(item.status),
    ...NO_WORK,
  };
  switch (item.type) {
    case "user_message":
      return { ...base, Kind: isSteer(item) ? "steer" : "user" };
    case "assistant_message":
      return {
        ...base,
        Kind: "assistant",
        Streaming: item.streaming,
        End: item.streaming ? at : item.updatedAt,
      };
    case "proposed_plan":
      return { ...base, Kind: "plan" };
    case "checkpoint":
      return (item.filesTotal?.count ?? item.files.length) === 0
        ? null
        : { ...base, Kind: "checkpoint" };
    case "approval_request":
      if (item.status === "waiting") return null;
      break;
    case "dynamic_tool":
      if (item.status === "completed" && sentMessageFromToolItem(item) !== undefined)
        return { ...base, Kind: "sent" };
      break;
    default:
      if (STANDALONE_EVENTS.has(item.type)) return { ...base, Kind: "event" };
  }
  const entry = workLogEntry(item);
  const failedError = item.type === "error" && item.status === "failed";
  return {
    ...base,
    Kind: "work",
    InProgress: entry.toolLifecycleStatus === "inProgress",
    ToolLike: workLogEntryIsToolLike(entry),
    Failed: workEntryDisplayIndicatesToolFailure(entry),
    Success: workEntryIndicatesToolSuccess(entry),
    Activity: workEntryIsActiveTurnActivity(entry),
    Visible: workEntryIsVisibleInGroup(entry, false),
    VisibleLive: workEntryIsVisibleInGroup(entry, true),
    Standalone:
      failedError ||
      entry.sourceActivityKind === "runtime.error" ||
      item.type === "system_notice" ||
      item.type === "notification" ||
      item.type === "todo_list" ||
      entry.questionAnswer !== undefined,
    Compaction: entry.sourceActivityKind === "context-compaction",
    QuestionAnswer: entry.questionAnswer !== undefined,
    Thought: item.type === "reasoning" && item.text.trim() !== "",
    FailedRun:
      failedError && item.parentItemId === null
        ? item.failure.class === "usage_limit"
          ? "usage_limit"
          : "other"
        : null,
  };
}

export function sameFacts(left: IEntryFacts | null, right: IEntryFacts | null): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  for (const key of Object.keys(left) as Array<keyof IEntryFacts>) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

export interface ILatestRun {
  Id: string;
  Status: string;
  StartedAt: string | null;
  CompletedAt: string | null;
}

export interface IResponseInput {
  Entries: ReadonlyArray<IEntryFacts>;
  /** The thread's last response, the only one a running turn can be in. */
  Latest: boolean;
  LatestRun: ILatestRun | null;
  Working: boolean;
  PendingApproval: boolean;
  Expanded: (key: string) => boolean;
}

export type ILayoutRow =
  | { Kind: "item"; Key: string; Id: string; Meta: boolean }
  | { Kind: "single"; Key: string; Id: string }
  | { Kind: "group"; Key: string; Ids: string[]; Expanded: boolean; At: string }
  | { Kind: "fold"; Key: string; Label: string; Expanded: boolean; At: string }
  | {
      Kind: "live";
      Key: string;
      GroupKey: string;
      Id: string;
      Ids: string[];
      Expanded: boolean;
      Active: boolean;
      ThoughtId: string | null;
    }
  | { Kind: "working"; Key: string }
  | { Kind: "thinking"; Key: string; GroupKey: string | null; Ids: string[]; Expanded: boolean }
  | { Kind: "meta"; Key: string; Id: string };

export const groupKey = (anchorId: string) => `group:${anchorId}`;

function elapsedMs(start: string, end: string): number | null {
  const from = Date.parse(start);
  const to = Date.parse(end);
  return Number.isFinite(from) && Number.isFinite(to) ? Math.max(0, to - from) : null;
}

function later(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

const ACTIVE_RUN = new Set(["running", "starting", "waiting"]);

// After a send the previous turn stays active until the server creates its replacement.
function unsettledRunId(run: ILatestRun | null): string | null {
  if (run === null) return null;
  return run.CompletedAt !== null && !ACTIVE_RUN.has(run.Status) ? null : run.Id;
}

interface IFold {
  RunId: string;
  Key: string;
  Label: string;
  At: string;
  Hidden: Set<string>;
}

interface ITurnGroup {
  Entries: IEntryFacts[];
  Terminal: IEntryFacts | null;
  Streaming: boolean;
  Start: string | null;
  AnchorId: string;
  Steers: Array<{ Index: number; Steer: IEntryFacts }>;
}

function foldRunId(entry: IEntryFacts, runlessKey: string | null): string | null {
  if (entry.Kind === "work")
    return entry.Type === "system_notice" ? null : (entry.RunId ?? runlessKey);
  if (entry.Kind === "assistant") return entry.RunId ?? runlessKey;
  if (entry.Kind === "event" && (entry.Persistent || entry.Type === "subagent"))
    return entry.RunId ?? runlessKey;
  return null;
}

// Children can outlive their launching turn, so a batch with a live child stays in view.
function liveSubagentIds(entries: ReadonlyArray<IEntryFacts>): Set<string> {
  const visible = new Set<string>();
  let batch: IEntryFacts[] = [];
  const flush = () => {
    if (batch.some((entry) => entry.LiveSubagent)) for (const entry of batch) visible.add(entry.Id);
    batch = [];
  };
  for (const entry of entries) {
    if (entry.Type !== "subagent") {
      flush();
      continue;
    }
    if (batch.length > 0 && batch.at(-1)!.RunId !== entry.RunId) flush();
    batch.push(entry);
  }
  flush();
  return visible;
}

// Follows deriveTurnFolds in apps/web/src/components/chat/MessagesTimeline.logic.ts.
function turnFolds(
  input: IResponseInput,
  entries: ReadonlyArray<IEntryFacts>,
  unfolded: ReadonlySet<string>,
): Map<string, IFold> {
  const interrupted = new Set<string>();
  for (const entry of entries) {
    if (
      entry.RunId !== null &&
      (entry.Type === "run_interrupt_request" || entry.Type === "run_interrupt_result")
    )
      interrupted.add(entry.RunId);
  }
  const terminalIds = new Set<string>();
  const lastAssistant = new Map<string, string>();
  let unkeyed = 0;
  for (const entry of entries) {
    if (entry.Kind === "user") unkeyed += 1;
    else if (entry.Kind === "assistant")
      lastAssistant.set(entry.RunId ?? `unkeyed:${unkeyed}`, entry.Id);
  }
  for (const id of lastAssistant.values()) terminalIds.add(id);
  const live = liveSubagentIds(entries);

  const groups = new Map<string, ITurnGroup>();
  const runlessFailed = new Set<string>();
  let runlessKey: string | null = null;
  let responseKey: string | null = null;
  let boundary: { At: string; AnchorId: string } | null = null;
  for (const [index, entry] of entries.entries()) {
    if (entry.Kind === "user" || entry.Type === "notification") {
      const next = entries[index + 1];
      boundary = next === undefined ? null : { At: entry.At, AnchorId: next.Id };
      runlessKey = entry.RunId === null ? `runless:${entry.Id}` : null;
      responseKey = entry.RunId ?? runlessKey;
      continue;
    }
    if (entry.Kind === "steer") {
      const group = groups.get(entry.RunId ?? responseKey ?? "");
      if (group !== undefined && group.Entries.length > 0) {
        if (group.Steers.at(-1)?.Index === group.Entries.length) group.Steers.pop();
        group.Steers.push({ Index: group.Entries.length, Steer: entry });
      }
      continue;
    }
    const runId = foldRunId(entry, runlessKey);
    if (runId === null) continue;
    if (runId === runlessKey && entry.FailedRun !== null) runlessFailed.add(runId);
    let group = groups.get(runId);
    if (group === undefined) {
      group = {
        Entries: [],
        Terminal: null,
        Streaming: false,
        Start: boundary?.At ?? null,
        AnchorId: boundary?.AnchorId ?? entry.Id,
        Steers: [],
      };
      boundary = null;
      groups.set(runId, group);
    }
    group.Entries.push(entry);
    if (entry.Kind === "assistant") {
      if (terminalIds.has(entry.Id)) group.Terminal = entry;
      if (entry.Streaming) group.Streaming = true;
    }
  }

  const folds = new Map<string, IFold>();
  for (const [runId, group] of groups) {
    if (unfolded.has(runId) || interrupted.has(runId) || runlessFailed.has(runId)) continue;
    if (group.Streaming) continue;
    const hidden = new Set<string>();
    const terminalIndex = group.Terminal
      ? group.Entries.indexOf(group.Terminal)
      : group.Entries.length;
    // Folded dividers lose their place in the turn, so only the latest stays visible.
    const visibleCompaction = group.Entries.findLast((entry) => entry.Compaction)?.Id;
    for (const [index, entry] of group.Entries.entries()) {
      if (entry === group.Terminal) continue;
      const foldableTrailing = entry.Kind === "work" && !entry.InProgress && !entry.Failed;
      if (!entry.Compaction && index > terminalIndex && !foldableTrailing) continue;
      if (entry.Id === visibleCompaction || entry.Persistent || live.has(entry.Id)) continue;
      if (entry.Type === "notification" || entry.QuestionAnswer) continue;
      hidden.add(entry.Id);
    }
    const hidesWork = (segment: ReadonlyArray<IEntryFacts>) =>
      segment.some((entry) => hidden.has(entry.Id) && !entry.Compaction);
    if (!hidesWork(group.Entries)) continue;
    const first = group.Entries[0]!;
    const last = group.Entries.at(-1)!;
    const run = input.LatestRun?.Id === runId ? input.LatestRun : null;
    const elapsed =
      run?.StartedAt != null && run.CompletedAt != null
        ? elapsedMs(run.StartedAt, run.CompletedAt)
        : elapsedMs(group.Start ?? first.At, later(group.Terminal?.End ?? null, last.End)!);
    const duration = elapsed === null ? null : formatDuration(elapsed);
    const label =
      run?.Status === "interrupted"
        ? duration
          ? `You stopped after ${duration}`
          : "You stopped this response"
        : duration
          ? `Worked for ${duration}`
          : "Worked";
    const segmentHidden = (segment: ReadonlyArray<IEntryFacts>) =>
      new Set(segment.flatMap((entry) => (hidden.has(entry.Id) ? [entry.Id] : [])));
    const firstSegment = group.Entries.slice(0, group.Steers[0]?.Index);
    folds.set(group.AnchorId, {
      RunId: runId,
      Key: `fold:${runId}`,
      Label: label,
      At: group.Start ?? first.At,
      Hidden: segmentHidden(firstSegment),
    });
    for (const [index, { Index, Steer }] of group.Steers.entries()) {
      const segment = group.Entries.slice(Index, group.Steers[index + 1]?.Index);
      const anchor = segment[0];
      if (anchor === undefined || !hidesWork(segment)) continue;
      const ms = elapsedMs(
        Steer.At,
        segment.map((entry) => entry.End).reduce<string | null>(later, null) ?? Steer.At,
      );
      folds.set(anchor.Id, {
        RunId: runId,
        Key: `fold:${runId}:steer:${Steer.Id}`,
        Label: ms === null ? "Continued" : `Continued for ${formatDuration(ms)}`,
        At: Steer.At,
        Hidden: segmentHidden(segment),
      });
    }
  }
  return folds;
}

const breaksGroup = (entry: IEntryFacts) => entry.Standalone || entry.Compaction;

// Follows deriveMessagesTimelineRows in apps/web/src/components/chat/MessagesTimeline.logic.ts,
// for one response rather than the whole thread, so a delta costs the same at any thread length.
export function layoutResponse(input: IResponseInput): ILayoutRow[] {
  const latestIndex = input.Latest ? input.Entries.length - 1 : -1;
  // A reasoning row that something followed has ended, whatever its status says.
  const entries = input.Entries.map((entry, index) =>
    entry.Type === "reasoning" && entry.InProgress && index !== latestIndex
      ? { ...entry, InProgress: false, Activity: false, Success: true }
      : entry,
  );
  const working = input.Working && input.Latest;
  const unsettled = unsettledRunId(input.LatestRun);
  const failed = new Set<string>();
  if (input.LatestRun?.Status === "failed") failed.add(input.LatestRun.Id);
  const usageLimited = new Set<string>();
  const otherFailures = new Set<string>();
  for (const entry of entries) {
    if (entry.FailedRun === null || entry.RunId === null) continue;
    failed.add(entry.RunId);
    (entry.FailedRun === "usage_limit" ? usageLimited : otherFailures).add(entry.RunId);
  }
  const itemized = new Set(
    [...failed].filter((runId) => !usageLimited.has(runId) || otherFailures.has(runId)),
  );
  const active = new Set<string>();
  if (unsettled !== null) active.add(unsettled);
  if (working) for (const entry of entries) if (entry.RunId !== null) active.add(entry.RunId);
  const folds = turnFolds(input, entries, new Set([...active, ...failed]));
  const collapsed = new Set<string>();
  for (const fold of folds.values()) {
    if (!input.Expanded(fold.Key)) for (const id of fold.Hidden) collapsed.add(id);
  }
  const inActiveRun = (entry: IEntryFacts) =>
    working && entry.InProgress && entry.RunId !== null && entry.RunId === unsettled;
  const first = entries[0];
  const headerIndex =
    first !== undefined && (first.Kind === "user" || first.Type === "notification") ? 1 : 0;

  const tail: IEntryFacts[] = [];
  if (working && unsettled !== null) {
    for (let index = entries.length - 1; index >= headerIndex; index -= 1) {
      const entry = entries[index]!;
      if (
        entry.Kind !== "work" ||
        entry.Standalone ||
        entry.Compaction ||
        entry.RunId === null ||
        !active.has(entry.RunId) ||
        collapsed.has(entry.Id) ||
        folds.has(entry.Id)
      )
        break;
      tail.push(entry);
    }
  }
  tail.reverse();
  const visibleTail = tail.filter((entry) => entry.VisibleLive);
  const latestVisible = visibleTail.at(-1);
  const latestRunning = visibleTail.findLast((entry) => entry.Activity);
  const keepsLive =
    latestRunning !== undefined ||
    (latestVisible !== undefined && latestVisible.Success && !input.PendingApproval);
  const latestFailed =
    latestRunning === undefined && latestVisible !== undefined && latestVisible.Failed;
  const tailAnchor = tail[0];
  const liveRow: Extract<ILayoutRow, { Kind: "live" }> | null =
    tailAnchor !== undefined && latestVisible !== undefined && !latestFailed
      ? {
          Kind: "live",
          Key: keepsLive ? "live" : `live:${tailAnchor.Id}`,
          GroupKey: groupKey(tailAnchor.Id),
          Id: (latestRunning ?? latestVisible).Id,
          Ids: visibleTail.map((entry) => entry.Id),
          Expanded: input.Expanded(groupKey(tailAnchor.Id)),
          Active: keepsLive,
          ThoughtId: visibleTail.findLast((entry) => entry.Thought)?.Id ?? null,
        }
      : null;
  const tailIds = new Set(liveRow !== null || latestFailed ? tail.map((entry) => entry.Id) : []);

  const rows: ILayoutRow[] = [];
  const rowRuns: IRowRun[] = [];
  const push = (row: ILayoutRow, runId: string | null = null, trail: ITrail = "other") => {
    rows.push(row);
    rowRuns.push({ RunId: runId, Trail: trail });
  };
  let hasWorking = false;
  let hasActivity = false;
  const pushWorking = () => {
    hasWorking = true;
    push({ Kind: "working", Key: "working" });
  };

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (working && index === headerIndex) pushWorking();
    if (liveRow !== null && entry.Id === latestVisible?.Id) {
      push(liveRow);
      hasActivity ||= liveRow.Active;
    }
    if (entry.Type === "run_interrupt_request") continue;
    const fold = folds.get(entry.Id);
    if (fold !== undefined) {
      push({
        Kind: "fold",
        Key: fold.Key,
        Label: fold.Label,
        Expanded: input.Expanded(fold.Key),
        At: fold.At,
      });
    }
    if (collapsed.has(entry.Id) || tailIds.has(entry.Id)) continue;

    if (entry.Kind !== "work") {
      const meta =
        entry.Kind === "assistant" &&
        !(entry.RunId === null ? false : active.has(entry.RunId)) &&
        isTerminal(entries, index);
      const trail: ITrail =
        entry.Kind === "checkpoint"
          ? "trailing"
          : entry.Kind === "user" || entry.Kind === "steer" || entry.Kind === "assistant"
            ? "message"
            : "other";
      push({ Kind: "item", Key: entry.Id, Id: entry.Id, Meta: meta }, entry.RunId, trail);
      continue;
    }
    if (
      entry.Compaction ||
      entry.Standalone ||
      (entry.RunId !== null && itemized.has(entry.RunId))
    ) {
      const tool = entry.ToolLike || (entry.Type === "error" && entry.Failed);
      push(
        { Kind: "item", Key: entry.Id, Id: entry.Id, Meta: false },
        entry.RunId,
        tool ? "tool" : "work",
      );
      continue;
    }
    const grouped = [entry];
    let cursor = index + 1;
    while (cursor < entries.length) {
      const next = entries[cursor]!;
      if (
        next.Kind !== "work" ||
        breaksGroup(next) ||
        tailIds.has(next.Id) ||
        collapsed.has(next.Id) ||
        folds.has(next.Id) ||
        next.RunId !== entry.RunId
      )
        break;
      grouped.push(next);
      cursor += 1;
    }
    index = cursor - 1;
    const visible = grouped.filter((held) => (inActiveRun(held) ? held.VisibleLive : held.Visible));
    if (visible.length === 0) continue;
    const running = visible.filter(inActiveRun);
    const key = groupKey(entry.Id);
    if (running.length > 0) {
      push({
        Kind: "live",
        Key: `live:${entry.Id}`,
        GroupKey: key,
        Id: running.at(-1)!.Id,
        Ids: visible.map((held) => held.Id),
        Expanded: input.Expanded(key),
        Active: true,
        ThoughtId: null,
      });
      hasActivity = true;
    } else if (visible.length === 1 && visible[0]!.ToolLike) {
      push({ Kind: "single", Key: entry.Id, Id: visible[0]!.Id }, entry.RunId, "tool");
    } else {
      push(
        {
          Kind: "group",
          Key: key,
          Ids: visible.map((held) => held.Id),
          Expanded: input.Expanded(key),
          At: entry.At,
        },
        entry.RunId,
        "trailing",
      );
    }
  }

  if (working && !hasWorking && headerIndex >= entries.length) pushWorking();
  if (working && (latestFailed || (!hasActivity && !input.PendingApproval))) {
    const failedKey = latestFailed && tailAnchor !== undefined ? groupKey(tailAnchor.Id) : null;
    push({
      Kind: "thinking",
      Key: "thinking",
      GroupKey: failedKey,
      Ids: failedKey === null ? [] : visibleTail.map((entry) => entry.Id),
      Expanded: failedKey !== null && input.Expanded(failedKey),
    });
  }
  return placeMeta(rows, rowRuns);
}

function isTerminal(entries: ReadonlyArray<IEntryFacts>, index: number): boolean {
  const entry = entries[index]!;
  for (let next = index + 1; next < entries.length; next += 1) {
    const later = entries[next]!;
    if (later.Kind === "assistant" && later.RunId === entry.RunId) return false;
  }
  return true;
}

/**
 * How a row counts when a reply's actions look for the work after it: a message ends the search, a
 * summary or a changed files card is trailing work, and a single work row is when it's a tool.
 */
type ITrail = "message" | "trailing" | "work" | "tool" | "other";

interface IRowRun {
  RunId: string | null;
  Trail: ITrail;
}

// Follows attachTrailingToolGroupsToAssistant: a reply's copy and time move below the tool work
// that followed it in its run. A changed files card counts as that work here, because stock draws
// the card inside the reply, above its actions.
function placeMeta(rows: ILayoutRow[], runs: ReadonlyArray<IRowRun>): ILayoutRow[] {
  const after = new Map<number, ILayoutRow>();
  const moved = new Set<number>();
  for (const [index, row] of rows.entries()) {
    const runId = runs[index]!.RunId;
    if (row.Kind !== "item" || !row.Meta || runId === null) continue;
    let last = -1;
    let trailing = false;
    for (let next = index + 1; next < rows.length; next += 1) {
      const { RunId, Trail } = runs[next]!;
      if (Trail === "message") break;
      if (RunId !== runId || Trail === "other") continue;
      if (Trail !== "work") trailing = true;
      if (trailing) last = next;
    }
    if (last < 0) continue;
    moved.add(index);
    after.set(last, { Kind: "meta", Key: `meta:${row.Id}`, Id: row.Id });
  }
  const result: ILayoutRow[] = [];
  for (const [index, row] of rows.entries()) {
    result.push(moved.has(index) && row.Kind === "item" ? { ...row, Meta: false } : row);
    const meta = after.get(index);
    if (meta !== undefined) result.push(meta);
  }
  return result;
}

export interface IResponseSegments {
  Ids: readonly string[];
  Starts: string[];
  Segments: Record<string, string[]>;
}

/**
 * Splits rows into responses, each keyed by its first id. When the rows only grew past the last
 * response's start, the earlier responses keep their arrays and only the last is split again.
 */
export function segmentResponses(
  previous: IResponseSegments | undefined,
  ids: readonly string[],
  starts: (id: string) => boolean,
): IResponseSegments {
  let from = 0;
  const kept: string[] = [];
  const segments: Record<string, string[]> = {};
  const lastStart = previous?.Starts.at(-1);
  if (previous !== undefined && lastStart !== undefined) {
    const lastIndex = previous.Ids.length - previous.Segments[lastStart]!.length;
    let shared = lastIndex <= ids.length;
    for (let index = 0; shared && index <= lastIndex && index < previous.Ids.length; index += 1) {
      if (previous.Ids[index] !== ids[index]) shared = false;
    }
    if (shared) {
      for (const start of previous.Starts.slice(0, -1)) {
        kept.push(start);
        segments[start] = previous.Segments[start]!;
      }
      from = lastIndex;
    }
  }
  let current: string[] | null = null;
  for (let index = from; index < ids.length; index += 1) {
    const id = ids[index]!;
    if (current === null || starts(id)) {
      current = [];
      kept.push(id);
      segments[id] = current;
    }
    current.push(id);
  }
  return { Ids: ids, Starts: kept, Segments: segments };
}
