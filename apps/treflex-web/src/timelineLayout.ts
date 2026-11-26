import {
  workEntryDisplayIndicatesToolFailure,
  workEntryHiddenByToolCallVisibility,
} from "@t3tools/client-runtime/work-log/presentation";
import { turnItemIsWorkspacePreparation } from "@t3tools/client-runtime/state/turn-item-presentation";
import { isOrchestrationV2WorkActive, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import type { ToolCallVisibility } from "@t3tools/contracts/settings";
import { claudeResumeCompactionAge } from "@t3tools/shared/claudeCompaction";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { sentMessageFromToolItem } from "@t3tools/shared/toolOutput";

import { isCompactPrompt } from "./compaction";
import { embedOf } from "./embeds";
import type { IWireTurnItem } from "./Infrastructure/wire";
import type { IOpenThread } from "./OpenThread";
import { workEntryIsVisibleInGroup, workLogEntryIsToolLike, workLogEntry } from "./workLog";

/**
 * What the layout needs to know about one row, kept to fields that settle, so a streaming text
 * delta leaves it equal and the response isn't laid out again.
 */
export interface IEntryFacts {
  Id: string;
  /** An `embed` is a page or app shown inline, which a fold never hides, as stock's never are. */
  Kind:
    | "user"
    | "steer"
    | "assistant"
    | "sent"
    | "embed"
    | "plan"
    | "event"
    | "checkpoint"
    | "work";
  Type: IWireTurnItem["type"];
  RunId: string | null;
  At: string;
  End: string;
  Streaming: boolean;
  InProgress: boolean;
  ToolLike: boolean;
  Failed: boolean;
  Visible: boolean;
  VisibleLive: boolean;
  Standalone: boolean;
  Compaction: boolean;
  QuestionAnswer: boolean;
  FailedRun: "usage_limit" | "other" | null;
  Persistent: boolean;
  LiveSubagent: boolean;
  /** A subagent's provider turn, which with its run decides the subagents it groups with. */
  Turn: string | null;
  /** A tool call the Tool calls in chat setting can hide, and whether it succeeded. */
  Hideable: "succeeded" | "other" | null;
  /** Work zen still shows: an error, a compaction, a notification or a question's answer. */
  Essential: boolean;
  /** The idle time a "compact before continuing?" answer to compact names. */
  ResumeAge: string | null;
  AttemptId: string | null;
  Superseded: boolean;
  /**
   * A reply that shows its attempt answered: a final answer, or, in a superseded attempt, one
   * that completed before the steer did.
   */
  Answer: "final" | "early" | null;
}

export interface IAttempt {
  Id: string;
  Status: string;
  CompletedAt: string | null;
}

export type IAttemptsByRoot = ReadonlyMap<string, IAttempt & { RunId: string }>;

export function attemptsByRoot(open: Pick<IOpenThread, "Attempts">): IAttemptsByRoot {
  return new Map(
    Object.values(open.Attempts).map((attempt) => [
      attempt.rootNodeId,
      {
        Id: attempt.id,
        RunId: attempt.runId,
        Status: attempt.status,
        CompletedAt: attempt.completedAt ?? null,
      },
    ]),
  );
}

/** Follows resolveAttempt in deriveTimelineEntriesFromVisibleTurnItems, apps/web/src/session-logic.ts. */
export function attemptOf(
  open: Pick<IOpenThread, "Nodes">,
  byRoot: IAttemptsByRoot,
  item: IWireTurnItem,
): IAttempt | null {
  if (item.nodeId === null || item.runId === null) return null;
  const ofRun = (nodeId: string) => {
    const attempt = byRoot.get(nodeId);
    return attempt?.RunId === item.runId ? attempt : undefined;
  };
  const visited = new Set<string>();
  let nodeId: string | null = item.nodeId;
  while (nodeId !== null && !visited.has(nodeId)) {
    visited.add(nodeId);
    const node: IOpenThread["Nodes"][string] | undefined = open.Nodes[nodeId];
    const attempt = ofRun(nodeId) ?? (node === undefined ? undefined : ofRun(node.rootNodeId));
    if (attempt !== undefined)
      return { Id: attempt.Id, Status: attempt.Status, CompletedAt: attempt.CompletedAt };
    if (node === undefined) return null;
    nodeId = node.parentNodeId;
  }
  return null;
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
  Visible: false,
  VisibleLive: false,
  Standalone: false,
  Compaction: false,
  QuestionAnswer: false,
  FailedRun: null,
  Hideable: null,
  Essential: false,
  ResumeAge: null,
  Answer: null,
} as const;

// Follows retainedAssistantReplyEntryIds in MessagesTimeline.logic.ts: only an explicit final
// phase, or a reply completed before the steer superseded its attempt, proves it answered.
function answerOf(
  item: Extract<IWireTurnItem, { type: "assistant_message" }>,
  attempt: IAttempt | null,
): IEntryFacts["Answer"] {
  if (item.phase === "final_answer") return "final";
  return attempt?.Status === "superseded" &&
    attempt.CompletedAt !== null &&
    !item.streaming &&
    item.phase === undefined &&
    item.status === "completed" &&
    item.completedAt !== null &&
    Date.parse(item.completedAt) < Date.parse(attempt.CompletedAt)
    ? "early"
    : null;
}

/**
 * A row's facts, or null for a row the timeline doesn't show (a waiting approval, a checkpoint
 * with no changed files of its own and `changedRepositories` false).
 */
export function entryFacts(
  item: IWireTurnItem,
  attempt: IAttempt | null = null,
  changedRepositories = false,
): IEntryFacts | null {
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
    Turn: item.type === "subagent" ? item.providerTurnId : null,
    AttemptId: attempt?.Id ?? null,
    Superseded: attempt?.Status === "superseded",
    ...NO_WORK,
  };
  switch (item.type) {
    case "user_message":
      return { ...base, Kind: isSteer(item) ? "steer" : "user", Compaction: isCompactPrompt(item) };
    case "assistant_message":
      return {
        ...base,
        Kind: "assistant",
        Streaming: item.streaming,
        End: item.streaming ? at : item.updatedAt,
        Answer: answerOf(item, attempt),
      };
    case "proposed_plan":
      return { ...base, Kind: "plan" };
    case "checkpoint":
      return (item.filesTotal?.count ?? item.files.length) === 0 && !changedRepositories
        ? null
        : { ...base, Kind: "checkpoint" };
    case "approval_request":
      if (item.status === "waiting") return null;
      break;
    case "dynamic_tool":
      if (item.status === "completed" && sentMessageFromToolItem(item) !== undefined)
        return { ...base, Kind: "sent" };
      if (embedOf(item) !== null) return { ...base, Kind: "embed" };
      break;
    default:
      if (STANDALONE_EVENTS.has(item.type)) return { ...base, Kind: "event" };
  }
  const entry = workLogEntry(item);
  const failedError = item.type === "error" && item.status === "failed";
  const compaction = entry.sourceActivityKind === "context-compaction";
  return {
    ...base,
    Kind: "work",
    InProgress: entry.toolLifecycleStatus === "inProgress",
    ToolLike: workLogEntryIsToolLike(entry),
    Failed: workEntryDisplayIndicatesToolFailure(entry),
    Hideable: !workEntryHiddenByToolCallVisibility(entry, "hideAll")
      ? null
      : workEntryHiddenByToolCallVisibility(entry, "hideSuccessful")
        ? "succeeded"
        : "other",
    // Follows workShownAsFinalAnswerOnly in MessagesTimeline.logic.ts.
    Essential:
      entry.questionAnswer !== undefined ||
      compaction ||
      item.type === "notification" ||
      entry.tone === "error" ||
      entry.sourceActivityKind === "runtime.error" ||
      (item.type === "error" && entry.toolLifecycleStatus !== "completed"),
    ResumeAge:
      entry.questionAnswer === undefined ? null : claudeResumeCompactionAge(entry.questionAnswer),
    Visible: workEntryIsVisibleInGroup(entry, false),
    VisibleLive: workEntryIsVisibleInGroup(entry, true),
    Standalone:
      failedError ||
      entry.sourceActivityKind === "runtime.error" ||
      item.type === "system_notice" ||
      item.type === "notification" ||
      item.type === "todo_list" ||
      entry.questionAnswer !== undefined,
    Compaction: compaction,
    QuestionAnswer: entry.questionAnswer !== undefined,
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
  /** The run still counts as active, but its provider turn has ended, as when it waits on subagents. */
  TurnEnded: boolean;
}

export interface IResponseInput {
  Entries: ReadonlyArray<IEntryFacts>;
  /** The thread's last response, the only one a running turn can be in. */
  Latest: boolean;
  LatestRun: ILatestRun | null;
  Working: boolean;
  Expanded: (key: string) => boolean;
  Visibility: ToolCallVisibility;
}

export type ILayoutRow =
  /** `Files` is the id of the run's checkpoint, whose changed files a reply shows below its text. */
  | { Kind: "item"; Key: string; Id: string; Meta: boolean; Files?: string }
  | { Kind: "single"; Key: string; Id: string }
  | { Kind: "group"; Key: string; Ids: string[]; Expanded: boolean; At: string }
  | { Kind: "subagents"; Key: string; Ids: string[]; Expanded: boolean }
  | {
      Kind: "fold";
      Key: string;
      Label: string;
      Expanded: boolean;
      At: string;
      /** The run is still working, so the view times it live. */
      Running: boolean;
    }
  | { Kind: "meta"; Key: string; Id: string }
  | { Kind: "attempt"; Key: string; Expanded: boolean }
  | { Kind: "compaction"; Key: string; Id: string; Age: string | null }
  /** A bare `/compact` prompt before its compaction arrives, `Pending` while its turn runs. */
  | { Kind: "compacting"; Key: string; Id: string; Pending: boolean };

export const groupKey = (anchorId: string) => `group:${anchorId}`;

const subagentsKey = (firstId: string) => `subagents:${firstId}`;

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
  Running: boolean;
  Hidden: Set<string>;
}

const foldKey = (runId: string) => `fold:${runId}`;

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

// Follows deriveTurnFolds in apps/web/src/components/chat/MessagesTimeline.logic.ts, except that a
// running run folds as it will once settled, so settling changes only the fold's label.
function turnFolds(
  input: IResponseInput,
  entries: ReadonlyArray<IEntryFacts>,
  unfolded: ReadonlySet<string>,
  running: ReadonlySet<string>,
  retained: ReadonlySet<string>,
): Map<string, IFold> {
  const interrupted = new Set<string>();
  for (const entry of entries) {
    if (
      entry.RunId !== null &&
      (entry.Type === "run_interrupt_request" || entry.Type === "run_interrupt_result")
    )
      interrupted.add(entry.RunId);
  }
  const terminalIds = terminalAssistantIds(entries);
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
    const isRunning = running.has(runId);
    if (group.Streaming && !isRunning) continue;
    const hidden = new Set<string>();
    const terminalIndex = group.Terminal
      ? group.Entries.indexOf(group.Terminal)
      : group.Entries.length;
    // Folded dividers lose their place in the turn, so only the latest stays visible.
    const visibleCompaction = group.Entries.findLast((entry) => entry.Compaction)?.Id;
    // Unlike stock, each steer's segment keeps its last reply, so a reply after a steer doesn't
    // hide the one above the steer and pull the steer up.
    const segmentReplies = new Set<IEntryFacts>();
    for (const [index, { Index }] of group.Steers.entries()) {
      const before = group.Entries.slice(group.Steers[index - 1]?.Index ?? 0, Index);
      const reply = before.findLast((entry) => entry.Kind === "assistant");
      if (reply !== undefined) segmentReplies.add(reply);
    }
    for (const [index, entry] of group.Entries.entries()) {
      if (entry === group.Terminal || segmentReplies.has(entry)) continue;
      const foldableTrailing =
        entry.Kind === "work" && (isRunning || (!entry.InProgress && !entry.Failed));
      if (!entry.Compaction && index > terminalIndex && !foldableTrailing) continue;
      if (
        entry.Id === visibleCompaction ||
        entry.Persistent ||
        live.has(entry.Id) ||
        retained.has(entry.Id)
      )
        continue;
      if (entry.Type === "notification" || entry.QuestionAnswer) continue;
      hidden.add(entry.Id);
    }
    const hidesWork = (segment: ReadonlyArray<IEntryFacts>) =>
      segment.some((entry) => hidden.has(entry.Id) && !entry.Compaction);
    if (!isRunning && !hidesWork(group.Entries)) continue;
    const first = group.Entries[0]!;
    // A subagent card after the terminal entry was spawned by background work once the turn
    // settled, so it adds no turn time.
    const late = new Set(
      group.Entries.filter((entry, index) => index > terminalIndex && entry.Type === "subagent"),
    );
    const last = group.Entries.findLast((entry) => !late.has(entry)) ?? group.Entries.at(-1)!;
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
      Key: foldKey(runId),
      Label: isRunning ? "Working" : label,
      At: group.Start ?? first.At,
      Running: isRunning,
      Hidden: segmentHidden(firstSegment),
    });
    for (const [index, { Index, Steer }] of group.Steers.entries()) {
      const segment = group.Entries.slice(Index, group.Steers[index + 1]?.Index);
      const anchor = segment[0];
      if (anchor === undefined || !hidesWork(segment)) continue;
      const ms = elapsedMs(
        Steer.At,
        segment
          .filter((entry) => !late.has(entry))
          .map((entry) => entry.End)
          .reduce<string | null>(later, null) ?? Steer.At,
      );
      folds.set(anchor.Id, {
        RunId: runId,
        Key: `fold:${runId}:steer:${Steer.Id}`,
        Label: ms === null ? "Continued" : `Continued for ${formatDuration(ms)}`,
        At: Steer.At,
        Running: false,
        Hidden: segmentHidden(segment),
      });
    }
  }
  return folds;
}

function terminalAssistantIds(entries: ReadonlyArray<IEntryFacts>): Set<string> {
  const lastAssistant = new Map<string, string>();
  let unkeyed = 0;
  for (const entry of entries) {
    if (entry.Kind === "user") unkeyed += 1;
    else if (entry.Kind === "assistant")
      lastAssistant.set(entry.RunId ?? `unkeyed:${unkeyed}`, entry.Id);
  }
  return new Set(lastAssistant.values());
}

// Follows deriveInFlightSteerAnswerIds: the first reply after a steer, when another one follows it.
function steerAnswerIds(entries: ReadonlyArray<IEntryFacts>): Set<string> {
  const ids = new Set<string>();
  let awaitingReply = false;
  let candidate: string | null = null;
  for (const entry of entries) {
    if (entry.Type === "reasoning") continue;
    const reply = entry.Kind === "assistant";
    if (candidate !== null && reply) ids.add(candidate);
    candidate = null;
    if (entry.Kind === "steer") awaitingReply = true;
    else if (entry.Kind === "user") awaitingReply = false;
    else if (reply && awaitingReply) {
      candidate = entry.Id;
      awaitingReply = false;
    }
  }
  return ids;
}

// Follows retainedAssistantReplyEntryIds.
function retainedReplies(entries: ReadonlyArray<IEntryFacts>): Set<string> {
  const ids = new Set<string>();
  const lastOutput = new Map<string, IEntryFacts>();
  for (const entry of entries) {
    if (entry.Answer === "final") ids.add(entry.Id);
    if (
      !entry.Superseded ||
      entry.AttemptId === null ||
      (entry.Kind !== "assistant" && entry.Kind !== "work") ||
      entry.Type === "system_notice" ||
      entry.Type === "notification"
    )
      continue;
    lastOutput.set(entry.AttemptId, entry);
  }
  for (const entry of lastOutput.values()) if (entry.Answer === "early") ids.add(entry.Id);
  return ids;
}

interface IAttemptFold {
  Key: string;
  Hidden: Set<string>;
}

// Follows deriveSupersededAttemptFolds in MessagesTimeline.logic.ts.
function attemptFolds(
  entries: ReadonlyArray<IEntryFacts>,
  unfolded: ReadonlySet<string>,
  live: ReadonlySet<string>,
  retained: ReadonlySet<string>,
): Map<string, IAttemptFold> {
  const kept = new Set(
    entries.flatMap((entry) =>
      entry.AttemptId !== null && retained.has(entry.Id) ? [entry.AttemptId] : [],
    ),
  );
  const byAttempt = new Map<string, IEntryFacts[]>();
  for (const entry of entries) {
    if (
      !entry.Superseded ||
      entry.AttemptId === null ||
      kept.has(entry.AttemptId) ||
      (entry.RunId !== null && unfolded.has(entry.RunId)) ||
      entry.Kind === "user" ||
      entry.Kind === "steer" ||
      entry.Kind === "embed" ||
      entry.Kind === "sent" ||
      entry.Type === "handoff" ||
      entry.Type === "system_notice" ||
      entry.Persistent ||
      live.has(entry.Id)
    )
      continue;
    const held = byAttempt.get(entry.AttemptId) ?? [];
    held.push(entry);
    byAttempt.set(entry.AttemptId, held);
  }
  const folds = new Map<string, IAttemptFold>();
  for (const [attemptId, held] of byAttempt) {
    folds.set(held[0]!.Id, {
      Key: `attempt:${attemptId}`,
      Hidden: new Set(held.map((entry) => entry.Id)),
    });
  }
  return folds;
}

// Follows timelineRowEntries in MessagesTimeline.logic.ts.
function shownEntries(
  entries: ReadonlyArray<IEntryFacts>,
  visibility: ToolCallVisibility,
  answering: boolean,
): ReadonlyArray<IEntryFacts> {
  if (visibility === "showAll") return entries;
  if (visibility !== "zen")
    return entries.filter(
      (entry) =>
        entry.Hideable === null || (visibility === "hideSuccessful" && entry.Hideable === "other"),
    );
  const terminal = terminalAssistantIds(entries);
  const steerAnswers = steerAnswerIds(entries);
  const retained = retainedReplies(entries);
  return entries.filter((entry) => {
    switch (entry.Kind) {
      case "assistant":
        return (
          steerAnswers.has(entry.Id) ||
          retained.has(entry.Id) ||
          (terminal.has(entry.Id) && !answering)
        );
      case "event":
        return entry.Type !== "subagent";
      case "work":
        return entry.Essential;
      default:
        return true;
    }
  });
}

const breaksGroup = (entry: IEntryFacts) => entry.Standalone || entry.Compaction;

// Follows deriveMessagesTimelineRows in apps/web/src/components/chat/MessagesTimeline.logic.ts,
// for one response rather than the whole thread, so a delta costs the same at any thread length.
export function layoutResponse(input: IResponseInput): ILayoutRow[] {
  const working = input.Working && input.Latest;
  const zen = input.Visibility === "zen";
  const shown = shownEntries(
    input.Entries,
    input.Visibility,
    working && input.LatestRun?.TurnEnded !== true,
  );
  const latestIndex = input.Latest ? shown.length - 1 : -1;
  // A reasoning row that something followed has ended, whatever its status says.
  const entries = shown.map((entry, index) =>
    entry.Type === "reasoning" && entry.InProgress && index !== latestIndex
      ? { ...entry, InProgress: false }
      : entry,
  );
  const unsettled = unsettledRunId(input.LatestRun);
  const compactionRuns = new Set(
    entries.flatMap((entry) =>
      entry.Kind === "user" && entry.Compaction && entry.RunId !== null ? [entry.RunId] : [],
    ),
  );
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
  // A compaction's divider stands for its whole turn, so that turn gets no running fold.
  const running = new Set(
    working && unsettled !== null && !failed.has(unsettled) && !compactionRuns.has(unsettled)
      ? [unsettled]
      : [],
  );
  const unfolded = new Set([...active, ...failed].filter((runId) => !running.has(runId)));
  const retained = retainedReplies(entries);
  const folds = zen
    ? new Map<string, IFold>()
    : turnFolds(input, entries, unfolded, running, retained);
  const collapsed = new Set<string>();
  for (const fold of folds.values()) {
    if (!input.Expanded(fold.Key)) for (const id of fold.Hidden) collapsed.add(id);
  }
  const attempts = attemptFolds(entries, failed, liveSubagentIds(entries), retained);
  const collapsedAttempts = new Set<string>();
  for (const fold of attempts.values()) {
    if (!input.Expanded(fold.Key)) for (const id of fold.Hidden) collapsedAttempts.add(id);
  }
  const inActiveRun = (entry: IEntryFacts) =>
    entry.InProgress && entry.RunId !== null && running.has(entry.RunId);
  const first = entries[0];
  const headerIndex =
    first !== undefined && (first.Kind === "user" || first.Type === "notification") ? 1 : 0;
  // A running run's fold shows from its start, before it has any rows to hide.
  const pendingFold = zen
    ? undefined
    : [...running].find((runId) => ![...folds.values()].some((fold) => fold.RunId === runId));

  // Follows deriveMessagesTimelineRows: the compaction row stands in for a bare `/compact` prompt,
  // and for the answered "compact before continuing?" question that asked for it.
  const compactedRuns = new Set(
    entries.flatMap((entry) => (entry.Kind === "work" && entry.Compaction ? [entry.RunId] : [])),
  );
  const resumeAges = new Map<string, string>();
  const askedAge = new Map<string, string>();
  for (const entry of entries) {
    if (entry.Kind !== "work" || entry.RunId === null) continue;
    const age = askedAge.get(entry.RunId);
    if (entry.Compaction && age !== undefined) {
      resumeAges.set(entry.Id, age);
      askedAge.delete(entry.RunId);
    }
    if (entry.ResumeAge !== null) askedAge.set(entry.RunId, entry.ResumeAge);
  }
  // Follows turnDiffSummaryByAssistantMessageId: a run's changed files show on its last reply.
  const lastReplies = new Map<string, string>();
  for (const entry of entries) {
    if (entry.Kind === "assistant" && entry.RunId !== null) lastReplies.set(entry.RunId, entry.Id);
  }
  const replyCards = new Map<string, string>();
  for (const entry of entries) {
    if (entry.Kind !== "checkpoint" || entry.RunId === null) continue;
    const reply = lastReplies.get(entry.RunId);
    if (reply !== undefined) replyCards.set(reply, entry.Id);
  }
  const rows: ILayoutRow[] = [];
  const rowRuns: IRowRun[] = [];
  let subagents: {
    Index: number;
    Ids: string[];
    RunId: string | null;
    Turn: string | null;
  } | null = null;
  const push = (row: ILayoutRow, runId: string | null = null, trail: ITrail = "other") => {
    rows.push(row);
    rowRuns.push({ RunId: runId, Trail: trail });
  };
  const pushPendingFold = () => {
    if (pendingFold === undefined) return;
    const key = foldKey(pendingFold);
    push({
      Kind: "fold",
      Key: key,
      Label: "Working",
      Expanded: input.Expanded(key),
      At: first?.At ?? "",
      Running: true,
    });
  };

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (index === headerIndex) pushPendingFold();
    if (entry.Type === "run_interrupt_request") continue;
    // A stopped compaction's own divider already says it stopped.
    if (
      entry.Type === "run_interrupt_result" &&
      entry.RunId !== null &&
      compactionRuns.has(entry.RunId) &&
      compactedRuns.has(entry.RunId)
    )
      continue;
    const fold = folds.get(entry.Id);
    if (fold !== undefined) {
      push({
        Kind: "fold",
        Key: fold.Key,
        Label: fold.Label,
        Expanded: input.Expanded(fold.Key),
        At: fold.At,
        Running: fold.Running,
      });
    }
    if (collapsed.has(entry.Id)) continue;
    const attempt = attempts.get(entry.Id);
    if (attempt !== undefined)
      push(
        { Kind: "attempt", Key: attempt.Key, Expanded: input.Expanded(attempt.Key) },
        entry.RunId,
      );
    if (collapsedAttempts.has(entry.Id)) continue;
    if (entry.Kind === "user" && entry.Compaction) {
      if (compactedRuns.has(entry.RunId)) continue;
      if (entry.RunId !== null) {
        push(
          {
            Kind: "compacting",
            Key: `compaction:${entry.RunId}`,
            Id: entry.Id,
            Pending: working && entry.RunId === unsettled && !failed.has(entry.RunId),
          },
          entry.RunId,
        );
        continue;
      }
    }
    if (entry.ResumeAge !== null && entry.RunId !== null && compactedRuns.has(entry.RunId))
      continue;

    // Follows deriveMessagesTimelineRows: back-to-back subagents of one provider turn share a row.
    if (entry.Type === "subagent") {
      if (
        subagents !== null &&
        subagents.Index === rows.length - 1 &&
        subagents.RunId === entry.RunId &&
        subagents.Turn === entry.Turn
      ) {
        subagents.Ids.push(entry.Id);
        const key = subagentsKey(subagents.Ids[0]!);
        rows[subagents.Index] = {
          Kind: "subagents",
          Key: key,
          Ids: [...subagents.Ids],
          Expanded: input.Expanded(key),
        };
        continue;
      }
      push({ Kind: "item", Key: entry.Id, Id: entry.Id, Meta: false }, entry.RunId);
      subagents = { Index: rows.length - 1, Ids: [entry.Id], RunId: entry.RunId, Turn: entry.Turn };
      continue;
    }
    if (entry.Kind !== "work") {
      if (entry.Kind === "checkpoint" && entry.RunId !== null && lastReplies.has(entry.RunId))
        continue;
      const meta =
        entry.Kind === "assistant" &&
        !(entry.RunId === null ? false : active.has(entry.RunId)) &&
        isTerminal(entries, index);
      const trail: ITrail =
        entry.Kind === "user" || entry.Kind === "steer" || entry.Kind === "assistant"
          ? "message"
          : "other";
      const files = replyCards.get(entry.Id);
      push(
        {
          Kind: "item",
          Key: entry.Id,
          Id: entry.Id,
          Meta: meta,
          ...(files === undefined ? {} : { Files: files }),
        },
        entry.RunId,
        trail,
      );
      continue;
    }
    if (entry.Compaction) {
      push(
        { Kind: "compaction", Key: entry.Id, Id: entry.Id, Age: resumeAges.get(entry.Id) ?? null },
        entry.RunId,
        "work",
      );
      continue;
    }
    if (entry.Standalone || (entry.RunId !== null && itemized.has(entry.RunId))) {
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
        collapsed.has(next.Id) ||
        folds.has(next.Id) ||
        collapsedAttempts.has(next.Id) ||
        attempts.has(next.Id) ||
        next.RunId !== entry.RunId ||
        next.AttemptId !== entry.AttemptId
      )
        break;
      grouped.push(next);
      cursor += 1;
    }
    index = cursor - 1;
    const visible = grouped.filter((held) => (inActiveRun(held) ? held.VisibleLive : held.Visible));
    if (visible.length === 0) continue;
    const key = groupKey(entry.Id);
    if (visible.length === 1 && visible[0]!.ToolLike) {
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

  if (headerIndex >= entries.length) pushPendingFold();
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
 * summary is trailing work, and a single work row is when it's a tool.
 */
type ITrail = "message" | "trailing" | "work" | "tool" | "other";

interface IRowRun {
  RunId: string | null;
  Trail: ITrail;
}

// Follows attachTrailingToolGroupsToAssistant: a reply's copy and time move below the tool work
// that followed it in its run.
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
