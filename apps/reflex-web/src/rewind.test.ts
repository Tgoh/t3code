import { describe, expect, it } from "vite-plus/test";

import type { IWireTurnItem } from "./Infrastructure/wire";
import { getDefaultOpenThread, type IOpenThread } from "./OpenThread";
import {
  availableRevertTurnCounts,
  canForkItem,
  findRevertCheckpoint,
  type IRewindWatch,
  revertTurnCounts,
  rewindOutcome,
  rewindWatch,
  rewoundPrompt,
  threadStartAvailable,
  unsettledRunId,
} from "./rewind";
import { assistantItem, commandItem, run, THREAD_ID, thread } from "./testing/threadFixture";

type ICheckpoint = IOpenThread["Checkpoints"][string];

const runId = (ordinal: number) => `run-${ordinal}`;

function userItem(ordinal: number, inputIntent = "turn_start", id = `user-${ordinal}`) {
  return {
    ...commandItem(id, runId(ordinal), ordinal * 2),
    type: "user_message",
    messageId: `message-${id}`,
    text: "user",
    inputIntent,
    attachments: [],
  } as unknown as IWireTurnItem;
}

const turn = (ordinal: number): IWireTurnItem[] => [
  userItem(ordinal),
  assistantItem(`assistant-${ordinal}`, runId(ordinal), ordinal * 2 + 1, "assistant"),
];

function checkpoint(
  ordinal: number,
  status: ICheckpoint["status"] = "ready",
  run = runId(ordinal),
): ICheckpoint {
  return {
    id: `checkpoint-${ordinal}`,
    scopeId: "scope-1",
    runId: run,
    appRunOrdinal: ordinal,
    ordinalWithinScope: ordinal,
    status,
    files: [],
  } as unknown as ICheckpoint;
}

const startCheckpoint = (status: ICheckpoint["status"] = "ready") =>
  ({
    ...checkpoint(0, status),
    id: "checkpoint-start",
    runId: null,
    appRunOrdinal: null,
  }) as unknown as ICheckpoint;

function threadOf(
  items: ReadonlyArray<IWireTurnItem>,
  checkpoints: ReadonlyArray<ICheckpoint>,
  inherited: ReadonlyArray<IWireTurnItem> = [],
): IOpenThread {
  const open = {
    ...getDefaultOpenThread("env-1", THREAD_ID),
    $Id: "open-1",
    Thread: thread(),
  } as IOpenThread;
  for (const item of inherited) {
    open.Timeline.push(item.id);
    open.Rows[item.id] = { visibility: "inherited", sourceThreadId: item.threadId };
    open.InheritedItems[item.id] = item;
  }
  for (const item of items) {
    open.Timeline.push(item.id);
    open.Rows[item.id] = { visibility: "local", sourceThreadId: item.threadId };
    open.TurnItems[item.id] = item;
    if (item.runId !== null && open.Runs[item.runId] === undefined) {
      open.Runs[item.runId] = run(item.runId, Number(item.runId.slice(4)));
    }
  }
  for (const held of checkpoints) open.Checkpoints[held.id] = held;
  return open;
}

function patchThread(open: IOpenThread, patch: Record<string, unknown>): void {
  open.Thread = { ...open.Thread!, ...patch } as IOpenThread["Thread"];
}

const targets = (
  ordinals: ReadonlyArray<number>,
  checkpoints: ReadonlyArray<ICheckpoint>,
  options: { ThreadStart?: boolean; UnsettledRunId?: string | null } = {},
) =>
  revertTurnCounts(threadOf(ordinals.flatMap(turn), checkpoints), {
    ThreadStart: options.ThreadStart ?? true,
    UnsettledRunId: options.UnsettledRunId ?? null,
  });

describe("revertTurnCounts", () => {
  it("assigns run rollback to the turn-start message instead of a later steer", () => {
    const items = [
      userItem(1),
      userItem(1, "steer", "steer-1"),
      assistantItem("assistant-1", runId(1), 3, "Done"),
    ];
    expect(
      revertTurnCounts(threadOf(items, [checkpoint(1)]), {
        ThreadStart: true,
        UnsettledRunId: null,
      }),
    ).toEqual({ "user-1": 0 });
  });

  it("keeps rewound and stopped runs editable at the previous visible checkpoint", () => {
    // Runs 1 and 3 were rewound; run 5 stopped without capturing a checkpoint.
    expect(targets([2, 4, 5], [checkpoint(2), checkpoint(3, "stale"), checkpoint(4)])).toEqual({
      "user-2": 0,
      "user-4": 2,
      "user-5": 4,
    });
    expect(targets([2], [checkpoint(1, "stale")])).toEqual({ "user-2": 0 });
    // Without file snapshots, missing checkpoints still pin the conversation.
    expect(targets([1, 2], [checkpoint(1, "missing"), checkpoint(2, "missing")])).toEqual({
      "user-1": 0,
      "user-2": 1,
    });
  });

  it("preserves a notification-only wake run while ignoring inherited and unrelated work", () => {
    const notification = {
      ...commandItem("wake-item", runId(2), 4),
      type: "notification",
      source: { kind: "delegated_task", taskIds: ["task-1"] },
      outcome: "unknown",
      summary: "Delegated task finished",
    } as unknown as IWireTurnItem;
    const inherited = {
      ...notification,
      id: "inherited-wake",
      threadId: "parent-thread",
      runId: runId(7),
    } as IWireTurnItem;
    const items = [
      ...turn(1),
      notification,
      commandItem("background-work", runId(8), 5),
      ...turn(3),
    ];
    expect(
      revertTurnCounts(
        threadOf(
          items,
          [checkpoint(1), checkpoint(2), checkpoint(3), checkpoint(7), checkpoint(8)],
          [inherited],
        ),
        { ThreadStart: true, UnsettledRunId: null },
      ),
    ).toEqual({ "user-1": 0, "user-3": 2 });
  });

  it("hides edit when the predecessor is unavailable or the run is unsettled", () => {
    expect(targets([1, 2], [checkpoint(2)])).toEqual({ "user-1": 0 });
    expect(targets([1, 2], [checkpoint(1, "stale"), checkpoint(2)])).toEqual({ "user-1": 0 });
    // Earlier history is paged out, so the first loaded run's predecessor is unknown.
    expect(targets([4, 5], [checkpoint(4), checkpoint(5)], { ThreadStart: false })).toEqual({
      "user-5": 4,
    });
    expect(targets([1, 2], [checkpoint(1), checkpoint(2)], { UnsettledRunId: runId(2) })).toEqual({
      "user-1": 0,
    });
  });

  it("can edit a cancelled run but cannot target its checkpoint without a provider turn", () => {
    expect(
      revertTurnCounts(
        threadOf([1, 2, 3].flatMap(turn), [checkpoint(1), checkpoint(2), checkpoint(3)]),
        {
          ThreadStart: true,
          UnsettledRunId: null,
          Available: new Set([0, 1]),
        },
      ),
    ).toEqual({ "user-1": 0, "user-2": 1 });
  });

  it("leaves inherited history uneditable and restores the first local run to thread start", () => {
    const inherited = turn(7).map(
      (item) => ({ ...item, threadId: "parent-thread" }) as IWireTurnItem,
    );
    expect(
      revertTurnCounts(threadOf(turn(2), [checkpoint(7), checkpoint(2)], inherited), {
        ThreadStart: true,
        UnsettledRunId: null,
      }),
    ).toEqual({ "user-2": 0 });
  });

  it("skips a queued message that hasn't started", () => {
    const queued = { ...userItem(2, "queued_turn"), status: "pending" } as IWireTurnItem;
    expect(
      revertTurnCounts(threadOf([...turn(1), queued], [checkpoint(1)]), {
        ThreadStart: true,
        UnsettledRunId: null,
      }),
    ).toEqual({ "user-1": 0 });
  });
});

describe("findRevertCheckpoint", () => {
  it("finds the thread start or the run's latest rewindable checkpoint", () => {
    const later = { ...checkpoint(1), id: "checkpoint-1b" } as ICheckpoint;
    const checkpoints = [startCheckpoint(), checkpoint(1), later, checkpoint(2, "error")];
    expect(findRevertCheckpoint(checkpoints, 0)?.id).toBe("checkpoint-start");
    expect(findRevertCheckpoint(checkpoints, 1)?.id).toBe("checkpoint-1b");
    expect(findRevertCheckpoint(checkpoints, 2)).toBeUndefined();
    expect(findRevertCheckpoint([startCheckpoint("missing")], 0)?.id).toBe("checkpoint-start");
  });
});

describe("threadStartAvailable", () => {
  it("needs a thread-start checkpoint and the whole history loaded", () => {
    const open = threadOf(turn(1), [startCheckpoint(), checkpoint(1)]);
    expect(threadStartAvailable(open)).toBe(true);
    open.History = { $Id: "window", ThreadId: THREAD_ID, Cursor: "c", HasMore: true } as never;
    expect(threadStartAvailable(open)).toBe(false);
    expect(threadStartAvailable(threadOf(turn(1), [checkpoint(1)]))).toBe(false);
  });
});

describe("unsettledRunId", () => {
  it("names the newest run until it completes", () => {
    const open = threadOf(turn(1), []);
    expect(unsettledRunId(open)).toBeNull();
    open.Runs[runId(2)] = { ...run(runId(2), 2, "running"), completedAt: null };
    expect(unsettledRunId(open)).toBe(runId(2));
    open.Runs[runId(2)] = run(runId(2), 2, "interrupted");
    expect(unsettledRunId(open)).toBeNull();
  });
});

describe("availableRevertTurnCounts", () => {
  const providerThreadId = "provider-thread";

  function projection(providerSessionId: string | null): IOpenThread {
    const open = threadOf([], []);
    patchThread(open, { activeProviderThreadId: providerThreadId });
    open.ProviderThreads[providerThreadId] = {
      id: providerThreadId,
      providerInstanceId: open.Thread!.modelSelection.instanceId,
      providerSessionId,
    } as never;
    for (const ordinal of [1, 2, 3]) {
      open.Runs[runId(ordinal)] = {
        ...run(runId(ordinal), ordinal),
        activeAttemptId: `attempt-${ordinal}`,
      } as never;
      open.Attempts[`attempt-${ordinal}`] = {
        id: `attempt-${ordinal}`,
        providerTurnId: null,
      } as never;
    }
    const providerTurn = (ordinal: number, attempt: number, threadId: string) => {
      const id = `turn-${attempt}-${ordinal}`;
      open.ProviderTurns[id] = {
        id,
        runAttemptId: `attempt-${attempt}`,
        ordinal,
        providerThreadId: threadId,
      } as never;
    };
    // Run 2's latest turn moved to another provider thread, so its checkpoint cannot restore
    // this conversation.
    providerTurn(1, 1, providerThreadId);
    providerTurn(1, 2, providerThreadId);
    providerTurn(2, 2, "other-provider-thread");
    providerTurn(1, 3, providerThreadId);
    return open;
  }

  it("offers the thread start and runs whose latest turn is on the active provider thread", () => {
    expect([...availableRevertTurnCounts(projection("session"))].toSorted()).toEqual([0, 1, 3]);
  });

  it("offers nothing without a provider session to rewind", () => {
    expect(availableRevertTurnCounts(projection(null)).size).toBe(0);
  });
});

describe("rewind landing", () => {
  function rewound(): { open: IOpenThread; watch: IRewindWatch } {
    const open = threadOf([...turn(1), ...turn(2)], [checkpoint(1), checkpoint(2)]);
    patchThread(open, { activeProviderThreadId: "provider-thread" });
    open.ProviderThreads["provider-thread"] = {
      id: "provider-thread",
      providerInstanceId: "codex",
      appThreadId: THREAD_ID,
      ownerNodeId: null,
      lastRunOrdinal: 2,
    } as never;
    const watch = rewindWatch(open, 1, "command-1");
    if (watch === null) throw new Error("Expected a settled run past the target.");
    return { open, watch };
  }

  it("waits for the witness run to roll back and the provider thread to reach the target", () => {
    const { open, watch } = rewound();
    expect(watch.WitnessRunId).toBe(runId(2));
    expect(rewindOutcome(open, watch)).toBeNull();
    open.Runs[runId(2)]!.status = "rolled_back";
    expect(rewindOutcome(open, watch)).toBeNull();
    open.ProviderThreads["provider-thread"]!.lastRunOrdinal = 1;
    expect(rewindOutcome(open, watch)).toEqual({ Done: true });
  });

  it("reports this rewind's failure and ignores another's", () => {
    const { open, watch } = rewound();
    patchThread(open, { rollbackFailure: { requestId: "command-0", message: "Older failure" } });
    expect(rewindOutcome(open, watch)).toBeNull();
    patchThread(open, {
      rollbackFailure: { requestId: "command-1", message: "Provider refused" },
    });
    expect(rewindOutcome(open, watch)).toEqual({ Error: "Provider refused" });
  });

  it("accepts the fresh root session Claude starts when rewinding to thread start", () => {
    const open = threadOf(turn(1), [startCheckpoint(), checkpoint(1)]);
    patchThread(open, { activeProviderThreadId: "provider-old" });
    open.ProviderThreads["provider-old"] = {
      id: "provider-old",
      providerInstanceId: "claude",
      appThreadId: THREAD_ID,
      ownerNodeId: null,
      lastRunOrdinal: 1,
    } as never;
    const watch = rewindWatch(open, 0, "command-1")!;
    open.Runs[runId(1)]!.status = "rolled_back";
    open.ProviderThreads["provider-new"] = {
      id: "provider-new",
      providerInstanceId: "claude",
      appThreadId: THREAD_ID,
      ownerNodeId: null,
      lastRunOrdinal: null,
    } as never;
    expect(rewindOutcome(open, watch)).toEqual({ Done: true });
  });

  it("has nothing to watch when no settled run follows the target", () => {
    const open = threadOf(turn(1), [checkpoint(1)]);
    expect(rewindWatch(open, 1, "command-1")).toBeNull();
  });
});

describe("rewoundPrompt", () => {
  it("appends the restored message to what the composer holds", () => {
    expect(rewoundPrompt("", "Fix it")).toBe("Fix it");
    expect(rewoundPrompt("Draft", "Fix it")).toBe("Draft\n\nFix it");
    expect(rewoundPrompt("Draft", "")).toBe("Draft");
  });
});

describe("canForkItem", () => {
  const capabilities = (fork: boolean) => ({
    threads: { canForkThread: fork, canForkFromTurn: fork },
    identity: { nativeThreadIds: fork ? "strong" : "none" },
    context: { supportsFullThreadHandoff: false },
  });

  function forkable(sessionCapabilities: unknown) {
    const open = threadOf(turn(1), []);
    const item = {
      ...open.TurnItems["assistant-1"]!,
      providerThreadId: "provider-thread",
    } as IWireTurnItem;
    open.TurnItems[item.id] = item;
    open.ProviderThreads["provider-thread"] = {
      id: "provider-thread",
      providerSessionId: "session",
    } as never;
    if (sessionCapabilities !== undefined) {
      open.ProviderSessions.session = { id: "session", capabilities: sessionCapabilities } as never;
    }
    return { open, item };
  }

  it("follows the provider's fork capabilities, and allows it when they are unknown", () => {
    const capable = forkable(capabilities(true));
    expect(canForkItem(capable.open, capable.item)).toBe(true);
    const incapable = forkable(capabilities(false));
    expect(canForkItem(incapable.open, incapable.item)).toBe(false);
    const unknown = forkable(undefined);
    expect(canForkItem(unknown.open, unknown.item)).toBe(true);
  });

  it("refuses an unfinished reply or a user message", () => {
    const { open, item } = forkable(undefined);
    expect(canForkItem(open, { ...item, status: "running" } as IWireTurnItem)).toBe(false);
    expect(canForkItem(open, open.TurnItems["user-1"]!)).toBe(false);
  });
});
