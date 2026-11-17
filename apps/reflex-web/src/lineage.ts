import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import {
  deriveThreadRelationshipGraph,
  immediateThreadRelationships,
  isParentThreadRelationship,
  resolveMergeBackTargetThreadId,
  threadRelationshipRowStatus,
  type ThreadRelationshipWalkRow,
} from "@t3tools/client-runtime/state/thread-relationships";
import { isOrchestrationV2WorkActive, type ThreadId } from "@t3tools/contracts";

import type { IWireProjection, IWireThreadShell } from "./Infrastructure/wire";

type ISubagent = IWireProjection["subagents"][number];

export type ILineageRelation =
  | "parent"
  | "parentAgent"
  | "fork"
  | "transfer"
  | "subagent"
  | "remote";

export interface ILineageAgent {
  Status: string;
  StartedAt: string | null;
  CompletedAt: string | null;
}

export interface ILineageRow {
  /** For a remote task, the thread it runs as on the linked environment. */
  ThreadId: string;
  /** Null for a thread the shell doesn't carry and no lookup has titled yet. */
  Title: string | null;
  Relation: ILineageRelation;
  Status: string | null;
  CreatedAt: string | null;
  MergeTarget: boolean;
  /** The task behind a subagent row, for its elapsed time. */
  Agent: ILineageAgent | null;
  /** The linked environment's label, for a remote task. */
  Remote: string | null;
}

export interface ILineage {
  /** Parent, merge target, forks and context transfers. */
  Related: ILineageRow[];
  Active: ILineageRow[];
  /** Finished subagents, under stock's "Previous agents". */
  Previous: ILineageRow[];
  Running: number;
  /** Related threads the shell doesn't carry, whose titles the server has to look up. */
  Lookup: string[];
}

export interface ILineageInput {
  thread: IWireProjection["thread"];
  subagents: ReadonlyArray<ISubagent>;
  contextTransfers: ReadonlyArray<IWireProjection["contextTransfers"][number]>;
  shells: ReadonlyArray<IWireThreadShell>;
  /** A settled title lookup of `Lookup`: deleted and unknown threads are absent. */
  titles: Readonly<Record<string, string>> | null;
}

// Follows isFinishedAgentStatus in apps/web/src/components/chat/ThreadRelationshipsControl.tsx.
const isFinishedAgentStatus = (status: string | null | undefined) =>
  ["completed", "failed", "error", "cancelled", "interrupted", "idle"].includes(status ?? "");

// Follows promptTitle in packages/client-runtime/src/state/subagentRuntime.ts, which isn't exported.
function promptTitle(prompt: string): string {
  if (prompt.length <= 80) return prompt;
  let end = 77;
  const previous = prompt.charCodeAt(end - 1);
  const next = prompt.charCodeAt(end);
  if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
    end -= 1;
  }
  return `${prompt.slice(0, end)}...`;
}

/**
 * Follows currentSubagent in ThreadRelationshipsControl.tsx: a finished task whose child thread has
 * since run again takes that run's status and times.
 */
function currentAgent(agent: ISubagent, child: IWireThreadShell | undefined): ILineageAgent {
  const own = { Status: agent.status, StartedAt: agent.startedAt, CompletedAt: agent.completedAt };
  if (child === undefined || isOrchestrationV2WorkActive(agent.status)) return own;
  const liveStatus = child.activityRunStatus ?? (child.status === "queued" ? "queued" : null);
  const requestedAt = child.latestRunRequestedAt;
  const newerRun =
    requestedAt != null &&
    Date.parse(requestedAt) > Date.parse(agent.completedAt ?? agent.startedAt ?? agent.updatedAt);
  if (liveStatus === null && !newerRun) return own;
  const status = liveStatus ?? child.status;
  return {
    Status:
      status === "preparing" || status === "starting" || status === "queued"
        ? "pending"
        : status === "rolled_back"
          ? "interrupted"
          : status,
    StartedAt: (liveStatus ? child.activityRunStartedAt : child.latestRunStartedAt) ?? null,
    CompletedAt: liveStatus ? null : (child.latestRunCompletedAt ?? null),
  };
}

const pinRank = (row: ILineageRow) =>
  row.Relation === "parent" || row.Relation === "parentAgent" ? 0 : row.MergeTarget ? 1 : 2;

// Follows orderWebThreadLineageRows, which reads createdAt as a decoded DateTime the wire lacks.
const byPinThenNewest = (left: ILineageRow, right: ILineageRow) =>
  pinRank(left) - pinRank(right) ||
  (left.CreatedAt === right.CreatedAt
    ? left.ThreadId.localeCompare(right.ThreadId)
    : left.CreatedAt === null
      ? 1
      : right.CreatedAt === null
        ? -1
        : right.CreatedAt.localeCompare(left.CreatedAt));

/**
 * The threads related to this one, grouped as ThreadRelationshipsPanel in
 * apps/web/src/components/chat/ThreadRelationshipsControl.tsx groups them, leaving out side chats,
 * workflow groups and the delegated-from row.
 */
export function threadLineage(input: ILineageInput): ILineage {
  const threadId = input.thread.id as ThreadId;
  const shells = new Map(input.shells.map((shell) => [shell.id as string, shell]));
  // The graph reads only lineage, forkedFrom, ids and statuses, which the wire form shares.
  const graph = deriveThreadRelationshipGraph({
    threads: input.shells as never,
    projection: {
      thread: input.thread,
      subagents: input.subagents,
      contextTransfers: input.contextTransfers,
    } as never,
  });
  const agentsByChild = new Map(
    input.subagents.flatMap((agent) =>
      agent.childThreadId === null ? [] : [[agent.childThreadId as string, agent] as const],
    ),
  );
  const mergeTarget = resolveMergeBackTargetThreadId({ thread: input.thread } as never);
  const lookup: string[] = [];

  const toRow = ({ threadId: relatedId, edge }: ThreadRelationshipWalkRow): ILineageRow | null => {
    const shell = shells.get(relatedId);
    const parent = isParentThreadRelationship(edge, threadId);
    if (!parent && shell?.lineage.sideChat === true) return null;
    const agent = edge.kind === "subagent" && !parent ? agentsByChild.get(relatedId) : undefined;
    const ownTitle = agent === undefined ? null : (agent.title ?? promptTitle(agent.prompt));
    if (shell === undefined && (edge.kind !== "subagent" || ownTitle === null)) {
      lookup.push(relatedId);
      if (
        input.titles !== null &&
        !Object.hasOwn(input.titles, relatedId) &&
        edge.kind !== "subagent"
      )
        return null;
    }
    const title = input.titles?.[relatedId] ?? shell?.title ?? ownTitle;
    return {
      ThreadId: relatedId,
      Title: title !== null && edge.kind === "subagent" ? formatSubagentDisplayTitle(title) : title,
      Relation: parent
        ? edge.kind === "subagent"
          ? "parentAgent"
          : "parent"
        : edge.kind === "parent"
          ? "fork"
          : edge.kind,
      Status: threadRelationshipRowStatus(graph, { threadId: relatedId, edge }),
      CreatedAt: shell?.createdAt ?? null,
      MergeTarget: relatedId === mergeTarget,
      Agent: agent === undefined ? null : currentAgent(agent, shell),
      Remote: null,
    };
  };

  const rows = immediateThreadRelationships(graph, threadId)
    .flatMap((row) => toRow(row) ?? [])
    .toSorted(byPinThenNewest);
  const related: ILineageRow[] = [];
  const active: ILineageRow[] = [];
  const previous: ILineageRow[] = [];
  for (const row of rows) {
    if (row.Relation !== "subagent") related.push(row);
    else (isFinishedAgentStatus(row.Status) ? previous : active).push(row);
  }
  for (const agent of input.subagents) {
    if (agent.remoteChild === undefined) continue;
    const title = agent.title ?? agent.remoteChild.title ?? null;
    (isFinishedAgentStatus(agent.status) ? previous : active).push({
      ThreadId: agent.remoteChild.threadId,
      Title: title === null ? null : formatSubagentDisplayTitle(title),
      Relation: "remote",
      Status: agent.status,
      CreatedAt: null,
      MergeTarget: false,
      Agent: null,
      Remote: agent.remoteChild.label,
    });
  }
  const running =
    input.subagents.filter((agent) => agent.childThreadId === null && agent.status === "running")
      .length +
    active.filter((row) => row.Relation === "subagent" && row.Status === "running").length;
  return { Related: related, Active: active, Previous: previous, Running: running, Lookup: lookup };
}

// Follows formatCompactElapsedSeconds in apps/web/src/components/chat/AgentElapsed.tsx.
export function compactElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  if (minutes >= 600) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 6) / 10}h`;
}

// Follows threadRelationshipStatusLabel in apps/web/src/components/chat/ThreadRelationshipIcon.tsx.
export function lineageStatusLabel(status: string | null): string {
  switch (status) {
    case "preparing":
    case "starting":
      return "Starting";
    case "running":
    case "in_progress":
      return "Running";
    case "pending":
    case "queued":
      return "Queued";
    case "waiting":
    case "blocked":
      return "Waiting";
    case "completed":
      return "Done";
    case "failed":
    case "error":
      return "Failed";
    case "cancelled":
    case "interrupted":
      return "Stopped";
    case "rolled_back":
      return "Reverted";
    case "idle":
      return "Idle";
    default:
      return "Unknown";
  }
}
