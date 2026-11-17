import {
  deriveThreadRelationshipGraph,
  immediateThreadRelationships,
  isParentThreadRelationship,
  threadRelationshipRowStatus,
} from "@t3tools/client-runtime/state/thread-relationships";
import type { ThreadId } from "@t3tools/contracts";

import type { IWireProjection, IWireThreadShell } from "./Infrastructure/wire";

export interface ILineageRow {
  ThreadId: string;
  /** Null for a thread the shell doesn't carry, such as an older settled parent. */
  Title: string | null;
  Parent: boolean;
  Status: string | null;
  CreatedAt: string;
}

/**
 * The parent this thread was forked from and the forks taken from it, parent first, then newest.
 * Follows ThreadRelationshipsPanel in apps/web/src/components/chat/ThreadRelationshipsControl.tsx,
 * leaving out subagents, context transfers and side chats.
 */
export function forkLineage(
  thread: IWireProjection["thread"],
  shells: ReadonlyArray<IWireThreadShell>,
): ILineageRow[] {
  const threadId = thread.id as ThreadId;
  // The graph reads only lineage, forkedFrom, ids and statuses, which the wire form shares.
  const graph = deriveThreadRelationshipGraph({
    threads: shells as never,
    projection: { thread, subagents: [], contextTransfers: [] } as never,
  });
  return immediateThreadRelationships(graph, threadId)
    .filter((row) => row.edge.kind === "fork")
    .flatMap((row) => {
      const shell = graph.nodes.get(row.threadId)?.thread as IWireThreadShell | null | undefined;
      const parent = isParentThreadRelationship(row.edge, threadId);
      if (!parent && shell?.lineage.sideChat === true) return [];
      return [
        {
          ThreadId: row.threadId,
          Title: shell?.title ?? null,
          Parent: parent,
          Status: threadRelationshipRowStatus(graph, row),
          CreatedAt: shell?.createdAt ?? "",
        },
      ];
    })
    .toSorted(
      (left, right) =>
        Number(right.Parent) - Number(left.Parent) || right.CreatedAt.localeCompare(left.CreatedAt),
    );
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
