import { notificationChildThreadId } from "@t3tools/client-runtime/state/thread-execution";
import type { OrchestrationV2NotificationSource } from "@t3tools/contracts";

import type { IWireProjection, IWireTurnItem } from "./Infrastructure/wire";
import type { ILineageAgent } from "./lineage";

export type IStatus = IWireTurnItem["status"];
export type ISubagentItem = Extract<IWireTurnItem, { type: "subagent" }>;
export type INotificationItem = Extract<IWireTurnItem, { type: "notification" }>;
export type ISubagent = IWireProjection["subagents"][number];

export const SETTLED = new Set<IStatus>(["completed", "failed", "cancelled", "interrupted"]);
const ACTIVE = new Set<IStatus>(["pending", "running", "waiting"]);

type IOutcome = INotificationItem["outcome"];

// Follows the notification outcome tables in apps/web/src/components/chat/V2LifecycleRow.tsx.
const OUTCOME_STATUS: Record<IOutcome, IStatus | null> = {
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  updated: null,
  unknown: null,
};

const OUTCOME_LABEL: Record<IOutcome, string> = {
  completed: "Finished",
  failed: "Failed",
  cancelled: "Stopped",
  updated: "Updated",
  unknown: "Finished",
};

export interface ISubagentEvent {
  Status: IStatus | null;
  Label: string;
  At: string;
}

type IEncodedSource = { kind: string; work?: string; childThreadId?: string };

/**
 * The source as stock's schema decodes it. The tree holds the wire's encoded form, where a
 * subagent's is `background_task` with `work: "subagent"` and a command's is `background_command`.
 */
export function notificationSource(item: INotificationItem): OrchestrationV2NotificationSource {
  const source = item.source as unknown as IEncodedSource;
  if (source.kind === "background_task" && source.work === "subagent")
    return {
      kind: "subagent",
      ...(source.childThreadId === undefined ? {} : { childThreadId: source.childThreadId }),
    } as OrchestrationV2NotificationSource;
  if (source.kind === "background_command") return { kind: "command" };
  return item.source as OrchestrationV2NotificationSource;
}

export const notifiedChildThreadId = (item: INotificationItem): string | null =>
  notificationChildThreadId(notificationSource(item)) ?? null;

// Follows SubagentNotificationLink in apps/web/src/components/chat/V2LifecycleRow.tsx.
export function notifiedSubagent(
  subagents: Readonly<Record<string, ISubagent>>,
  item: INotificationItem,
): ISubagent | null {
  const childThreadId = notifiedChildThreadId(item);
  if (childThreadId === null) return null;
  const taskIds = item.source.kind === "delegated_task" ? item.source.taskIds : undefined;
  for (const agent of Object.values(subagents)) {
    if (taskIds === undefined ? agent.childThreadId === childThreadId : taskIds.includes(agent.id))
      return agent;
  }
  return null;
}

// Follows subagentResumedSince in apps/web/src/components/chat/V2LifecycleRow.logic.ts: Claude can
// reuse a resumed agent's id, so an outcome from before it started again no longer describes it.
function resumedSince(agent: ISubagent, notifiedAt: string): boolean {
  if (ACTIVE.has(agent.status)) return true;
  if (agent.startedAt === null) return false;
  const notified = Date.parse(notifiedAt);
  return !Number.isNaN(notified) && Date.parse(agent.startedAt) > notified;
}

/** The outcome a notification's card shows, or undefined when the task's live status is newer. */
export function notificationEvent(
  item: INotificationItem,
  agent: ISubagent,
): ISubagentEvent | undefined {
  const at = item.startedAt ?? item.updatedAt;
  const status = OUTCOME_STATUS[item.outcome];
  if (status !== null && resumedSince(agent, at)) return undefined;
  return { Status: status, Label: OUTCOME_LABEL[item.outcome], At: at };
}

// Follows subagentGroupTiming in apps/web/src/components/chat/TimelineV2EventRow.logic.ts.
export function groupTiming(agents: ReadonlyArray<ISubagentItem | ISubagent>): ILineageAgent {
  let start: string | null = null;
  let end: string | null = null;
  let endUnknown = false;
  for (const agent of agents) {
    if (
      agent.startedAt !== null &&
      (start === null || Date.parse(agent.startedAt) < Date.parse(start))
    )
      start = agent.startedAt;
    if (agent.completedAt === null) endUnknown = true;
    else if (end === null || Date.parse(agent.completedAt) > Date.parse(end))
      end = agent.completedAt;
  }
  const live = agents.some((agent) => ACTIVE.has(agent.status));
  return {
    Status: live ? "running" : "completed",
    StartedAt: start,
    CompletedAt: live || endUnknown ? null : end,
  };
}
