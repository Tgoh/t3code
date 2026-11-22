import { resolvePendingHandoff } from "@t3tools/client-runtime/handoff";
import {
  hasDismissedResumeCompaction,
  latestProviderTurnTokenUsage,
  shouldOfferResumeCompaction,
} from "@t3tools/client-runtime/state/context-window";
import {
  IDLE_COMPACTING_LABELS,
  IDLE_COMPACTION_TITLES,
} from "@t3tools/client-runtime/user-message";
import {
  contextCompactionLabel,
  contextCompactionTokenCounts,
} from "@t3tools/client-runtime/work-log/presentation";
import {
  idleCompactionOf,
  isCompactionCommandMessage,
  isOrchestrationV2WorkActive,
  type OrchestrationV2IdleCompaction,
  type ProviderInstanceId,
  resolveIdleCompaction,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import type { IWireModelSelection } from "./Infrastructure/commandEffects";
import type { IWireServerConfig } from "./Infrastructure/settings";
import type { IWireTurnItem } from "./Infrastructure/wire";
import type { IOpenThread } from "./OpenThread";

export interface ICompactionInput {
  Thread: IOpenThread;
  /** The loaded timeline's visible items, oldest first. */
  Items: () => IWireTurnItem[];
  Selection: IWireModelSelection;
  Config: Pick<IWireServerConfig, "providers" | "settings">;
  Idle: boolean;
  Now: number;
  EnvironmentId: string;
  /** This device's `CompactionDismissed` preference. */
  Dismissed: readonly string[];
}

// Follows the `t3code:resume-compaction-dismissed:${environmentId}:${instanceId}` key in
// apps/web/src/components/ChatView.tsx, held here in one per-device preference.
export const compactionDismissalKey = (environmentId: string, instanceId: string) =>
  `${environmentId}:${instanceId}`;

/** Whether one of the thread's questions was answered "Don't ask again" to compacting. */
export function dismissedIn(open: Pick<IOpenThread, "RuntimeRequests">): boolean {
  return hasDismissedResumeCompaction(
    Object.values(open.RuntimeRequests).flatMap((request) =>
      request.kind === "user_input" && request.status === "resolved"
        ? [{ kind: "user-input.resolved", payload: { answers: request.answers } }]
        : [],
    ),
  );
}

const isPrompt = (item: IWireTurnItem) =>
  item.type === "user_message" &&
  (item.text.trim().toLowerCase() !== "/compact" || item.attachments.length > 0);

type IContextUsage = { UsedTokens: number; UpdatedAt: string };

const compactionUsage = (item: ICompactionItem, updatedAt: string): IContextUsage | null => {
  const used = item.afterTokenCount;
  return typeof used !== "number" || !Number.isFinite(used) || used < 0
    ? null
    : { UsedTokens: used, UpdatedAt: updatedAt };
};

// Follows deriveLatestContextWindowSnapshot in packages/client-runtime/src/state/contextWindow.ts,
// keeping only the figure and its time, which it reads from DateTime where this has wire strings.
function contextUsage(
  live: { usedTokens: number; updatedAt: string } | null,
  providerThread: IOpenThread["ProviderThreads"][string] | undefined,
  items: IWireTurnItem[],
): IContextUsage | null {
  const retired = (item: ICompactionItem) =>
    providerThread !== undefined &&
    item.providerThreadId != null &&
    item.providerThreadId !== providerThread.id;
  const completed = items.findLast(
    (item): item is ICompactionItem =>
      item.type === "compaction" && item.status === "completed" && !retired(item),
  );
  const usageAt =
    live?.updatedAt ?? (providerThread?.contextUsage != null ? providerThread.updatedAt : null);
  if (completed !== undefined) {
    const compactedAt = completed.completedAt ?? completed.updatedAt;
    // Usage reported before the compaction describes the context it discarded; usage at the same
    // instant is the provider's own post-compaction report.
    if (usageAt === null || Date.parse(compactedAt) > Date.parse(usageAt))
      return compactionUsage(completed, compactedAt);
  }
  if (live !== null) return { UsedTokens: Math.max(0, live.usedTokens), UpdatedAt: live.updatedAt };
  if (providerThread?.contextUsage != null) {
    return {
      UsedTokens: providerThread.contextUsage.usedTokens,
      UpdatedAt: providerThread.updatedAt,
    };
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (item.type !== "compaction" || retired(item)) continue;
    const usage = compactionUsage(item, item.startedAt ?? item.updatedAt);
    if (usage !== null) return usage;
  }
  return null;
}

/**
 * The tokens the next send compacts first, or null when it sends as is.
 * Follows compactBeforeSendTokens in packages/client-runtime/src/state/contextWindow.ts.
 */
export function compactBeforeSendTokens(input: ICompactionInput): number | null {
  const open = input.Thread;
  const thread = open.Thread;
  const provider = input.Config.providers.find(
    (entry) => entry.instanceId === input.Selection.instanceId,
  );
  if (
    thread == null ||
    provider === undefined ||
    input.Dismissed.includes(compactionDismissalKey(input.EnvironmentId, provider.instanceId)) ||
    !input.Idle ||
    !provider.slashCommands.some((command) => command.name === "compact") ||
    resolveIdleCompaction(
      input.Config.settings as never,
      provider.instanceId as ProviderInstanceId,
    ) === "off"
  )
    return null;
  const runs = Object.values(open.Runs).sort((left, right) => left.ordinal - right.ordinal);
  const requests = Object.values(open.RuntimeRequests);
  if (
    requests.some((request) => request.status === "pending") ||
    runs.some((run) => run.status === "queued" && run.queueHeld === true)
  )
    return null;
  const items = input.Items();
  const hasPrompt = items.some(isPrompt);
  const promptRuns = hasPrompt
    ? null
    : new Set(items.flatMap((item) => (item.type === "user_message" ? [item.runId] : [])));
  if (
    !hasPrompt &&
    !runs.some(
      (run) => run.status !== "rolled_back" && run.startedAt !== null && !promptRuns!.has(run.id),
    )
  )
    return null;
  if (
    resolvePendingHandoff(
      { runs, visibleTurnItems: items } as never,
      input.Selection as never,
      input.Config.providers as never,
    ) !== null
  )
    return null;
  if (dismissedIn(open)) return null;
  const activeId = thread.activeProviderThreadId;
  const providerThread = activeId == null ? undefined : open.ProviderThreads[activeId];
  const live = latestProviderTurnTokenUsage(
    Object.values(open.ProviderTurns).filter((turn) => turn.providerThreadId === activeId),
    (input.Selection.instanceId === thread.modelSelection.instanceId
      ? { thread, contextTransfers: Object.values(open.ContextTransfers) }
      : null) as never,
    (providerThread ?? null) as never,
  );
  const usage = contextUsage(live, providerThread, items);
  return usage !== null &&
    shouldOfferResumeCompaction({
      provider: provider.driver,
      usedTokens: usage.UsedTokens,
      updatedAt: usage.UpdatedAt,
      promptCacheTtlMs: live?.promptCacheTtlMs,
      now: DateTime.formatIso(DateTime.makeUnsafe(input.Now)),
    })
    ? usage.UsedTokens
    : null;
}

type ICompactionItem = Extract<IWireTurnItem, { type: "compaction" }>;

/** Why T3 Code sent the `/compact` that ran this item, or undefined for one someone asked for. */
export function compactionReason(
  open: Pick<IOpenThread, "Runs" | "Messages">,
  item: ICompactionItem,
): OrchestrationV2IdleCompaction | undefined {
  const run = item.runId === null ? undefined : open.Runs[item.runId];
  const message = run === undefined ? undefined : open.Messages[run.userMessageId];
  return message === undefined ? undefined : idleCompactionOf(message as never);
}

/**
 * Follows the context-compaction row in deriveMessagesTimelineRows,
 * apps/web/src/components/chat/MessagesTimeline.logic.ts.
 */
export function compactionLabel(
  item: ICompactionItem,
  reason: OrchestrationV2IdleCompaction | undefined,
): string {
  const label = contextCompactionLabel(item as never);
  if (
    reason === undefined ||
    item.status === "failed" ||
    item.status === "cancelled" ||
    item.status === "interrupted"
  )
    return label;
  if (isOrchestrationV2WorkActive(item.status)) return IDLE_COMPACTING_LABELS[reason];
  const tokens = contextCompactionTokenCounts(item as never);
  return tokens === null
    ? IDLE_COMPACTION_TITLES[reason]
    : `${IDLE_COMPACTION_TITLES[reason]} ${tokens.before} → ${tokens.after} tokens`;
}

/** A bare `/compact` prompt, which stock shows as its compaction row rather than a message. */
export const isCompactPrompt = (item: IWireTurnItem) =>
  item.type === "user_message" &&
  isCompactionCommandMessage({ role: "user", text: item.text, attachments: item.attachments });

// Follows formatContextWindowTokens in apps/web/src/lib/contextWindow.ts.
export function formatContextTokens(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value < 1_000) return `${Math.round(value)}`;
  if (value < 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value < 999_500) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}
