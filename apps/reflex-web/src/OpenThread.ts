import { applyThreadPullRequestLinkUpdate } from "@t3tools/client-runtime/thread-pull-requests";
import {
  isQueuedProviderThreadPlaceholder,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import { restoreLocalVisibleTurnItems } from "@t3tools/shared/orchestrationV2BoundedSnapshot";
import {
  restoreSubagentBodies,
  restoreTurnItemBodies,
} from "@t3tools/shared/orchestrationV2DedupedBodies";
import { isOrchestrationV2TurnItemVisible } from "@t3tools/shared/orchestrationV2Timeline";
import {
  closeResource,
  entity,
  type IActionGenerator,
  type IEntity,
  type IReceiverId,
  type ISelectorGenerator,
  isEnded,
  openResource,
  publishToNearest,
  receiver,
  select,
  startTimer,
  stopTimer,
  transient,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import type { IHistoryWindow } from "./HistoryWindow";
import type {
  IWireHistoryPage,
  IWireProjection,
  IWireThreadEvent,
  IWireThreadItem,
  IWireThreadSnapshot,
  IWireTurnItem,
} from "./Infrastructure/wire";
import { byId, put, putEntity, reconcile, reconcileEntities } from "./rows";
import type { IRuntimeRequest } from "./RuntimeRequest";

declare module "treflex" {
  interface IResourceRegistry {
    "Thread/Stream": { Type: "threadStream" };
  }
  interface IMessageRegistry {
    "Thread/Deleted": { ThreadId: string };
    "Thread/Expired": { ThreadId: string };
    "Thread/RewindProgress": { ThreadId: string };
    "Thread/RequestsSettled": {
      ThreadId: string;
      PendingIds: string[];
      UnansweredIds: string[];
    };
  }
  interface ITimerRegistry {
    "Thread/Reopen": {};
    "Thread/Expire": {};
  }
}

const REOPEN_MS = 1_000;
// Follows THREAD_SNAPSHOT_IDLE_TTL_MS in packages/client-runtime/src/state/threadRetention.ts.
export const RETAIN_MS = 5 * 60_000;

export type IWireRun = IWireProjection["runs"][number];

export interface ITimelineRow {
  visibility: IWireProjection["visibleTurnItems"][number]["visibility"];
  sourceThreadId: string;
}

export interface ITimelineEntry extends ITimelineRow {
  position: number;
  sourceItemId: string;
  item: IWireTurnItem;
}

export interface IOpenThread extends IEntity {
  readonly $Receiver?: IReceiverId<IOpenThread>;
  EnvironmentId: string;
  ThreadId: string;
  LastSequence: number;
  Thread: IWireProjection["thread"] | null;
  Runs: Record<string, IWireProjection["runs"][number]>;
  Attempts: Record<string, IWireProjection["attempts"][number]>;
  Nodes: Record<string, IWireProjection["nodes"][number]>;
  Subagents: Record<string, IWireProjection["subagents"][number]>;
  ProviderSessions: Record<string, IWireProjection["providerSessions"][number]>;
  ProviderThreads: Record<string, IWireProjection["providerThreads"][number]>;
  ProviderTurns: Record<string, IWireProjection["providerTurns"][number]>;
  RuntimeRequests: Record<string, IRuntimeRequest>;
  Messages: Record<string, IWireProjection["messages"][number]>;
  Plans: Record<string, IWireProjection["plans"][number]>;
  CheckpointScopes: Record<string, IWireProjection["checkpointScopes"][number]>;
  Checkpoints: Record<string, IWireProjection["checkpoints"][number]>;
  ContextHandoffs: Record<string, IWireProjection["contextHandoffs"][number]>;
  ContextTransfers: Record<string, IWireProjection["contextTransfers"][number]>;
  TurnItems: Record<string, IWireTurnItem>;
  /** Items asking a request that the last snapshot sent outside its window, so without a row. */
  RowlessRequestItemIds: string[];
  InheritedItems: Record<string, IWireTurnItem>;
  Timeline: string[];
  Rows: Record<string, ITimelineRow>;
  History: IHistoryWindow | null;
  LatestLocalTurnOrdinal: number | null;
}

const streamState = (draft: IOpenThread) =>
  transient(draft, "Thread/StreamState", { Synchronized: false });

export function getDefaultOpenThread(
  environmentId: string,
  threadId: string,
): Omit<IOpenThread, "$Id"> {
  return {
    $Receiver: ThreadReceiver.Id,
    EnvironmentId: environmentId,
    ThreadId: threadId,
    LastSequence: 0,
    Thread: null,
    Runs: {},
    Attempts: {},
    Nodes: {},
    Subagents: {},
    ProviderSessions: {},
    ProviderThreads: {},
    ProviderTurns: {},
    RuntimeRequests: {},
    Messages: {},
    Plans: {},
    CheckpointScopes: {},
    Checkpoints: {},
    ContextHandoffs: {},
    ContextTransfers: {},
    TurnItems: {},
    RowlessRequestItemIds: [],
    InheritedItems: {},
    Timeline: [],
    Rows: {},
    History: null,
    LatestLocalTurnOrdinal: null,
  };
}

export function* openThreadStream(draft: IOpenThread): IActionGenerator {
  yield* openResource(
    draft,
    "Thread/Stream",
    ThreadReceiver,
    { Type: "threadStream", EnvironmentId: draft.EnvironmentId, ThreadId: draft.ThreadId },
    { ResumeFrom: "LastSequence" },
  );
}

export function* retainThread(draft: IOpenThread): IActionGenerator {
  yield* closeResource(draft, "Thread/Stream");
  yield* stopTimer(draft, "Thread/Reopen");
  (yield* streamState(draft)).Synchronized = false;
  yield* startTimer(draft, "Thread/Expire", ThreadReceiver, RETAIN_MS);
}

export function* resumeThread(draft: IOpenThread): IActionGenerator {
  yield* stopTimer(draft, "Thread/Expire");
  yield* openThreadStream(draft);
}

type IBodySources = Pick<IOpenThread, "Messages" | "Checkpoints" | "Subagents">;

// The shared helper only copies ids and bodies, so the wire form passes through it. The files are
// copied because a node can't sit at two slots of the tree.
function restoreBodies(item: IWireTurnItem, sources: IBodySources): IWireTurnItem {
  const restored = restoreTurnItemBodies(item as never, {
    messageText: (id) => sources.Messages[id]?.text,
    checkpointFiles: (id) => {
      const files = sources.Checkpoints[id]?.files;
      return files === undefined ? undefined : (JSON.parse(JSON.stringify(files)) as never);
    },
    subagent: (id) => sources.Subagents[id],
  });
  return restored as unknown as IWireTurnItem;
}

const isLocalRow = (draft: IOpenThread, row: ITimelineRow): boolean =>
  row.visibility === "local" || row.sourceThreadId === draft.ThreadId;

const hasPartialWindow = (draft: IOpenThread): boolean =>
  draft.History !== null && (draft.History.HasMore || draft.History.Cursor !== null);

// Reads only this item's run, so a view can call it per row. The other items are read only for a
// row the first check hides, because a reactive reader of them re-runs on every added row.
function isVisible(draft: IOpenThread, item: IWireTurnItem): boolean {
  const run = item.runId === null ? undefined : draft.Runs[item.runId];
  const input = {
    item,
    runs: run === undefined ? [] : [run],
    attempts: item.type === "run_interrupt_result" ? Object.values(draft.Attempts) : [],
  };
  if (isOrchestrationV2TurnItemVisible({ ...input, items: [] })) return true;
  return isOrchestrationV2TurnItemVisible({ ...input, items: Object.values(draft.TurnItems) });
}

export function isRowVisible(draft: IOpenThread, id: string): boolean {
  const row = draft.Rows[id];
  if (row === undefined) return false;
  const item = timelineItem(draft, id);
  return item !== undefined && (row.visibility !== "local" || isVisible(draft, item));
}

function removeRow(draft: IOpenThread, id: string): void {
  if (draft.Rows[id] === undefined) return;
  draft.Timeline.splice(draft.Timeline.lastIndexOf(id), 1);
  delete draft.Rows[id];
  delete draft.InheritedItems[id];
}

const UNFINISHED_RUN = new Set(["preparing", "queued", "starting", "running", "waiting"]);

function oldestLocalOrdinal(draft: IOpenThread): number | null {
  for (const id of draft.Timeline) {
    if (draft.Rows[id]!.visibility === "local") return draft.TurnItems[id]!.ordinal;
  }
  return null;
}

function isBelowWindow(draft: IOpenThread, item: IWireTurnItem): boolean {
  const watermark = draft.LatestLocalTurnOrdinal;
  if (watermark !== null && item.ordinal <= watermark) return true;
  const oldest = oldestLocalOrdinal(draft);
  return oldest !== null && item.ordinal < oldest;
}

function isUnloadedHistory(draft: IOpenThread, item: IWireTurnItem): boolean {
  if (draft.Rows[item.id] !== undefined) return false;
  if (item.runId === null) return isBelowWindow(draft, item);
  const run = draft.Runs[item.runId];
  if (run !== undefined && UNFINISHED_RUN.has(run.status)) return false;
  const loadedEarlier = draft.Timeline.some((id) => {
    if (draft.Rows[id]!.visibility !== "local") return false;
    const held = draft.TurnItems[id]!;
    return held.runId === item.runId && held.ordinal <= item.ordinal;
  });
  return !loadedEarlier && isBelowWindow(draft, item);
}

function placeRow(draft: IOpenThread, item: IWireTurnItem, heldOrdinal: number | undefined): void {
  const row = draft.Rows[item.id];
  if (
    row?.visibility === "local" &&
    row.sourceThreadId === item.threadId &&
    heldOrdinal === item.ordinal
  )
    return;
  if (row === undefined && hasPartialWindow(draft) && isUnloadedHistory(draft, item)) return;
  removeRow(draft, item.id);
  insertRow(draft, item);
}

function insertRow(draft: IOpenThread, item: IWireTurnItem): void {
  // Local rows are in order, and new items land last, so this search stops at once.
  let insertion = draft.Timeline.length;
  for (let index = insertion - 1; index >= 0; index -= 1) {
    const id = draft.Timeline[index]!;
    if (draft.Rows[id]!.visibility !== "local") continue;
    const held = draft.TurnItems[id]!;
    const later =
      held.ordinal > item.ordinal ||
      (held.ordinal === item.ordinal && id.localeCompare(item.id) > 0);
    if (!later) break;
    insertion = index;
  }
  draft.Timeline.splice(insertion, 0, item.id);
  draft.Rows[item.id] = { visibility: "local", sourceThreadId: item.threadId };
}

// Follows restoreQueuedUserItems in packages/client-runtime/src/state/orchestrationV2Projection.ts:
// a snapshot leaves a queued run's user item without a row, and it skips the window check.
function restoreQueuedUserRows(draft: IOpenThread, runId: string): void {
  for (const item of Object.values(draft.TurnItems)) {
    if (item.runId !== runId || item.type !== "user_message" || item.inputIntent !== "queued_turn")
      continue;
    if (draft.Rows[item.id] === undefined) insertRow(draft, item);
  }
}

function applyTurnItem(draft: IOpenThread, wire: IWireTurnItem): void {
  const held = draft.TurnItems[wire.id];
  const payload = restoreBodies(wire, draft);
  if (held === undefined && hasPartialWindow(draft) && isUnloadedHistory(draft, payload)) return;
  const heldOrdinal = held?.ordinal;
  put(draft.TurnItems, payload);
  placeRow(draft, payload, heldOrdinal);
  const watermark = draft.LatestLocalTurnOrdinal;
  if (hasPartialWindow(draft) && (watermark === null || payload.ordinal > watermark)) {
    draft.LatestLocalTurnOrdinal = payload.ordinal;
  }
}

function setThread(draft: IOpenThread, thread: NonNullable<IOpenThread["Thread"]>): void {
  if (draft.Thread === null) draft.Thread = thread;
  else reconcile(draft.Thread, thread);
}

function applyEvent(
  draft: IOpenThread,
  event: Exclude<IWireThreadEvent, { type: "runtime-request.updated" }>,
): void {
  switch (event.type) {
    case "thread.pull-request-link-updated": {
      const thread = JSON.parse(JSON.stringify(draft.Thread)) as OrchestrationV2AppThread;
      setThread(
        draft,
        applyThreadPullRequestLinkUpdate(thread, event.payload as never) as unknown as NonNullable<
          IOpenThread["Thread"]
        >,
      );
      return;
    }
    case "thread.created":
    case "thread.archived":
    case "thread.unarchived":
    case "thread.deleted":
    case "thread.settled":
    case "thread.unsettled":
    case "thread.snoozed":
    case "thread.unsnoozed":
    case "thread.auto-settle-set":
    case "thread.pinned":
    case "thread.unpinned":
    case "thread.pin-reordered":
    case "thread.active-reordered":
    case "thread.metadata-updated":
    case "thread.pull-request-synced":
    case "thread.runtime-mode-updated":
    case "thread.interaction-mode-updated":
    case "thread.model-selection-updated":
    case "thread.provider-switched":
    case "thread.guest-share-updated":
    case "thread.visited":
    case "thread.tags-updated":
    case "thread.marked-unread":
      setThread(draft, event.payload);
      return;
    // Follows applyOrchestrationV2ThreadVisit in packages/contracts/src/orchestrationV2.ts.
    case "thread.visit-recorded":
      if (draft.Thread === null) return;
      draft.Thread.lastVisitedAt = event.payload.lastVisitedAt;
      if (event.payload.opens !== undefined) draft.Thread.opens = event.payload.opens;
      return;
    case "turn-item.updated":
      applyTurnItem(draft, event.payload);
      return;
    case "run.created":
    case "run.updated": {
      const wasQueued = draft.Runs[event.payload.id]?.status === "queued";
      put(draft.Runs, event.payload);
      if (wasQueued && event.payload.status !== "queued")
        restoreQueuedUserRows(draft, event.payload.id);
      return;
    }
    case "run.background-work-cancelled": {
      const run = draft.Runs[event.payload.runId];
      if (run !== undefined)
        run.restartCancelledBackgroundWork = event.payload.restartCancelledBackgroundWork;
      return;
    }
    case "run-attempt.created":
    case "run-attempt.updated":
      put(draft.Attempts, event.payload);
      return;
    case "node.updated":
      put(draft.Nodes, event.payload);
      return;
    case "subagent.updated":
      put(draft.Subagents, restoreSubagentBodies(event.payload, draft.Subagents[event.payload.id]));
      return;
    case "provider-session.attached":
    case "provider-session.updated":
      put(draft.ProviderSessions, event.payload);
      return;
    case "provider-session.detached":
      delete draft.ProviderSessions[event.payload.providerSessionId];
      return;
    case "provider-thread.updated":
      if (
        draft.Thread !== null &&
        event.payload.appThreadId === draft.Thread.id &&
        !isQueuedProviderThreadPlaceholder(event.payload)
      )
        draft.Thread.activeProviderThreadId = event.payload.id;
      put(draft.ProviderThreads, event.payload);
      return;
    case "provider-turn.updated": {
      const tokenUsage =
        event.payload.tokenUsage ?? draft.ProviderTurns[event.payload.id]?.tokenUsage;
      put(
        draft.ProviderTurns,
        tokenUsage === undefined ? event.payload : { ...event.payload, tokenUsage },
      );
      return;
    }
    case "message.updated":
      put(draft.Messages, event.payload);
      return;
    case "plan.updated":
      put(draft.Plans, event.payload);
      return;
    case "checkpoint-scope.created":
      put(draft.CheckpointScopes, event.payload);
      return;
    case "checkpoint.captured":
      put(draft.Checkpoints, event.payload);
      return;
    case "checkpoint.rollback-requested":
      return;
    case "context-handoff.updated":
      put(draft.ContextHandoffs, event.payload);
      return;
    case "context-transfer.created":
    case "context-transfer.updated":
      put(draft.ContextTransfers, event.payload);
      return;
    default:
      event satisfies never;
  }
}

function applySnapshot(
  draft: IOpenThread,
  item: IWireThreadSnapshot,
  history: IHistoryWindow,
): void {
  // restoreLocalVisibleTurnItems reads only row fields the wire form shares.
  const projection = (
    item.turnItemsOmitLocalVisible === true
      ? restoreLocalVisibleTurnItems(item.projection as never)
      : item.projection
  ) as IWireProjection;
  const sources = {
    Messages: byId(projection.messages),
    Checkpoints: byId(projection.checkpoints),
    Subagents: byId(projection.subagents),
  };
  const turnItems = byId(projection.turnItems.map((held) => restoreBodies(held, sources)));
  const inherited: Record<string, IWireTurnItem> = {};
  const rows: Record<string, ITimelineRow> = {};
  const timeline: string[] = [];
  for (const row of projection.visibleTurnItems) {
    const shape = { visibility: row.visibility, sourceThreadId: row.sourceThreadId };
    if (rows[row.sourceItemId] === undefined) timeline.push(row.sourceItemId);
    rows[row.sourceItemId] = shape;
    if (!isLocalRow(draft, shape)) inherited[row.sourceItemId] = row.item;
    else turnItems[row.sourceItemId] ??= restoreBodies(row.item, sources);
  }
  draft.LastSequence = item.snapshotSequence;
  setThread(draft, projection.thread);
  reconcile(draft.Runs, byId(projection.runs));
  reconcile(draft.Attempts, byId(projection.attempts));
  reconcile(draft.Nodes, byId(projection.nodes));
  reconcile(draft.Subagents, sources.Subagents);
  reconcile(draft.ProviderSessions, byId(projection.providerSessions));
  reconcile(draft.ProviderThreads, byId(projection.providerThreads));
  reconcile(draft.ProviderTurns, byId(projection.providerTurns));
  reconcile(draft.Messages, sources.Messages);
  reconcile(draft.Plans, byId(projection.plans));
  reconcile(draft.CheckpointScopes, byId(projection.checkpointScopes));
  reconcile(draft.Checkpoints, sources.Checkpoints);
  reconcile(draft.ContextHandoffs, byId(projection.contextHandoffs));
  reconcile(draft.ContextTransfers, byId(projection.contextTransfers));
  reconcile(draft.TurnItems, turnItems);
  draft.RowlessRequestItemIds = Object.values(turnItems)
    .filter((held) => "requestId" in held && rows[held.id] === undefined)
    .map((held) => held.id);
  reconcile(draft.InheritedItems, inherited);
  reconcile(draft.Rows, rows);
  reconcile(draft.Timeline, timeline);
  draft.History = history;
  draft.LatestLocalTurnOrdinal = item.latestLocalTurnOrdinal ?? null;
}

// The same window carries on, so a fetch already running in it still lands.
function* windowOf(
  draft: IOpenThread,
  item: IWireThreadSnapshot,
): IActionGenerator<IHistoryWindow> {
  const cursor = item.historyCursor ?? null;
  const hasMore = item.hasMoreHistory ?? false;
  const held = draft.History;
  if (
    held !== null &&
    held.Cursor === cursor &&
    held.HasMore === hasMore &&
    held.Error === undefined
  )
    return held;
  return yield* entity<IHistoryWindow>({
    ThreadId: draft.ThreadId,
    Cursor: cursor,
    HasMore: hasMore,
  });
}

function* applyItem(draft: IOpenThread, item: IWireThreadItem): IActionGenerator {
  if (item.kind === "synchronized") {
    (yield* streamState(draft)).Synchronized = true;
    return;
  }
  if (item.kind === "snapshot") {
    // In this order, so the mints end their steps before any of the snapshot's writes.
    const history = yield* windowOf(draft, item);
    yield* reconcileEntities(draft.RuntimeRequests, item.projection.runtimeRequests);
    applySnapshot(draft, item, history);
    yield* announceSettled(draft);
    yield* announceRewind(draft);
    return;
  }
  if (item.sequence <= draft.LastSequence) return;
  draft.LastSequence = item.sequence;
  if (item.kind === "unknown-event") return;
  if (item.event.threadId !== draft.ThreadId) return;
  // Removing this entity has to happen outside its own delivery.
  if (item.event.type === "thread.deleted") {
    yield* publishToNearest(draft, "Thread/Deleted", { ThreadId: draft.ThreadId });
    return;
  }
  if (draft.Thread === null) return;
  if (item.event.type === "runtime-request.updated") {
    yield* putEntity(draft.RuntimeRequests, item.event.payload);
    if (item.event.payload.status !== "pending") yield* announceSettled(draft);
    return;
  }
  applyEvent(draft, item.event);
  if (REWIND_EVENTS.has(item.event.type)) yield* announceRewind(draft);
}

// What rewindOutcome in rewind.ts reads.
const REWIND_EVENTS = new Set<IWireThreadEvent["type"]>([
  "thread.metadata-updated",
  "run.updated",
  "provider-thread.updated",
]);

function* announceRewind(draft: IOpenThread): IActionGenerator {
  if (draft.Thread?.rollbackRequestId == null) return;
  yield* publishToNearest(draft, "Thread/RewindProgress", { ThreadId: draft.ThreadId });
}

// Follows makeThreadRequestsResolvedAnnouncer in packages/client-runtime/src/state/threadRequests.ts.
function* announceSettled(draft: IOpenThread): IActionGenerator {
  const requests = Object.values(draft.RuntimeRequests);
  yield* publishToNearest(draft, "Thread/RequestsSettled", {
    ThreadId: draft.ThreadId,
    PendingIds: pendingIds(draft),
    UnansweredIds: requests
      .filter((request) => request.status === "cancelled" || request.status === "expired")
      .map((request) => request.id),
  });
}

function* reopenLater(draft: IOpenThread): IActionGenerator {
  yield* startTimer(draft, "Thread/Reopen", ThreadReceiver, REOPEN_MS);
}

export const ThreadReceiver = receiver<IOpenThread>("ThreadReceiver")({
  *"Thread/Stream"(draft, message) {
    if (isEnded(message)) {
      // A batch the receiver failed would fail again on every reopen.
      if (message.$Ended.Reason !== "receiver-failed") yield* reopenLater(draft);
      return;
    }
    if ("Item" in message) yield* applyItem(draft, message.Item);
    else (yield* streamState(draft)).Synchronized = false;
  },
  *"Thread/Reopen"(draft) {
    yield* stopTimer(draft, "Thread/Reopen");
    yield* openThreadStream(draft);
  },
  // Removing this entity has to happen outside its own delivery.
  *"Thread/Expire"(draft) {
    yield* stopTimer(draft, "Thread/Expire");
    yield* publishToNearest(draft, "Thread/Expired", { ThreadId: draft.ThreadId });
  },
  // A page can queue behind a snapshot that replaces its window.
  *"History/Page"(draft, { WindowId, Items }) {
    if (draft.History?.$Id === WindowId) mergeOlderRows(draft, Items);
  },
});

export function* threadSynchronized(draft: IOpenThread): ISelectorGenerator<boolean> {
  return (yield* streamState(draft)).Synchronized;
}

function mergeOlderRows(draft: IOpenThread, items: IWireHistoryPage["items"]): void {
  const head: string[] = [];
  const inPage = new Set<string>();
  for (const { sourceItemId: id, visibility, sourceThreadId, item } of items) {
    if (inPage.has(id)) continue;
    const shape = { visibility, sourceThreadId };
    const local = isLocalRow(draft, shape);
    const hasRow = draft.Rows[id] !== undefined;
    if (!hasRow && local) {
      const held = draft.TurnItems[id];
      if (held !== undefined && (held.type !== "run_interrupt_request" || !isVisible(draft, held)))
        continue;
    }
    inPage.add(id);
    head.push(id);
    if (hasRow) continue;
    draft.Rows[id] = shape;
    if (!local) draft.InheritedItems[id] = item;
    else draft.TurnItems[id] ??= item;
  }
  if (head.length === 0) return;
  draft.Timeline = [...head, ...draft.Timeline.filter((id) => !inPage.has(id))];
}

function checkpointOfRun(draft: IOpenThread, runId: string | null) {
  if (runId === null) return undefined;
  return Object.values(draft.Checkpoints).find((checkpoint) => checkpoint.runId === runId);
}

// getTurnDiff refuses any other checkpoint: see CheckpointDiffQuery.ts in apps/server.
function servableTurn(
  draft: IOpenThread,
  checkpoint: IWireProjection["checkpoints"][number] | undefined,
): number | null {
  if (checkpoint === undefined || checkpoint.status !== "ready" || checkpoint.runId === null)
    return null;
  return draft.Runs[checkpoint.runId]?.status === "completed" ? checkpoint.appRunOrdinal : null;
}

// The turn a row's diff belongs to, which is the checkpoint's appRunOrdinal: what getTurnDiff counts.
export function diffTurnOf(draft: IOpenThread, item: IWireTurnItem): number | null {
  const checkpoint =
    item.type === "checkpoint"
      ? draft.Checkpoints[item.checkpointId]
      : item.type === "file_change"
        ? checkpointOfRun(draft, item.runId)
        : undefined;
  return servableTurn(draft, checkpoint);
}

export function latestDiffTurn(draft: IOpenThread): number | null {
  let latest: number | null = null;
  for (const checkpoint of Object.values(draft.Checkpoints)) {
    const turn = servableTurn(draft, checkpoint);
    if (turn !== null && (latest === null || turn > latest)) latest = turn;
  }
  return latest;
}

// Claude's file_change items carry no counts, and the wire drops their diffStr, so the run's
// checkpoint is the source. Its paths are relative where fileName is absolute.
export function fileChangeCounts(
  draft: IOpenThread,
  item: Extract<IWireTurnItem, { type: "file_change" }>,
): { additions: number; deletions: number } | null {
  if (item.additions !== undefined || item.deletions !== undefined) {
    return { additions: item.additions ?? 0, deletions: item.deletions ?? 0 };
  }
  const name = item.fileName.replaceAll("\\", "/");
  const file = checkpointOfRun(draft, item.runId)?.files.find(
    (held) => name === held.path || name.endsWith(`/${held.path}`),
  );
  return file === undefined ? null : { additions: file.additions, deletions: file.deletions };
}

export function timelineItem(draft: IOpenThread, id: string): IWireTurnItem | undefined {
  const row = draft.Rows[id];
  if (row === undefined) return undefined;
  return isLocalRow(draft, row) ? draft.TurnItems[id] : draft.InheritedItems[id];
}

// Every row, so it's for tests and tools: a reactive reader re-runs across the whole list per added
// row. A view walks Timeline and joins each row with timelineItem.
export function timelineEntries(draft: IOpenThread): ITimelineEntry[] {
  return draft.Timeline.filter((id) => isRowVisible(draft, id)).map((id, position) => {
    const row = draft.Rows[id]!;
    return {
      position,
      sourceItemId: id,
      visibility: row.visibility,
      sourceThreadId: row.sourceThreadId,
      item: timelineItem(draft, id)!,
    };
  });
}

export function* timelineIds(draft: IOpenThread): ISelectorGenerator<string[]> {
  return [...draft.Timeline];
}

const ACTIVE_RUN = new Set(["preparing", "starting", "running", "waiting"]);

export function* latestRun(draft: IOpenThread): ISelectorGenerator<IWireRun | null> {
  return newestRun(draft);
}

// A cancelled queued run keeps its later ordinal, so the active run has to be looked for first.
export function newestRun(draft: IOpenThread): IWireRun | null {
  let latest: IWireRun | null = null;
  let active: IWireRun | null = null;
  for (const run of Object.values(draft.Runs)) {
    if (run.status === "queued") continue;
    if (latest === null || run.ordinal > latest.ordinal) latest = run;
    if (ACTIVE_RUN.has(run.status) && (active === null || run.ordinal > active.ordinal))
      active = run;
  }
  return active ?? latest;
}

export function* queuedRunIds(draft: IOpenThread): ISelectorGenerator<string[]> {
  return Object.values(draft.Runs)
    .filter((run) => run.status === "queued")
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((run) => run.id);
}

export function runMessage(
  draft: IOpenThread,
  runId: string,
): IWireProjection["messages"][number] | undefined {
  const messageId = draft.Runs[runId]?.userMessageId;
  return messageId == null ? undefined : draft.Messages[messageId];
}

const pendingIds = (draft: IOpenThread): string[] =>
  Object.values(draft.RuntimeRequests)
    .filter((request) => request.status === "pending")
    .map((request) => request.id);

/** Each pending request's turn item, by request id. */
// Follows derivePendingThreadRequests in packages/client-runtime/src/state/threadRequests.ts, which
// searches every turn item. Here a read of every held item costs frames at 20,000 items, and so does
// a timeline walk that misses, so the rowless items go first.
export function* requestItems(
  draft: IOpenThread,
): ISelectorGenerator<Record<string, IWireTurnItem>> {
  const items: Record<string, IWireTurnItem> = {};
  const unfound = new Set(pendingIds(draft));
  const claim = (item: IWireTurnItem | undefined) => {
    if (item !== undefined && "requestId" in item && unfound.delete(item.requestId))
      items[item.requestId] = item;
  };
  if (unfound.size === 0) return items;
  for (const id of draft.RowlessRequestItemIds) claim(draft.TurnItems[id]);
  for (let index = draft.Timeline.length - 1; index >= 0 && unfound.size > 0; index -= 1)
    claim(draft.TurnItems[draft.Timeline[index]!]);
  return items;
}

function* pendingIdsOfType(
  draft: IOpenThread,
  matches: (type: IWireTurnItem["type"] | undefined) => boolean,
): ISelectorGenerator<string[]> {
  const items = yield* select(requestItems);
  return pendingIds(draft).filter((id) => matches(items[id]?.type));
}

// Ids, because <For> keys by reference and a fresh row object would remount a half-answered form.
export function* pendingApprovalIds(draft: IOpenThread): ISelectorGenerator<string[]> {
  return yield* pendingIdsOfType(draft, (type) => type === "approval_request");
}

export function* pendingQuestionIds(draft: IOpenThread): ISelectorGenerator<string[]> {
  return yield* pendingIdsOfType(draft, (type) => type === "user_input_request");
}

/** Secret, link and other requests this client can show but not answer. */
export function* pendingOtherIds(draft: IOpenThread): ISelectorGenerator<string[]> {
  return yield* pendingIdsOfType(
    draft,
    (type) => type !== "approval_request" && type !== "user_input_request",
  );
}

export default createEntityFeature<IOpenThread>(import.meta.url)(
  {},
  {
    latestRun,
    pendingApprovalIds,
    pendingQuestionIds,
    pendingOtherIds,
    queuedRunIds,
    requestItems,
    threadSynchronized,
    timelineIds,
  },
);
