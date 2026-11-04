import type {
  IWireProjection,
  IWireThreadEvent,
  IWireThreadSnapshot,
  IWireTurnItem,
} from "../Infrastructure/wire";

export const THREAD_ID = "thread-1";
const AT = "2026-06-20T00:00:00.000Z";
const MODEL = { instanceId: "codex", model: "gpt-5.4" };

export function thread(id = THREAD_ID): IWireProjection["thread"] {
  return {
    id,
    projectId: "project-1",
    title: "Fixture",
    providerInstanceId: "codex",
    modelSelection: MODEL,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: id, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    createdAt: AT,
    updatedAt: AT,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  } as unknown as IWireProjection["thread"];
}

export function run(id: string, ordinal: number, status = "completed") {
  return {
    id,
    threadId: THREAD_ID,
    ordinal,
    providerInstanceId: "codex",
    modelSelection: MODEL,
    providerThreadId: null,
    userMessageId: `message-${id}`,
    rootNodeId: null,
    activeAttemptId: null,
    status,
    requestedAt: AT,
    startedAt: AT,
    completedAt: AT,
    checkpointId: null,
    contextHandoffId: null,
  } as unknown as IWireProjection["runs"][number];
}

export function message(id: string, runId: string, text: string, streaming = false) {
  return {
    id,
    threadId: THREAD_ID,
    runId,
    nodeId: null,
    role: "assistant",
    text,
    attachments: [],
    streaming,
    createdBy: "agent",
    creationSource: "provider",
    createdAt: AT,
    updatedAt: AT,
  } as unknown as IWireProjection["messages"][number];
}

function base(id: string, runId: string | null, ordinal: number) {
  return {
    id,
    threadId: THREAD_ID,
    runId,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed",
    title: null,
    startedAt: AT,
    completedAt: AT,
    updatedAt: AT,
  };
}

export function assistantItem(
  id: string,
  runId: string | null,
  ordinal: number,
  text: string,
  messageId = `message-${id}`,
  streaming = false,
): IWireTurnItem {
  return {
    ...base(id, runId, ordinal),
    type: "assistant_message",
    messageId,
    text,
    streaming,
  } as unknown as IWireTurnItem;
}

export function commandItem(
  id: string,
  runId: string | null,
  ordinal: number,
  input = "pnpm test",
): IWireTurnItem {
  return {
    ...base(id, runId, ordinal),
    type: "command_execution",
    input,
    exitCode: 0,
  } as unknown as IWireTurnItem;
}

export function localRow(item: IWireTurnItem, position: number) {
  return {
    position,
    visibility: "local" as const,
    sourceThreadId: item.threadId,
    sourceItemId: item.id,
    item,
  };
}

export function emptyProjection(): IWireProjection {
  return {
    thread: thread(),
    runs: [],
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [],
    plans: [],
    turnItems: [],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
    updatedAt: AT,
  };
}

const BODY = "The quick brown fox jumps over the lazy dog. ".repeat(12);

/** Turns of one user-visible assistant message and two commands, with `items` turn items in all. */
export function longThread(items: number): IWireProjection {
  const projection = emptyProjection();
  const turns = Math.ceil(items / 3);
  let ordinal = 0;
  for (let turn = 0; turn < turns && ordinal < items; turn += 1) {
    const runId = `run-${turn}`;
    projection.runs.push(run(runId, turn + 1));
    const messageId = `message-${turn}`;
    projection.messages.push(message(messageId, runId, BODY));
    const inTurn: IWireTurnItem[] = [
      assistantItem(`item-${ordinal}`, runId, ordinal, BODY, messageId),
      commandItem(`item-${ordinal + 1}`, runId, ordinal + 1),
      commandItem(`item-${ordinal + 2}`, runId, ordinal + 2),
    ];
    for (const item of inTurn) {
      if (ordinal >= items) break;
      projection.turnItems.push(item);
      projection.visibleTurnItems.push(localRow(item, ordinal));
      ordinal += 1;
    }
  }
  return projection;
}

export function snapshotOf(projection: IWireProjection, snapshotSequence: number) {
  return { kind: "snapshot", snapshotSequence, projection } as IWireThreadSnapshot;
}

export function event(
  type: IWireThreadEvent["type"],
  payload: unknown,
  occurredAt = AT,
): IWireThreadEvent {
  return {
    id: `event-${type}`,
    type,
    threadId: THREAD_ID,
    occurredAt,
    payload,
  } as IWireThreadEvent;
}
