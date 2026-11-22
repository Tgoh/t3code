import { repositoryCheckpointScopeIds } from "@t3tools/client-runtime/state/thread-repositories";
import { canForkProjectedAssistantItem } from "@t3tools/client-runtime/state/thread-workflows";

import type { IWireTurnItem } from "./Infrastructure/wire";
import { type IOpenThread, isRowVisible, newestRun, timelineItem } from "./OpenThread";

type ICheckpoint = IOpenThread["Checkpoints"][string];

// A missing snapshot (no git, or a side chat) still pins a conversation position; only
// restoring files needs a ready one.
const isRewindable = (checkpoint: Pick<ICheckpoint, "status">) =>
  checkpoint.status === "ready" || checkpoint.status === "missing";

// Follows findRevertCheckpoint in apps/web/src/session-logic.ts.
export function findRevertCheckpoint(
  thread: Pick<IOpenThread, "Checkpoints" | "CheckpointScopes">,
  turnCount: number,
): ICheckpoint | undefined {
  // A tracked repository's baseline also sits at ordinal zero; it is never a rewind target.
  const repositoryScopeIds: ReadonlySet<string> = repositoryCheckpointScopeIds(
    Object.values(thread.CheckpointScopes) as never,
  );
  return Object.values(thread.Checkpoints).findLast(
    (checkpoint) =>
      !repositoryScopeIds.has(checkpoint.scopeId) &&
      isRewindable(checkpoint) &&
      (turnCount === 0
        ? checkpoint.ordinalWithinScope === 0 && checkpoint.appRunOrdinal === null
        : checkpoint.appRunOrdinal === turnCount),
  );
}

// Follows threadStartCheckpointAvailable in apps/web/src/components/ChatView.tsx: a paged history
// window can't identify the first loaded run as the thread start.
export function threadStartAvailable(thread: IOpenThread): boolean {
  return thread.History?.HasMore !== true && findRevertCheckpoint(thread, 0) !== undefined;
}

// Follows deriveUnsettledRunId in apps/web/src/components/chat/MessagesTimeline.logic.ts.
export function unsettledRunId(thread: IOpenThread): string | null {
  const run = newestRun(thread);
  if (run === null) return null;
  const settled =
    run.completedAt !== null &&
    run.status !== "running" &&
    run.status !== "starting" &&
    run.status !== "waiting";
  return settled ? null : run.id;
}

// Follows deriveAvailableRevertTurnCounts in apps/web/src/components/ChatView.logic.ts.
export function availableRevertTurnCounts(thread: IOpenThread): Set<number> {
  const available = new Set<number>();
  const activeId = thread.Thread?.activeProviderThreadId;
  const providerThread = activeId == null ? undefined : thread.ProviderThreads[activeId];
  if (
    !providerThread?.providerSessionId ||
    providerThread.providerInstanceId !== thread.Thread?.modelSelection.instanceId
  )
    return available;
  available.add(0);
  type IProviderTurn = IOpenThread["ProviderTurns"][string];
  const latestTurnByAttempt = new Map<string, IProviderTurn>();
  for (const turn of Object.values(thread.ProviderTurns)) {
    if (turn.runAttemptId === null) continue;
    const latest = latestTurnByAttempt.get(turn.runAttemptId);
    if (latest === undefined || turn.ordinal > latest.ordinal) {
      latestTurnByAttempt.set(turn.runAttemptId, turn);
    }
  }
  for (const run of Object.values(thread.Runs)) {
    if (run.activeAttemptId === null) continue;
    const attempt = thread.Attempts[run.activeAttemptId];
    const providerTurn =
      latestTurnByAttempt.get(run.activeAttemptId) ??
      (attempt?.providerTurnId == null ? undefined : thread.ProviderTurns[attempt.providerTurnId]);
    // A ready file checkpoint alone cannot restore the provider conversation.
    if (providerTurn?.providerThreadId === providerThread.id) available.add(run.ordinal);
  }
  return available;
}

// The run a timeline row counts for, as deriveTimelineEntriesFromVisibleTurnItems in
// apps/web/src/session-logic.ts makes entries: only messages and notifications carry one.
function entryRunId(item: IWireTurnItem, foldedAnswers: ReadonlyMap<string, string | null>) {
  if (item.type === "notification") return item.runId;
  if (item.type === "assistant_message") return item.runId;
  if (item.type !== "user_message") return null;
  if (item.inputIntent === "queued_turn" && item.status === "pending") return null;
  if (foldedAnswers.get(item.messageId) === item.runId) return null;
  return item.runId;
}

/**
 * The turn count each user row rewinds to, by row id. Follows deriveRevertTurnCountByUserMessageId
 * in apps/web/src/session-logic.ts: run ordinals keep increasing after a rewind, so only visible
 * local runs define predecessors.
 */
export function revertTurnCounts(
  thread: IOpenThread,
  options: {
    ThreadStart: boolean;
    UnsettledRunId: string | null;
    Available?: ReadonlySet<number>;
  },
): Record<string, number> {
  const turnCountByRunId = new Map<string, number>();
  for (const checkpoint of Object.values(thread.Checkpoints)) {
    if (checkpoint.appRunOrdinal === null || checkpoint.runId === null) continue;
    if (isRewindable(checkpoint)) turnCountByRunId.set(checkpoint.runId, checkpoint.appRunOrdinal);
  }
  // An answer that started a later run stays a normal message at that run's position.
  const foldedAnswers = new Map<string, string | null>();
  for (const item of Object.values(thread.TurnItems)) {
    if (item.type === "user_input_request" && item.questionAnswer) {
      foldedAnswers.set(`async-answer:${item.questionAnswer.requestId}`, item.runId);
    }
  }
  const targetByRunId = new Map<string, number | undefined>();
  const targets: Record<string, number> = {};
  let previousRunId: string | null = null;
  for (const id of thread.Timeline) {
    // Inherited history belongs to the source thread, not our checkpoint scope.
    if (thread.Rows[id]?.visibility === "inherited" || !isRowVisible(thread, id)) continue;
    const item = timelineItem(thread, id);
    if (item === undefined) continue;
    const runId = entryRunId(item, foldedAnswers);
    if (runId == null) continue;
    if (!targetByRunId.has(runId)) {
      targetByRunId.set(
        runId,
        previousRunId === null
          ? options.ThreadStart
            ? 0
            : undefined
          : turnCountByRunId.get(previousRunId),
      );
      previousRunId = runId;
    }
    if (item.type !== "user_message" || runId === options.UnsettledRunId) continue;
    if (item.inputIntent !== "turn_start" && item.inputIntent !== "queued_turn") continue;
    const target = targetByRunId.get(runId);
    if (target !== undefined && (options.Available === undefined || options.Available.has(target)))
      targets[id] = target;
  }
  return targets;
}

/** What a rewind waits on, captured before it's sent. Follows waitForRevertedMessage in
 * apps/web/src/components/ChatView.logic.ts. */
export interface IRewindWatch {
  CommandId: string;
  TurnCount: number;
  ProviderThreadId: string | null;
  ProviderInstanceId: string | null;
  KnownProviderThreadIds: string[];
  WitnessRunId: string;
}

const SETTLED = new Set(["completed", "interrupted", "failed", "cancelled"]);

/** Null when no settled run follows the target, so there's nothing for the rollback to undo. */
export function rewindWatch(
  thread: IOpenThread,
  turnCount: number,
  commandId: string,
): IRewindWatch | null {
  // Paging can omit the source run. Rollback commits the entire settled suffix atomically.
  let witness: IOpenThread["Runs"][string] | undefined;
  for (const run of Object.values(thread.Runs)) {
    if (run.ordinal <= turnCount || !SETTLED.has(run.status)) continue;
    if (witness === undefined || run.ordinal > witness.ordinal) witness = run;
  }
  if (witness === undefined) return null;
  const providerThreadId = thread.Thread?.activeProviderThreadId ?? null;
  const providerThread =
    providerThreadId === null ? undefined : thread.ProviderThreads[providerThreadId];
  return {
    CommandId: commandId,
    TurnCount: turnCount,
    ProviderThreadId: providerThreadId,
    ProviderInstanceId: providerThread?.providerInstanceId ?? null,
    KnownProviderThreadIds: Object.keys(thread.ProviderThreads),
    WitnessRunId: witness.id,
  };
}

/** Null while the rollback is still landing. */
export function rewindOutcome(
  thread: IOpenThread,
  watch: IRewindWatch,
): { Done: true } | { Error: string } | null {
  const failure = thread.Thread?.rollbackFailure;
  if (failure?.requestId === watch.CommandId) return { Error: failure.message };
  const landed = Object.values(thread.ProviderThreads).some(
    (providerThread) =>
      (providerThread.id === watch.ProviderThreadId ||
        // Claude resets to a fresh root session when rewinding to thread start.
        (watch.TurnCount === 0 &&
          providerThread.ownerNodeId === null &&
          providerThread.appThreadId === thread.ThreadId &&
          providerThread.providerInstanceId === watch.ProviderInstanceId &&
          !watch.KnownProviderThreadIds.includes(providerThread.id))) &&
      providerThread.lastRunOrdinal === (watch.TurnCount === 0 ? null : watch.TurnCount),
  );
  return landed && thread.Runs[watch.WitnessRunId]?.status === "rolled_back"
    ? { Done: true }
    : null;
}

// Follows rewindToMessage in apps/web/src/components/chat/chatViewSend.ts.
export function rewoundPrompt(current: string, restored: string): string {
  if (restored.length === 0) return current;
  return current.length > 0 ? `${current}\n\n${restored}` : restored;
}

/** Whether a reply offers "Fork from this response", by its provider session's capabilities. */
export function canForkItem(thread: IOpenThread, item: IWireTurnItem): boolean {
  const providerThread =
    item.providerThreadId == null ? undefined : thread.ProviderThreads[item.providerThreadId];
  const session =
    providerThread?.providerSessionId == null
      ? undefined
      : thread.ProviderSessions[providerThread.providerSessionId];
  return canForkProjectedAssistantItem({
    projectedItem: { item } as never,
    capabilities: session?.capabilities as never,
  });
}
