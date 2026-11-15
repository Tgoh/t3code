import { applyOrchestrationV2ProjectionEvent } from "@t3tools/client-runtime/state/orchestration-v2-projection";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { createEffect, createMemo, createRoot } from "solid-js";
import { createTestRuntime, EntityReplacedError, type IActionGenerator, settled } from "treflex";
import { describe, expect, it } from "vite-plus/test";

import {
  closeThread,
  EnvironmentReceiver,
  type IEnvironment,
  loadProviders,
  newThread,
  openThread,
  projectCommand,
  selectThread,
  threadCommand,
} from "./Environment";
import { loadEarlier, loadingEarlier } from "./HistoryWindow";
import type { ITerminalLaunch } from "./Infrastructure/terminalMemory";
import { threadHistoryPage } from "./Infrastructure/threadHistory";
import type {
  IWireHistoryPage,
  IWireShellItem,
  IWireThreadItem,
  IWireTurnItem,
} from "./Infrastructure/wire";
import { parseDiff } from "./diffView";
import { assistantHtml, containsHtml, createMarkdownLexer } from "./markdownTokens";
import type {
  IQueueCommand,
  IRespondRequest,
  IStartTurn,
  IStopThread,
  IThreadCommand,
  IThreadDiff,
} from "./Infrastructure/commandEffects";
import {
  diffTurnOf,
  fileChangeCounts,
  type IOpenThread,
  isRowVisible,
  latestDiffTurn,
  latestRun,
  pendingApprovalIds,
  pendingRequest,
  ThreadReceiver,
  threadSynchronized,
  timelineEntries,
  timelineIds,
} from "./OpenThread";
import { dismissFailure, getDefaultRoot, type IRoot, load, RootReceiver } from "./Root";
import { answering, answerRequest, canAnswer, type IRuntimeRequest } from "./RuntimeRequest";
import {
  canSnooze,
  projectFolders,
  ShellReceiver,
  sidebarSections,
  sidebarStatus,
  sidebarThreads,
  subagentRequests,
  workingStartedAt,
} from "./Shell";
import {
  closeDiff,
  diffLoading,
  closeTerminal,
  effectiveModel,
  ending,
  endTerminal,
  type IThreadSession,
  openDiff,
  openTerminal,
  queueAction,
  queueing,
  questionAnswers,
  send,
  sending,
  setDraft,
  setQuestionAnswer,
  stopping,
  stopRun,
  terminalAttachment,
  TerminalReceiver,
} from "./ThreadSession";
import {
  assistantItem,
  commandItem,
  emptyProjection,
  event,
  localRow,
  longThread,
  message,
  run,
  snapshotOf,
  THREAD_ID,
} from "./testing/threadFixture";
import { reconcile } from "./rows";

const ENV = "env-1";

async function connect(
  historyPage?: (cursor: string) => Promise<IWireHistoryPage>,
  initialAddress: string | null = null,
  commands: Record<string, (effect: never) => unknown> = {},
) {
  const address = { thread: initialAddress };
  const terminals = new Map<string, ITerminalLaunch>();
  let guid = 0;
  const runtime = createTestRuntime<IRoot>(
    getDefaultRoot("Root"),
    {
      environmentInfo: () => ({ Authenticated: true, EnvironmentId: ENV, Label: "Test" }),
      serverProviders: () => [
        {
          InstanceId: "devReplay",
          Name: "Replay",
          Models: [{ Slug: "showcase", Name: "Showcase", IsDefault: true }],
        },
      ],
      generateGuid: () => `guid-${(guid += 1)}`,
      ...commands,
      threadHistoryPage: (effect: { Cursor: string }) => historyPage!(effect.Cursor),
      addressThread: () => address.thread,
      setAddressThread: (effect: { ThreadId: string | null }) => {
        address.thread = effect.ThreadId;
      },
      rememberedTerminal: (effect: { ThreadId: string }) => terminals.get(effect.ThreadId) ?? null,
      rememberTerminal: (effect: { ThreadId: string; Launch: ITerminalLaunch | null }) => {
        if (effect.Launch === null) terminals.delete(effect.ThreadId);
        else terminals.set(effect.ThreadId, effect.Launch);
      },
    },
    { onError: (error) => console.error("action failed:", error) },
  );
  runtime.registerReceiver(RootReceiver);
  runtime.registerReceiver(EnvironmentReceiver);
  runtime.registerReceiver(ShellReceiver);
  runtime.registerReceiver(ThreadReceiver);
  runtime.registerReceiver(TerminalReceiver);
  await runtime.dispatch(load, "Root");
  await settled();
  const environment = () => runtime.state.Environments[0] as IEnvironment;
  expect(environment().Replica.Providers).toHaveLength(1);
  if (initialAddress !== null) expect(address.thread).toBe(initialAddress);
  else expect(runtime.resources().some((row) => row.Key === "Shell/Stream")).toBe(true);
  const session = (threadId = THREAD_ID) =>
    environment().Local.ThreadSessions[threadId] as IThreadSession;
  const thread = () => environment().Replica.OpenThreads[THREAD_ID] as IOpenThread;
  const envId = () => environment().$Id;
  const openId = () => thread().$Id;
  const shellId = () => environment().Replica.Shell.$Id;
  return {
    runtime,
    address,
    terminals,
    environment,
    session,
    thread,
    envId,
    sessionId: (threadId = THREAD_ID) => session(threadId).$Id,
    openId,
    shellId,
    open: () => runtime.dispatch(openThread, envId(), THREAD_ID),
    sendThread: (Item: IWireThreadItem) =>
      runtime.dispatch(
        ThreadReceiver.handle,
        openId(),
        { Type: "Thread/Stream", Item },
        { publisher: { Id: openId() } },
      ),
    sendShell: (Item: IWireShellItem) =>
      runtime.dispatch(
        ShellReceiver.handle,
        shellId(),
        { Type: "Shell/Stream", Item },
        { publisher: { Id: shellId() } },
      ),
    disposed: (id: string) =>
      new Promise<void>((resolve) => {
        runtime.on("record", (record) => {
          if (record.Kind === "entity:dispose" && record.EntityId === id) resolve();
        });
      }),
  };
}

function projectionOf(thread: IOpenThread) {
  return {
    thread: thread.Thread,
    runs: sorted(Object.values(thread.Runs)),
    messages: sorted(Object.values(thread.Messages)),
    turnItems: sorted(Object.values(thread.TurnItems)),
    providerTurns: sorted(Object.values(thread.ProviderTurns)),
    rows: timelineEntries(thread),
  };
}

const sorted = <T extends { id: string }>(rows: T[]) =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id));

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe("thread events", () => {
  it("matches the immutable reducer over a run's worth of events", async () => {
    const server = await connect();
    await server.open();
    const first = assistantItem("a-1", "run-1", 1, "one", "m-1");
    const start = {
      ...emptyProjection(),
      runs: [run("run-1", 1)],
      messages: [message("m-1", "run-1", "one")],
      turnItems: [first],
      visibleTurnItems: [localRow(first, 0)],
    };
    await server.sendThread(snapshotOf(copy(start), 1));

    const providerTurn = { id: "pt-1", status: "running", tokenUsage: { usedTokens: 5 } };
    const events = [
      event("run.created", run("run-2", 2, "running"), "2026-06-20T01:00:00.000Z"),
      event("message.updated", message("m-2", "run-2", "he", true)),
      event("turn-item.updated", assistantItem("a-2", "run-2", 4, "he", "m-2", true)),
      event("message.updated", message("m-2", "run-2", "hello", true)),
      event("turn-item.updated", {
        ...assistantItem("a-2", "run-2", 4, "", "m-2", true),
        textOmitted: true,
      }),
      event("turn-item.updated", commandItem("c-1", "run-2", 3)),
      event("turn-item.updated", commandItem("c-2", "run-2", 4)),
      event("turn-item.updated", commandItem("c-1", "run-2", 9)),
      event("provider-turn.updated", providerTurn),
      event("provider-turn.updated", { id: "pt-1", status: "completed" }),
      event("thread.visited", { ...start.thread, title: "Visited" }, "2026-06-20T09:00:00.000Z"),
      event("run.updated", run("run-2", 2, "rolled_back")),
      event("turn-item.updated", commandItem("c-3", "run-2", 10)),
      event("turn-item.updated", commandItem("c-4", "run-1", 2)),
      event("run.created", run("run-3", 3, "cancelled")),
      event("turn-item.updated", {
        ...commandItem("queued", "run-3", 11),
        type: "user_message",
        inputIntent: "queued_turn",
        text: "never sent",
        attachments: [],
      }),
      event("run.created", run("run-4", 4, "running")),
      event("turn-item.updated", {
        ...commandItem("interrupted", "run-4", 12),
        type: "run_interrupt_result",
        nodeId: "node-4",
        message: "stopped",
      }),
      event("run-attempt.created", {
        id: "attempt-4",
        runId: "run-4",
        rootNodeId: "node-4",
        status: "running",
      }),
      event("run-attempt.updated", {
        id: "attempt-4",
        runId: "run-4",
        rootNodeId: "node-4",
        status: "superseded",
      }),
      event("run.created", run("run-5", 5, "running")),
      event("turn-item.updated", {
        ...commandItem("request", "run-5", 13),
        type: "run_interrupt_request",
        message: "stop",
      }),
      event("turn-item.updated", {
        ...commandItem("paired", "run-5", 14),
        type: "run_interrupt_result",
        nodeId: "node-5",
        message: "stopped",
      }),
      event("run-attempt.created", {
        id: "attempt-5",
        runId: "run-5",
        rootNodeId: "node-5",
        status: "superseded",
      }),
    ];

    let expected = copy(start) as unknown as OrchestrationV2ThreadProjection;
    let sequence = 1;
    for (const next of events) {
      expected = applyOrchestrationV2ProjectionEvent(expected, copy(next) as never)!;
      sequence += 1;
      await server.sendThread({ kind: "event", sequence, event: copy(next) } as IWireThreadItem);
      const wire = expected as unknown as typeof start;
      expect(copy(projectionOf(server.thread()))).toEqual(
        copy({
          thread: wire.thread,
          runs: sorted(wire.runs),
          messages: sorted(wire.messages),
          turnItems: sorted(wire.turnItems),
          providerTurns: sorted((expected.providerTurns as unknown as { id: string }[]) ?? []),
          rows: wire.visibleTurnItems.map(
            ({ position, visibility, sourceThreadId, sourceItemId, item }) => ({
              position,
              sourceItemId,
              visibility,
              sourceThreadId,
              item,
            }),
          ),
        }),
      );
    }
  });

  it("applies the visibility rule per row, so a hidden row comes back when the rule allows", async () => {
    const server = await connect();
    await server.open();
    const result = {
      ...commandItem("result", "run-1", 1),
      type: "run_interrupt_result",
      nodeId: "node-1",
      message: "stopped",
    };
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runs: [run("run-1", 1), run("run-2", 2)],
          attempts: [{ id: "attempt", runId: "run-1", rootNodeId: "node-1", status: "superseded" }],
        } as never,
        1,
      ),
    );
    const send = (sequence: number, type: IWireThreadItem["kind"] | string, payload: unknown) =>
      server.sendThread({
        kind: "event",
        sequence,
        event: event(type as never, payload),
      } as IWireThreadItem);
    await send(2, "turn-item.updated", result);
    await send(3, "turn-item.updated", commandItem("command", "run-2", 2));
    expect(server.thread().Timeline).toEqual(["result", "command"]);
    expect(isRowVisible(server.thread(), "result")).toBe(false);
    expect(isRowVisible(server.thread(), "command")).toBe(true);

    await send(4, "turn-item.updated", {
      ...commandItem("request", "run-1", 3),
      type: "run_interrupt_request",
      message: "stop",
    });
    expect(isRowVisible(server.thread(), "result")).toBe(true);

    await send(5, "run.updated", run("run-2", 2, "rolled_back"));
    expect(isRowVisible(server.thread(), "command")).toBe(false);
    await send(6, "run.updated", run("run-2", 2, "completed"));
    expect(isRowVisible(server.thread(), "command")).toBe(true);
  });

  it("drops a live update to history outside a bounded window", async () => {
    const server = await connect();
    await server.open();
    const held = commandItem("c-5", "run-1", 5);
    const item = {
      ...snapshotOf(
        {
          ...emptyProjection(),
          runs: [run("run-1", 1)],
          turnItems: [held],
          visibleTurnItems: [localRow(held, 0)],
        },
        1,
      ),
      historyCursor: "older",
      hasMoreHistory: true,
      latestLocalTurnOrdinal: 5,
    };
    await server.sendThread(item);
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("turn-item.updated", commandItem("c-2", "run-1", 2)),
    } as IWireThreadItem);
    expect(server.thread().TurnItems["c-2"]).toBeUndefined();
    expect(server.thread().Timeline).toEqual(["c-5"]);
  });

  it("carries turn items as a union: a new type's fields replace the old type's", async () => {
    const server = await connect();
    await server.open();
    const before = assistantItem("x", "run-1", 1, "text");
    await server.sendThread(snapshotOf({ ...emptyProjection(), turnItems: [before] }, 1));
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("turn-item.updated", commandItem("x", "run-1", 1)),
    } as IWireThreadItem);
    const after = server.thread().TurnItems["x"]!;
    expect(after.type).toBe("command_execution");
    expect("text" in after).toBe(false);
  });

  it("a delta re-runs only the reads of what it changed", async () => {
    const server = await connect();
    await server.open();
    await server.sendThread(snapshotOf(longThread(9), 1));
    const thread = server.thread();
    const runs = { changed: 0, other: 0, selector: 0, ids: 0 };
    const dispose = createRoot((disposeRoot) => {
      createEffect(() => {
        runs.selector += 1;
        timelineEntries(thread);
      });
      createEffect(() => {
        runs.ids += 1;
        server.runtime.processSelector(timelineIds, () => thread);
      });
      createEffect(() => {
        runs.changed += 1;
        void (thread.TurnItems["item-6"] as { text?: string }).text;
      });
      createEffect(() => {
        runs.other += 1;
        void (thread.TurnItems["item-0"] as { text?: string }).text;
      });
      return disposeRoot;
    });
    expect(runs).toEqual({ changed: 1, other: 1, selector: 1, ids: 1 });
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event(
        "turn-item.updated",
        assistantItem("item-6", "run-2", 6, "changed", "message-2"),
      ),
    } as IWireThreadItem);
    await Promise.resolve();
    expect(runs).toEqual({ changed: 2, other: 1, selector: 1, ids: 1 });
    dispose();
  });
});

describe("random event traces", () => {
  const RUNS = ["r1", "r2", "r3"];
  const ITEMS = ["i1", "i2", "i3", "i4", "i5", "i6", "i7", "i8"];
  const TERMINAL_RUN = ["completed", "rolled_back", "cancelled"];

  const randomOf = (seed: number) => {
    let state = seed >>> 0;
    return (limit: number) => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return Math.floor((state / 2 ** 32) * limit);
    };
  };

  // Statuses only move forward and a request never follows a superseded attempt, because this client
  // deliberately brings a row back in those cases where the reducer has already dropped it.
  function randomEvent(
    pick: (limit: number) => number,
    ended: Set<string>,
    superseded: Set<string>,
    canHide: boolean,
  ) {
    const runId = RUNS[pick(RUNS.length)]!;
    const kind = pick(7);
    if (kind === 0 && !ended.has(runId)) {
      const statuses = canHide ? ["running", "waiting", ...TERMINAL_RUN] : ["running", "completed"];
      const status = statuses[pick(statuses.length)]!;
      if (TERMINAL_RUN.includes(status)) ended.add(runId);
      return event("run.updated", run(runId, RUNS.indexOf(runId) + 1, status));
    }
    if (kind === 1 && canHide && !superseded.has(runId)) {
      const status = ["running", "superseded"][pick(2)]!;
      if (status === "superseded") superseded.add(runId);
      return event("run-attempt.updated", {
        id: `a-${runId}`,
        runId,
        rootNodeId: `n-${runId}`,
        status,
      });
    }
    if (kind === 2 && !superseded.has(runId)) {
      return event("turn-item.updated", {
        ...commandItem(`request-${runId}`, runId, 40 + pick(5)),
        type: "run_interrupt_request",
        message: "stop",
      });
    }
    const id = ITEMS[pick(ITEMS.length)]!;
    const itemRun = pick(6) === 0 ? null : runId;
    const base = commandItem(id, itemRun, 10 + pick(25), `v${pick(1000)}`);
    const variant = pick(5);
    if (variant === 0) {
      return event("turn-item.updated", {
        ...base,
        type: "run_interrupt_result",
        message: "stopped",
        nodeId: `n-${itemRun}`,
      });
    }
    if (variant === 1) {
      return event("turn-item.updated", {
        ...base,
        type: "user_message",
        text: "hi",
        messageId: `m-${id}`,
        inputIntent: "queued_turn",
        attachments: [],
      });
    }
    return event("turn-item.updated", base);
  }

  const rowOf = (row: {
    sourceItemId: string;
    visibility: string;
    item: { ordinal: number; type: string };
  }) => [row.sourceItemId, row.visibility, row.item.ordinal, row.item.type];

  async function runTrace(seed: number, partial: boolean) {
    const pick = randomOf(seed);
    const server = await connect();
    await server.open();
    const seedItem = commandItem("i0", "r1", 20);
    const inherited = { ...commandItem("p1", "r0", 1), threadId: "parent" } as IWireTurnItem;
    const start = {
      ...emptyProjection(),
      runs: [run("r1", 1, "running"), run("r2", 2, "running"), run("r3", 3, "running")],
      turnItems: [seedItem],
      visibleTurnItems: [
        { ...localRow(inherited, 0), visibility: "inherited" as const },
        localRow(seedItem, 1),
      ],
    };
    await server.sendThread({
      ...snapshotOf(copy(start), 1),
      ...(partial ? { historyCursor: "c0", hasMoreHistory: true, latestLocalTurnOrdinal: 20 } : {}),
    });
    let expected = copy(start) as unknown as OrchestrationV2ThreadProjection;
    const { ids, dispose } = createRoot((disposeRoot) => ({
      ids: createMemo(() => server.runtime.processSelector(timelineIds, () => server.thread())),
      dispose: disposeRoot,
    }));
    let watermark: number | null = 20;
    const ended = new Set<string>();
    const superseded = new Set<string>();
    for (let step = 0; step < 40; step += 1) {
      const next = randomEvent(pick, ended, superseded, !partial);
      const before = expected;
      expected = applyOrchestrationV2ProjectionEvent(
        expected,
        copy(next) as never,
        partial ? { partialTimeline: true, latestLocalTurnOrdinal: watermark } : undefined,
      )!;
      if (partial && next.type === "turn-item.updated" && expected !== before) {
        watermark = Math.max(watermark ?? 0, (next.payload as { ordinal: number }).ordinal);
      }
      await server.sendThread({
        kind: "event",
        sequence: step + 2,
        event: copy(next),
      } as IWireThreadItem);
      const context = `seed ${seed}, partial ${partial}, step ${step}, ${next.type}`;
      expect(copy(timelineEntries(server.thread()).map(rowOf)), context).toEqual(
        copy((expected.visibleTurnItems as unknown as Parameters<typeof rowOf>[0][]).map(rowOf)),
      );
      expect(ids(), context).toEqual([...server.thread().Timeline]);
    }
    const orders = [
      ["a", "b", "c"],
      ["c", "a", "b"],
      ["c", "a", "d"],
    ];
    for (const [index, order] of orders.entries()) {
      const items = order.map((id, ordinal) => commandItem(id, "r1", ordinal));
      await server.sendThread(
        snapshotOf(
          copy({
            ...start,
            turnItems: items,
            visibleTurnItems: items.map((item, position) => localRow(item, position)),
          }),
          100 + index,
        ),
      );
      expect(server.thread().Timeline).toEqual(order);
      expect(ids(), `seed ${seed}, partial ${partial}, snapshot ${order}`).toEqual(order);
    }
    dispose();
  }

  it("match the immutable reducer", async () => {
    for (const partial of [false, true]) {
      for (let seed = 1; seed <= 15; seed += 1) await runTrace(seed, partial);
    }
  });

  it("keep a row in a partial window that the reducer loses after hiding it", async () => {
    const server = await connect();
    await server.open();
    const item = commandItem("x", "r1", 24);
    const start = {
      ...emptyProjection(),
      runs: [run("r1", 1, "running"), run("r2", 2, "completed")],
      turnItems: [item],
      visibleTurnItems: [localRow(item, 0)],
    };
    await server.sendThread({
      ...snapshotOf(copy(start), 1),
      historyCursor: "c0",
      hasMoreHistory: true,
      latestLocalTurnOrdinal: 30,
    });
    let expected = copy(start) as unknown as OrchestrationV2ThreadProjection;
    const events = [
      event("run.updated", run("r1", 1, "rolled_back")),
      event("turn-item.updated", commandItem("x", "r2", 24)),
    ];
    for (const [index, next] of events.entries()) {
      expected = applyOrchestrationV2ProjectionEvent(expected, copy(next) as never, {
        partialTimeline: true,
        latestLocalTurnOrdinal: 30,
      })!;
      await server.sendThread({
        kind: "event",
        sequence: index + 2,
        event: copy(next),
      } as IWireThreadItem);
    }
    expect(expected.visibleTurnItems).toEqual([]);
    expect(timelineEntries(server.thread()).map((row) => row.sourceItemId)).toEqual(["x"]);
  });
});

describe("markdown", () => {
  it("keeps the tokens of unchanged blocks across a delta", () => {
    const lex = createMarkdownLexer(false);
    const first = lex("One para.\n\nTwo\n\n- item");
    const second = lex("One para.\n\nTwo more\n\n- item");
    expect(second.Blocks.map((token) => token.type)).toEqual(["paragraph", "paragraph", "list"]);
    expect(second.Blocks[0]).toBe(first.Blocks[0]);
    expect(second.Blocks[1]).not.toBe(first.Blocks[1]);
    expect(second.Blocks[2]).toBe(first.Blocks[2]);
  });

  it("finds raw HTML anywhere in a block, and only an assistant's block-level HTML spans blocks", () => {
    const lex = createMarkdownLexer(false);
    expect(containsHtml(lex("Press <kbd>x</kbd> now").Blocks[0]!)).toBe(true);
    expect(containsHtml(lex("- a <b>list</b>").Blocks[0]!)).toBe(true);
    expect(containsHtml(lex("| h |\n| - |\n| <i>c</i> |").Blocks[0]!)).toBe(true);
    expect(containsHtml(lex("`<b>` is code").Blocks[0]!)).toBe(false);
    expect(lex("Press <kbd>x</kbd> now").WholeHtml).toBeNull();
    expect(lex("<details>\n\nbody\n\n</details>").WholeHtml).not.toBeNull();
    expect(createMarkdownLexer(true)("<details>\n\nbody\n\n</details>").WholeHtml).toBeNull();
  });

  it("escapes a raw-text tag in an assistant's HTML, so it can't swallow what follows", () => {
    const { Blocks } = createMarkdownLexer(false)("Mention of <style> in prose");
    expect(assistantHtml(Blocks)).toContain("&lt;style&gt;");
  });
});

describe("snapshots and identity", () => {
  it("treflex refuses a fresh node over a live $Id, so a reconnect snapshot merges in place", async () => {
    const server = await connect();
    await server.open();
    function* replace(draft: IEnvironment): IActionGenerator {
      draft.Replica.OpenThreads[THREAD_ID] = { ...copy(draft.Replica.OpenThreads[THREAD_ID]!) };
    }
    await expect(server.runtime.dispatch(replace, server.envId())).rejects.toThrow(
      EntityReplacedError,
    );

    const start = longThread(6);
    await server.sendThread(snapshotOf(copy(start), 1));
    const node = server.thread();
    const item = node.TurnItems["item-0"];
    const reconnect = longThread(3);
    await server.sendThread(snapshotOf(reconnect, 9));
    expect(server.thread()).toBe(node);
    expect(server.thread().TurnItems["item-0"]).toBe(item);
    expect(server.thread().TurnItems["item-5"]).toBeUndefined();

    function* foldParsed(draft: IOpenThread): IActionGenerator {
      const parsed = JSON.parse(
        JSON.stringify(run("run-0", 1, "failed")).replace("{", '{"__proto__":{"x":1},'),
      );
      reconcile(draft.Runs["run-0"]!, parsed);
    }
    await server.runtime.dispatch(foldParsed, server.openId());
    expect(server.thread().Runs["run-0"]).toMatchObject({ id: "run-0", status: "failed" });
    expect("x" in server.thread().Runs["run-0"]!).toBe(false);
    expect(server.thread().Timeline).toEqual(["item-0", "item-1", "item-2"]);
    expect(server.thread().LastSequence).toBe(9);
  });

  it("holds an item shared by turnItems and a row once, and an inherited row's item apart", async () => {
    const server = await connect();
    await server.open();
    const local = commandItem("local", "run-1", 1);
    const parentItem = {
      ...commandItem("parent", "run-0", 0),
      threadId: "parent-thread",
    } as IWireTurnItem;
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          turnItems: [local],
          visibleTurnItems: [
            { ...localRow(parentItem, 0), visibility: "inherited" },
            localRow(local, 1),
          ],
        },
        1,
      ),
    );
    expect(Object.keys(server.thread().TurnItems)).toEqual(["local"]);
    expect(Object.keys(server.thread().InheritedItems)).toEqual(["parent"]);
    const entries = timelineEntries(server.thread());
    expect(entries.map((entry) => entry.sourceItemId)).toEqual(["parent", "local"]);
  });
});

describe("lifetimes", () => {
  it("a row missing from the shell leaves the thread and its session alone", async () => {
    const server = await connect();
    await server.open();
    await server.runtime.dispatch(setDraft, server.sessionId(), "half a thought");
    const shellThread = { id: THREAD_ID, title: "T" };
    await server.sendShell({
      kind: "snapshot",
      snapshot: { snapshotSequence: 1, projects: [], threads: [shellThread], archivedThreads: [] },
    } as unknown as IWireShellItem);
    expect(server.environment().Replica.Shell.Threads[THREAD_ID]).toBeDefined();
    await server.sendShell({
      kind: "snapshot",
      snapshot: { snapshotSequence: 2, projects: [], threads: [], archivedThreads: [] },
    } as unknown as IWireShellItem);
    expect(server.environment().Replica.Shell.Threads[THREAD_ID]).toBeUndefined();
    expect(server.thread()).toBeDefined();
    expect(server.environment().Local.ThreadSessions[THREAD_ID]!.Draft).toBe("half a thought");
  });

  it("closing keeps the session and retires the stream; reopening resumes nothing stale", async () => {
    const server = await connect();
    await server.open();
    expect(server.runtime.resources().some((row) => row.Key === "Thread/Stream")).toBe(true);
    await server.runtime.dispatch(setDraft, server.sessionId(), "kept");
    await server.runtime.dispatch(closeThread, server.envId(), THREAD_ID);
    expect(server.thread()).toBeUndefined();
    expect(server.runtime.resources().some((row) => row.Key === "Thread/Stream")).toBe(false);
    expect(server.environment().Local.ThreadSessions[THREAD_ID]!.Draft).toBe("kept");
  });

  it("thread.deleted removes the replica row and the session", async () => {
    const server = await connect();
    await server.open();
    await server.sendThread(snapshotOf(emptyProjection(), 1));
    const gone = server.disposed(server.sessionId());
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("thread.deleted", {}),
    } as IWireThreadItem);
    await gone;
    expect(server.thread()).toBeUndefined();
    expect(server.environment().Local.ThreadSessions[THREAD_ID]).toBeUndefined();
  });

  it("reopens a stream that ended on a timer, unless the receiver failed it", async () => {
    const server = await connect();
    await server.open();
    const opened: string[] = [];
    server.runtime.on("record", (record) => {
      if (record.Kind === "effect" && record.Type === "openResource")
        opened.push((record.Descriptor as { Key: string }).Key);
    });
    const deliver = (message: object) =>
      server.runtime.dispatch(ThreadReceiver.handle, server.openId(), message as never, {
        publisher: { Id: server.openId() },
      });
    await deliver({ Type: "Thread/Stream", $Ended: { Reason: "failed" } });
    expect(server.runtime.timers(server.openId())).toMatchObject([{ Key: "Thread/Reopen" }]);
    await deliver({ Type: "Thread/Reopen" });
    expect(server.runtime.timers(server.openId())).toEqual([]);
    expect(opened).toEqual(["Thread/Stream"]);
    await deliver({ Type: "Thread/Stream", $Ended: { Reason: "receiver-failed" } });
    expect(server.runtime.timers(server.openId())).toEqual([]);

    const deliverShell = (message: object) =>
      server.runtime.dispatch(ShellReceiver.handle, server.shellId(), message as never, {
        publisher: { Id: server.shellId() },
      });
    await deliverShell({ Type: "Shell/Stream", $Ended: { Reason: "failed" } });
    expect(server.runtime.timers(server.shellId())).toMatchObject([{ Key: "Shell/Reopen" }]);
    await deliverShell({ Type: "Shell/Reopen" });
    expect(server.runtime.timers(server.shellId())).toEqual([]);
    expect(opened).toEqual(["Thread/Stream", "Shell/Stream"]);
    await deliverShell({ Type: "Shell/Stream", $Ended: { Reason: "receiver-failed" } });
    expect(server.runtime.timers(server.shellId())).toEqual([]);
  });
});

describe("runs", () => {
  it("treats the active run as latest, past a later cancelled queued run", async () => {
    const server = await connect();
    await server.open();
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runs: [run("r5", 5, "running"), run("r6", 6, "cancelled"), run("r7", 7, "queued")],
        },
        1,
      ),
    );
    const latest = () => server.runtime.processSelector(latestRun, () => server.thread())?.id;
    expect(latest()).toBe("r5");
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("run.updated", run("r5", 5, "completed")),
    } as IWireThreadItem);
    expect(latest()).toBe("r6");
  });
});

describe("history pages", () => {
  const window = () => {
    const held = commandItem("c-9", "run-1", 9);
    return {
      ...snapshotOf(
        {
          ...emptyProjection(),
          runs: [run("run-1", 1)],
          turnItems: [held],
          visibleTurnItems: [localRow(held, 0)],
        },
        1,
      ),
      historyCursor: "older",
      hasMoreHistory: true,
      latestLocalTurnOrdinal: 9,
    };
  };
  const pageOf = (id: string, nextCursor: string | null): IWireHistoryPage =>
    ({
      snapshotSequence: 1,
      items: [localRow(commandItem(id, "run-1", 1), 0)],
      nextCursor,
      hasMoreHistory: nextCursor !== null,
    }) as unknown as IWireHistoryPage;

  const gated = () => {
    let release!: (page: IWireHistoryPage) => void;
    const promise = new Promise<IWireHistoryPage>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  };

  const historyId = (server: Awaited<ReturnType<typeof connect>>) => server.thread().History!.$Id;
  const loadingOf = (server: Awaited<ReturnType<typeof connect>>) =>
    server.runtime.processSelector(loadingEarlier, () => server.thread().History!);

  it("prepends a page, and a live update made during the wait wins over it", async () => {
    const gate = gated();
    const server = await connect(() => gate.promise);
    await server.open();
    await server.sendThread(window());
    const loading = server.runtime.dispatch(loadEarlier, historyId(server));
    const busy = () => loadingOf(server);
    expect(busy()).toBe(true);
    expect(await server.runtime.dispatch(loadEarlier, historyId(server))).toBeUndefined();
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("turn-item.updated", commandItem("c-9", "run-1", 9, "newer")),
    } as IWireThreadItem);
    gate.release({
      ...pageOf("c-1", null),
      items: [
        localRow(commandItem("c-1", "run-1", 1), 0),
        localRow(commandItem("c-9", "run-1", 9, "older"), 1),
      ],
    } as unknown as IWireHistoryPage);
    await loading;
    await settled();
    expect(server.thread().Timeline).toEqual(["c-1", "c-9"]);
    expect((server.thread().TurnItems["c-9"] as { input: string }).input).toBe("newer");
    expect(server.thread().History).toMatchObject({ HasMore: false, Cursor: null });
    expect(busy()).toBe(false);
  });

  it("drops a fetch at once when a reconnect snapshot replaces the window, keeps it through the same window, and clears a failure", async () => {
    const gate = gated();
    let fetchPage = () => gate.promise;
    const server = await connect(() => fetchPage());
    await server.open();
    await server.sendThread(window());
    const loading = server.runtime.dispatch(loadEarlier, historyId(server));
    await server.sendThread({ ...window(), snapshotSequence: 3 });
    expect(loadingOf(server)).toBe(true);
    await server.sendThread({ ...window(), snapshotSequence: 5, historyCursor: "fresher" });
    expect(loadingOf(server)).toBe(false);
    expect(await loading).toBeUndefined();
    gate.release(pageOf("c-1", null));
    await settled();
    expect(server.thread().Timeline).toEqual(["c-9"]);
    expect(server.thread().History!.Cursor).toBe("fresher");

    fetchPage = () => Promise.reject(new Error("socket closed"));
    await server.runtime.dispatch(loadEarlier, historyId(server));
    expect(server.thread().History!.Error).toBe("socket closed");
    await server.sendThread({ ...window(), snapshotSequence: 7, historyCursor: "fresher" });
    expect(server.thread().History!.Error).toBeUndefined();
  });

  it("drops a page that queued behind the snapshot replacing its window", async () => {
    const gate = gated();
    const held = gated();
    const server = await connect((cursor) => (cursor === "hold" ? held.promise : gate.promise));
    await server.open();
    await server.sendThread(window());
    const loading = server.runtime.dispatch(loadEarlier, historyId(server));
    function* hold(draft: IOpenThread): IActionGenerator {
      yield* threadHistoryPage(draft.ThreadId, "hold");
    }
    const holding = server.runtime.dispatch(hold, server.openId());
    const replaced = server.sendThread({
      ...window(),
      snapshotSequence: 5,
      historyCursor: "fresher",
    });
    gate.release(pageOf("c-1", null));
    await loading;
    held.release(pageOf("unused", null));
    await Promise.all([holding, replaced]);
    await settled();
    expect(server.thread().Timeline).toEqual(["c-9"]);
    expect(server.thread().History!.Cursor).toBe("fresher");
  });

  it("stops without writing when the thread closes during the wait", async () => {
    const gate = gated();
    const server = await connect(() => gate.promise);
    await server.open();
    await server.sendThread(window());
    const loading = server.runtime.dispatch(loadEarlier, historyId(server));
    await server.runtime.dispatch(closeThread, server.envId(), THREAD_ID);
    gate.release(pageOf("c-1", null));
    await loading;
    expect(server.thread()).toBeUndefined();
  });
});

describe("the sidebar", () => {
  const row = (id: string, projectId: string, updatedAt: string, extra: object = {}) => ({
    id,
    projectId,
    updatedAt,
    title: id,
    status: "idle",
    latestRunId: null,
    activeProviderThreadId: null,
    pendingRuntimeRequest: null,
    lineage: { rootThreadId: id, parentThreadId: null, relationshipToParent: null },
    ...extra,
  });

  it("lists top-level threads and leaves subagents out, live", async () => {
    const server = await connect();
    const requestsOf = () =>
      server.runtime.processSelector(subagentRequests, () => server.environment().Replica.Shell);
    const empty = requestsOf();
    expect(empty).toEqual({});
    expect(requestsOf()).toBe(empty);
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "p-1", title: "One", workspaceRoot: "/1" }],
        threads: [
          row("old", "p-1", "2026-01-01T00:00:00.000Z"),
          row("child", "p-1", "2026-01-09T00:00:00.000Z", {
            lineage: {
              rootThreadId: "old",
              parentThreadId: "old",
              relationshipToParent: "subagent",
            },
            status: "running",
            pendingRuntimeRequest: { id: "r", kind: "command" },
          }),
        ],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    const shell = server.environment().Replica.Shell;
    const read = () =>
      server.runtime
        .processSelector(sidebarThreads, () => shell)
        .map((thread) => thread.id)
        .sort();
    expect(read()).toEqual(["old"]);
    expect(server.runtime.processSelector(subagentRequests, () => shell)).toEqual({
      old: "approval",
    });
    await server.sendShell({
      kind: "thread.updated",
      sequence: 2,
      location: "active",
      thread: row("new", "p-1", "2026-01-05T00:00:00.000Z"),
    } as unknown as IWireShellItem);
    expect(read()).toEqual(["new", "old"]);

    const at = "2026-01-01T00:00:00.000Z";
    const child = (
      id: string,
      parentThreadId: string,
      kind: string | null,
      extra: { sideChat?: boolean; [field: string]: unknown } = {},
    ) => {
      const { sideChat, ...fields } = extra;
      return row(id, "p-1", at, {
        status: "running",
        lineage: {
          rootThreadId: parentThreadId,
          parentThreadId,
          relationshipToParent: sideChat ? null : "subagent",
          ...(sideChat ? { sideChat } : {}),
        },
        pendingRuntimeRequest: kind === null ? null : { id: `r-${id}`, kind },
        ...fields,
      });
    };
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 3,
        projects: [{ id: "p-1", title: "One", workspaceRoot: "/1" }],
        threads: [
          child("side-question", "side-parent", "user_input", { sideChat: true }),
          child("subagent-question", "question-parent", "user_input"),
          child("native", "native-parent", "command", { creationSource: "provider" }),
          child("finished", "finished-parent", "command", { status: "completed" }),
          child("mid", "top", null),
          child("grandchild", "mid", "command"),
          child("both-subagent", "both", "command"),
          child("both-side", "both", "user_input", { sideChat: true }),
        ],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    expect(server.runtime.processSelector(subagentRequests, () => shell)).toEqual({
      "side-parent": "user_input",
      mid: "approval",
      top: "approval",
      both: "approval",
    });
  });

  it("sorts rows into pinned, active, snoozed and settled", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const future = "2026-01-02T00:00:00.000Z";
    const now = Date.parse("2026-01-01T12:00:00.000Z");
    const threads = [
      row("active", "p", at),
      row("pinned", "p", at, { pinnedAt: at, pinOrderKey: "b" }),
      row("pinned-first", "p", at, { pinnedAt: at, pinOrderKey: "a" }),
      row("settled-old", "p", at, { settledOverride: "settled", settledAt: at }),
      row("settled-new", "p", at, { settledOverride: "settled", settledAt: future }),
      row("snoozed", "p", at, { snoozedUntil: future, snoozedAt: at }),
      row("woke", "p", at, { snoozedUntil: at, snoozedAt: at }),
      row("asked", "p", at, {
        snoozedUntil: future,
        snoozedAt: at,
        pendingRuntimeRequest: { id: "r", kind: "command" },
      }),
      row("failed-since", "p", at, {
        snoozedUntil: future,
        snoozedAt: at,
        status: "failed",
        latestRunId: "run",
        latestRunCompletedAt: "2026-01-01T06:00:00.000Z",
      }),
      row("failed-before", "p", at, {
        snoozedUntil: future,
        snoozedAt: "2026-01-01T06:00:00.000Z",
        status: "failed",
        latestRunId: "run",
        latestRunCompletedAt: at,
      }),
      row("failed-undated", "p", at, {
        snoozedUntil: future,
        snoozedAt: at,
        status: "failed",
        latestRunId: "run",
        latestRunCompletedAt: null,
      }),
      row("subagent-asked", "p", at, { snoozedUntil: future, snoozedAt: at }),
    ];
    const sections = sidebarSections(threads as never, now, { "subagent-asked": "approval" });
    const ids = (list: { id: string }[]) => list.map((thread) => thread.id);
    expect(ids(sections.Pinned)).toEqual(["pinned-first", "pinned"]);
    expect(ids(sections.Active)).toEqual([
      "active",
      "woke",
      "asked",
      "failed-since",
      "subagent-asked",
    ]);
    expect(ids(sections.Snoozed)).toEqual(["snoozed", "failed-before", "failed-undated"]);
    expect(ids(sections.Settled)).toEqual(["settled-new", "settled-old"]);

    const snoozable = (extra: object, subagent?: "approval") =>
      canSnooze(row("t", "p", at, { latestRunId: "run", ...extra }) as never, subagent, now);
    const sent = { latestUserMessageAt: "2026-01-01T11:59:00.000Z", status: "completed" };
    expect([
      snoozable({ status: "completed" }),
      snoozable({ status: "queued" }),
      snoozable({ ...sent, latestRunRequestedAt: "2026-01-01T11:00:00.000Z" }),
      snoozable({ ...sent, latestRunRequestedAt: "2026-01-01T11:59:30.000Z" }),
      snoozable({ ...sent, latestUserMessageAt: "2026-01-01T09:00:00.000Z" }),
      snoozable({ pendingRuntimeRequest: { id: "r", kind: "command" } }),
      snoozable({}, "approval"),
      snoozable({ pendingGuestMessageCount: 1 }),
    ]).toEqual([true, false, false, true, true, false, false, false]);
  });

  it("folds active rows into a folder per open project, pinned first and archived last", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const project = (id: string, title: string, extra: object = {}) => ({
      id,
      title,
      workspaceRoot: `/${id}`,
      ...extra,
    });
    const projects = {
      zed: project("zed", "Zed", { pinnedAt: "2026-01-02T00:00:00.000Z" }),
      apple: project("apple", "Apple", { pinnedAt: at }),
      mango: project("mango", "Mango"),
      banana: project("banana", "Banana"),
      idle: project("idle", "Idle"),
      old: project("old", "Old", { archivedAt: at }),
    };
    const active = [row("m1", "mango", at), row("o1", "old", at), row("b1", "banana", at)];
    active.push(row("m2", "mango", at), row("gone", "missing", at));
    const folders = projectFolders(active as never, projects as never);
    expect(folders.map((folder) => [folder.ProjectId, folder.Threads.map((t) => t.id)])).toEqual([
      ["apple", []],
      ["zed", []],
      ["missing", ["gone"]],
      ["banana", ["b1"]],
      ["idle", []],
      ["mango", ["m1", "m2"]],
      ["old", ["o1"]],
    ]);
  });

  it("derives a row's status and how long it has been working", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const status = (extra: object, subagent?: "approval" | "user_input") =>
      sidebarStatus(row("t", "p", at, { latestRunId: "r", ...extra }) as never, subagent);
    expect(status({ status: "running" })).toBe("working");
    const holding = { pendingBackgroundTasks: [{ kind: "subagent", awaited: true }] };
    const unseen = { latestRunCompletedAt: at, lastVisitedAt: "2025-01-01" };
    expect(status({ status: "completed", ...unseen, ...holding })).toBeNull();
    expect(status({ status: "running", ...holding })).toBeNull();
    expect(status({ status: "idle", ...unseen })).toBeNull();
    expect(status({ status: "running", latestRunId: null })).toBeNull();
    expect(status({ status: "running" }, "approval")).toBe("approval");
    expect(status({ status: "running" }, "user_input")).toBe("input");
    expect(
      status(
        { status: "running", pendingRuntimeRequest: { id: "r", kind: "user_input" } },
        "approval",
      ),
    ).toBe("approval");
    expect(status({ status: "completed", latestRunId: "r", lastVisitedAt: "2025-01-01" })).toBe(
      "done",
    );
    expect(status({ status: "running", pendingRuntimeRequest: { id: "r", kind: "command" } })).toBe(
      "approval",
    );
    expect(
      status({ status: "running", pendingRuntimeRequest: { id: "r", kind: "user_input" } }),
    ).toBe("input");
    expect(status({ status: "failed" })).toBe("failed");
    expect(
      status({ status: "completed", latestRunCompletedAt: at, lastVisitedAt: "2025-01-01" }),
    ).toBe("done");
    expect(status({ status: "completed", latestRunCompletedAt: at, lastVisitedAt: at })).toBeNull();

    const started = (extra: object) => workingStartedAt(row("t", "p", at, extra) as never);
    const run = "2026-01-01T01:00:00.000Z";
    expect(started({ latestRunId: "a", activityRunStartedAt: run })).toBe(run);
    expect(started({ latestRunId: "a", activityRunStartedAt: "not a time" })).toBeNull();
    expect(started({ activityRunStartedAt: run })).toBeNull();
    const live = { status: "running", activeRunId: "a", latestRunId: "a", latestRunStartedAt: run };
    expect(started(live)).toBe(run);
    expect(started({ ...live, latestRunId: "b" })).toBeNull();
    expect(started({ ...live, status: "completed" })).toBeNull();
  });
});

describe("selection", () => {
  const streams = (server: Awaited<ReturnType<typeof connect>>) =>
    server.runtime
      .resources()
      .filter((resource) => resource.Key === "Thread/Stream")
      .map((resource) => (resource.Params as unknown as { ThreadId: string }).ThreadId);

  it("opening a thread closes the previous one's stream and keeps its session", async () => {
    const server = await connect();
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    await server.runtime.dispatch(setDraft, server.sessionId("a"), "kept");
    expect(streams(server)).toEqual(["a"]);
    await server.runtime.dispatch(selectThread, server.envId(), "b");
    expect(streams(server)).toEqual(["b"]);
    expect(Object.keys(server.environment().Replica.OpenThreads)).toEqual(["b"]);
    expect(server.environment().Local.SelectedThreadId).toBe("b");
    expect(server.environment().Local.ThreadSessions["a"]!.Draft).toBe("kept");
    expect(server.address.thread).toBe("b");
  });

  it("a reload returns to the thread in the address", async () => {
    const server = await connect(undefined, "from-address");
    expect(streams(server)).toEqual(["from-address"]);
    expect(server.environment().Local.SelectedThreadId).toBe("from-address");
  });

  it("deleting the selected thread clears the selection and the address", async () => {
    const server = await connect(undefined, THREAD_ID);
    await server.sendThread(snapshotOf(emptyProjection(), 1));
    const gone = server.disposed(server.sessionId());
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("thread.deleted", {}),
    } as IWireThreadItem);
    await gone;
    await settled();
    expect(server.address.thread).toBeNull();
    expect(server.environment().Local.SelectedThreadId).toBeNull();
  });
});

describe("writing to the server", () => {
  const requestItem = (requestId: string) =>
    ({
      ...commandItem(`approval-${requestId}`, "run-1", 1),
      type: "approval_request",
      requestId,
      requestKind: "command",
      prompt: "rm -rf build",
    }) as unknown as IWireTurnItem;
  const pendingOf = (server: Awaited<ReturnType<typeof connect>>) =>
    server.runtime.processSelector(pendingApprovalIds, () => server.thread());

  it("send mints one command, clears the draft, and leaves the replica to the stream", async () => {
    const sent: IStartTurn[] = [];
    const server = await connect(undefined, null, {
      startTurn: (effect: IStartTurn) => {
        sent.push(effect);
      },
    });
    await server.open();
    await server.runtime.dispatch(setDraft, server.sessionId(), " hello ");
    await server.runtime.dispatch(send, server.sessionId());
    expect(sent.map((input) => [input.Text, input.ThreadId, input.NewThread])).toEqual([
      ["hello", THREAD_ID, null],
    ]);
    expect(sent[0]!.CommandId).not.toBe(sent[0]!.MessageId);
    const session = server.environment().Local.ThreadSessions[THREAD_ID]!;
    expect(session.Draft).toBe("");
    expect(server.runtime.processSelector(sending, () => server.session())).toBe(false);
    expect(server.thread().TurnItems).toEqual({});
  });

  it("a failed send keeps the draft and shows why", async () => {
    let attempts = 0;
    const server = await connect(undefined, null, {
      startTurn: () => {
        attempts += 1;
        throw new Error("server said no");
      },
    });
    await server.open();
    await server.runtime.dispatch(setDraft, server.sessionId(), "keep me");
    await server.runtime.dispatch(send, server.sessionId());
    const session = server.environment().Local.ThreadSessions[THREAD_ID]!;
    expect(attempts).toBe(1);
    expect(session.Draft).toBe("keep me");
    expect(session.SendError).toBe("server said no");
    expect(server.runtime.processSelector(sending, () => server.session())).toBe(false);
  });

  it("a second send during the wait is ignored", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: IStartTurn[] = [];
    const server = await connect(undefined, null, {
      startTurn: (effect: IStartTurn) => {
        sent.push(effect);
        return held;
      },
    });
    await server.open();
    await server.runtime.dispatch(setDraft, server.sessionId(), "once");
    const first = server.runtime.dispatch(send, server.sessionId());
    await server.runtime.dispatch(send, server.sessionId());
    expect(server.runtime.processSelector(sending, () => server.session())).toBe(true);
    release();
    await first;
    expect(sent).toHaveLength(1);
  });

  it("a new-thread draft moves to the created thread without a stream before it exists", async () => {
    const sent: IStartTurn[] = [];
    const server = await connect(undefined, null, {
      startTurn: (effect: IStartTurn) => {
        sent.push(effect);
      },
    });
    await server.runtime.dispatch(newThread, server.envId(), "project-1");
    const threadId = server.environment().Local.SelectedThreadId!;
    expect(server.environment().Replica.OpenThreads[threadId]).toBeUndefined();
    expect(server.address.thread).toBeNull();
    await server.runtime.dispatch(setDraft, server.sessionId(threadId), "start something");
    await server.runtime.dispatch(send, server.sessionId(threadId));
    expect(sent[0]!.NewThread).toEqual({ ProjectId: "project-1", Title: "start something" });
    expect(sent[0]!.ModelSelection).toEqual({ instanceId: "devReplay", model: "showcase" });
    expect(sent[0]!.ThreadId).toBe(threadId);
    const session = server.session(threadId);
    expect(session.NewThreadProjectId).toBeNull();
    expect(session.Draft).toBe("");
    await settled();
    expect(server.address.thread).toBe(threadId);
    expect(server.environment().Replica.OpenThreads[threadId]).toBeDefined();
  });

  it("reads the model through the replica, from the thread or the project's default", async () => {
    const server = await connect();
    await server.open();
    await server.sendThread(snapshotOf(emptyProjection(), 1));
    const model = (threadId: string) =>
      server.runtime.processSelector(effectiveModel, () => server.session(threadId));
    expect(model(THREAD_ID)).toEqual({ instanceId: "codex", model: "gpt-5.4" });
    await server.runtime.dispatch(newThread, server.envId(), "project-1");
    const draftId = server.environment().Local.SelectedThreadId!;
    expect(model(draftId)).toEqual({ instanceId: "devReplay", model: "showcase" });
  });

  it("a failed new thread stays a draft with no stream", async () => {
    const server = await connect(undefined, null, {
      startTurn: () => {
        throw new Error("no");
      },
    });
    await server.runtime.dispatch(newThread, server.envId(), "project-1");
    const threadId = server.environment().Local.SelectedThreadId!;
    await server.runtime.dispatch(setDraft, server.sessionId(threadId), "again");
    await server.runtime.dispatch(send, server.sessionId(threadId));
    const session = server.environment().Local.ThreadSessions[threadId]!;
    expect(session.NewThreadProjectId).toBe("project-1");
    expect(session.Draft).toBe("again");
    expect(server.environment().Replica.OpenThreads[threadId]).toBeUndefined();
  });

  it("stop sends one command", async () => {
    const stops: IStopThread[] = [];
    const server = await connect(undefined, null, {
      stopThread: (effect: IStopThread) => {
        stops.push(effect);
      },
    });
    await server.open();
    await server.runtime.dispatch(stopRun, server.sessionId());
    expect(stops.map((stop) => stop.ThreadId)).toEqual([THREAD_ID]);
    expect(server.runtime.processSelector(stopping, () => server.session())).toBe(false);
  });

  it("a queue command drops every queue press until it's answered, as stock's one busy run does", async () => {
    const commands: IQueueCommand[] = [];
    const releases: (() => void)[] = [];
    const server = await connect(undefined, null, {
      queueCommand: (effect: IQueueCommand) => {
        commands.push(effect);
        return new Promise<void>((resolve) => {
          releases.push(resolve);
        });
      },
    });
    await server.open();
    const busy = () => server.runtime.processSelector(queueing, () => server.session());
    const press = (runId: string | null) =>
      server.runtime.dispatch(queueAction, server.sessionId(), runId);
    const first = press("run-a");
    await settled();
    const dropped = [press("run-a"), press("run-b"), press(null)];
    await settled();
    expect(commands.map((command) => command.RunId)).toEqual(["run-a"]);
    expect(busy()).toBe(true);
    releases.forEach((release) => release());
    await Promise.all([first, ...dropped]);
    expect(busy()).toBe(false);
    const second = press("run-b");
    await settled();
    releases.forEach((release) => release());
    await second;
    expect(commands.map((command) => command.RunId)).toEqual(["run-a", "run-b"]);
  });

  it("answering marks only its own request, and the stream or another device clears it", async () => {
    const answers: IRespondRequest[] = [];
    const releases: (() => void)[] = [];
    const server = await connect(undefined, null, {
      respondRequest: (effect: IRespondRequest) => {
        answers.push(effect);
        return new Promise<void>((resolve) => {
          releases.push(resolve);
        });
      },
    });
    await server.open();
    const request = (id: string) => ({
      id,
      kind: "command",
      status: "pending",
      responseCapability: { type: "live" },
    });
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runtimeRequests: [request("r-1"), request("r-2")],
          turnItems: [requestItem("r-1"), requestItem("r-2")],
        } as never,
        1,
      ),
    );
    expect(pendingOf(server)).toEqual(["r-1", "r-2"]);
    expect(pendingRequest(server.thread(), "r-1")?.Item?.type).toBe("approval_request");

    const node = (id: string) => server.thread().RuntimeRequests[id]!;
    const busy = (id: string) => server.runtime.processSelector(answering, () => node(id));
    const answer = (id: string, decision: "accept" | "decline") =>
      server.runtime.dispatch(answerRequest, node(id).$Id, ENV, THREAD_ID, decision, null);
    const first = answer("r-1", "accept");
    await settled();
    expect([busy("r-1"), busy("r-2")]).toEqual([true, false]);
    expect(await answer("r-1", "decline")).toBeUndefined();
    const folded: string[] = [];
    function* fold(draft: IRuntimeRequest): IActionGenerator {
      folded.push(draft.kind);
    }
    void server.runtime.dispatch(fold, node("r-1").$Id);
    await settled();
    expect(folded).toEqual(["command"]);
    const second = answer("r-2", "decline");
    await settled();
    expect([busy("r-1"), busy("r-2")]).toEqual([true, true]);
    releases.forEach((release) => release());
    await Promise.all([first, second]);
    expect([busy("r-1"), busy("r-2")]).toEqual([false, false]);
    expect(answers.map((answer) => [answer.RequestId, answer.Decision])).toEqual([
      ["r-1", "accept"],
      ["r-2", "decline"],
    ]);
    expect(pendingOf(server)).toHaveLength(2);

    const held = node("r-2");
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("runtime-request.updated", { ...request("r-2"), status: "resolved" }),
    } as IWireThreadItem);
    expect(pendingOf(server)).toEqual(["r-1"]);
    expect(node("r-2")).toBe(held);
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runtimeRequests: [request("r-2")],
          turnItems: [requestItem("r-2")],
        } as never,
        3,
      ),
    );
    expect(pendingOf(server)).toEqual(["r-2"]);
    expect(node("r-2")).toBe(held);
  });

  it("holds a question's answer per request until it's complete, and sends only what the provider can take", async () => {
    const answers: IRespondRequest[] = [];
    const server = await connect(undefined, null, {
      respondRequest: (effect: IRespondRequest) => {
        answers.push(effect);
      },
    });
    await server.open();
    const request = (id: string, kind: string, type: string) => ({
      id,
      kind,
      status: "pending",
      responseCapability: { type },
    });
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runtimeRequests: [
            request("r-1", "user_input", "message"),
            request("gone-question", "user_input", "not_resumable"),
            request("gone-approval", "command", "message"),
          ],
        } as never,
        1,
      ),
    );
    const node = (id: string) => server.thread().RuntimeRequests[id]!;
    expect(["r-1", "gone-question", "gone-approval"].map((id) => canAnswer(node(id)))).toEqual([
      true,
      false,
      false,
    ]);
    await server.runtime.dispatch(answerRequest, node("gone-question").$Id, ENV, THREAD_ID, null, {
      one: "typed",
    });
    await server.runtime.dispatch(
      answerRequest,
      node("gone-approval").$Id,
      ENV,
      THREAD_ID,
      "accept",
      null,
    );
    expect(answers).toEqual([]);
    const questions = [
      { id: "one", options: [] },
      { id: "many", options: [{ label: "a" }, { label: "b" }], multiSelect: true },
    ];
    const built = (requestId = "r-1") => questionAnswers(server.session(), requestId, questions);
    const type = (questionId: string, text: string) =>
      server.runtime.dispatch(setQuestionAnswer, server.sessionId(), "r-1", questionId, text);
    expect(built()).toBeNull();
    await type("one", "typed");
    expect(built()).toBeNull();
    await type("many", "a, b");
    expect(built()).toEqual({ one: "typed", many: ["a", "b"] });
    expect(built("r-2")).toBeNull();
    await server.runtime.dispatch(answerRequest, node("r-1").$Id, ENV, THREAD_ID, null, built());
    expect(answers.map((answer) => answer.Answers)).toEqual([{ one: "typed", many: ["a", "b"] }]);
  });

  it("sends a thread command and leaves the row to the stream, showing a failure", async () => {
    const commands: { ThreadId: string; Command: object }[] = [];
    let refusal: string | null = null;
    const server = await connect(undefined, null, {
      threadCommand: (effect: { ThreadId: string; Command: object }) => {
        if (refusal !== null) throw new Error(refusal);
        commands.push(effect);
      },
    });
    const refused = async (command: IThreadCommand, message: string) => {
      refusal = message;
      await expect(
        server.runtime.dispatch(threadCommand, server.envId(), "t-1", command),
      ).rejects.toThrow(message);
    };
    await server.runtime.dispatch(threadCommand, server.envId(), "t-1", { Kind: "settle" });
    expect(commands).toMatchObject([{ ThreadId: "t-1", Command: { Kind: "settle" } }]);
    await refused({ Kind: "pin" }, "server said no");
    expect(server.runtime.state.Failure).toBe("server said no");
    await server.runtime.dispatch(threadCommand, server.envId(), "t-1", {
      Kind: "visit",
      VisitedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(server.runtime.state.Failure).toBe("server said no");
    await refused({ Kind: "unpin" }, "still no");
    expect(server.runtime.state.Failure).toBe("still no");
    await server.runtime.dispatch(dismissFailure, "Root");
    expect(server.runtime.state.Failure).toBeUndefined();
  });

  it("adding a project opens a new thread in it, and a refused one opens nothing", async () => {
    const created: { ProjectId: string; Command: object }[] = [];
    let refuse = false;
    const server = await connect(undefined, null, {
      projectCommand: (effect: { ProjectId: string; Command: object }) => {
        if (refuse) throw new Error("no such folder");
        created.push(effect);
      },
    });
    const add = { Kind: "create", Title: "Code", WorkspaceRoot: "E:\\Tam\\Code" } as const;
    await server.runtime.dispatch(projectCommand, server.envId(), null, add);
    const projectId = created[0]!.ProjectId;
    expect(created).toMatchObject([{ Command: add }]);
    const selected = server.environment().Local.SelectedThreadId!;
    expect(server.environment().Local.ThreadSessions[selected]?.NewThreadProjectId).toBe(projectId);
    refuse = true;
    await expect(
      server.runtime.dispatch(projectCommand, server.envId(), null, add),
    ).rejects.toThrow("no such folder");
    expect(server.runtime.state.Failure).toBe("no such folder");
    expect(server.environment().Local.SelectedThreadId).toBe(selected);
  });

  it("deleting forgets the thread even when it isn't open, and clears the selection", async () => {
    const server = await connect(undefined, THREAD_ID, { threadCommand: () => undefined });
    await server.runtime.dispatch(setDraft, server.sessionId(), "gone");
    await server.runtime.dispatch(threadCommand, server.envId(), THREAD_ID, { Kind: "delete" });
    expect(server.environment().Local.ThreadSessions[THREAD_ID]).toBeUndefined();
    expect(server.environment().Replica.OpenThreads[THREAD_ID]).toBeUndefined();
    expect(server.environment().Local.SelectedThreadId).toBeNull();
    expect(server.address.thread).toBeNull();
  });

  it("keeps a pending request's id stable when an unrelated row arrives", async () => {
    const server = await connect();
    await server.open();
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runtimeRequests: [{ id: "r-1", kind: "command", status: "pending" }],
          turnItems: [requestItem("r-1")],
        } as never,
        1,
      ),
    );
    expect(pendingOf(server)).toEqual(["r-1"]);
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("turn-item.updated", commandItem("other", "run-1", 2)),
    } as IWireThreadItem);
    expect(pendingOf(server)).toEqual(["r-1"]);
  });
});

describe("diffs", () => {
  const checkpoint = (ordinal: number, runId: string, files: object[] = []) => ({
    id: `checkpoint-${ordinal}`,
    threadId: THREAD_ID,
    runId,
    appRunOrdinal: ordinal,
    status: "ready",
    files,
  });
  const withCheckpoints = () =>
    snapshotOf(
      {
        ...emptyProjection(),
        runs: [run("run-1", 1), run("run-2", 2)],
        checkpoints: [
          checkpoint(1, "run-1", [
            { path: "src/hello.txt", kind: "modified", additions: 1, deletions: 0 },
          ]),
          checkpoint(2, "run-2"),
        ],
      } as never,
      1,
    );
  const fileChange = {
    ...commandItem("change", "run-1", 1),
    type: "file_change",
    fileName: "C:\\work\\src\\hello.txt",
  } as unknown as Extract<IWireTurnItem, { type: "file_change" }>;

  it("fetches one turn or the whole thread, and closes and reopens", async () => {
    const asked: IThreadDiff[] = [];
    const server = await connect(undefined, null, {
      threadDiff: (effect: IThreadDiff) => {
        asked.push(effect);
        return `patch for ${effect.Scope} ${effect.ToTurnCount}`;
      },
    });
    await server.open();
    await server.sendThread(withCheckpoints());
    const panel = () => server.environment().Local.ThreadSessions[THREAD_ID]!.Panels.Diff;
    await server.runtime.dispatch(openDiff, server.sessionId(), "turn", 1);
    expect(panel()).toMatchObject({ Open: true, Text: "patch for turn 1" });
    await server.runtime.dispatch(closeDiff, server.sessionId());
    expect(panel()).toMatchObject({ Open: false, Text: null });
    await server.runtime.dispatch(openDiff, server.sessionId(), "thread", null);
    expect(panel()).toMatchObject({ Open: true, Scope: "thread", Text: "patch for thread 2" });
    expect(asked.map((ask) => [ask.Scope, ask.ToTurnCount])).toEqual([
      ["turn", 1],
      ["thread", 2],
    ]);
  });

  it("drops a diff that arrives after the panel moved on or closed", async () => {
    const replies = new Map<number, (text: string) => void>();
    const server = await connect(undefined, null, {
      threadDiff: (effect: IThreadDiff) =>
        new Promise<string>((resolve) => replies.set(effect.ToTurnCount, resolve)),
    });
    await server.open();
    const panel = () => server.environment().Local.ThreadSessions[THREAD_ID]!.Panels.Diff;
    const loading = () => server.runtime.processSelector(diffLoading, () => server.session());
    const first = server.runtime.dispatch(openDiff, server.sessionId(), "turn", 1);
    const second = server.runtime.dispatch(openDiff, server.sessionId(), "turn", 2);
    replies.get(1)!("stale");
    await first;
    expect(panel()).toMatchObject({ Text: null });
    expect(loading()).toBe(true);
    replies.get(2)!("current");
    await second;
    expect(panel()).toMatchObject({ Text: "current" });
    expect(loading()).toBe(false);
    const third = server.runtime.dispatch(openDiff, server.sessionId(), "turn", 1);
    await server.runtime.dispatch(closeDiff, server.sessionId());
    expect(loading()).toBe(false);
    replies.get(1)!("late");
    await third;
    expect(panel()).toMatchObject({ Open: false, Text: null });
  });

  it("shows a failed fetch and an empty turn", async () => {
    const server = await connect(undefined, null, {
      threadDiff: () => {
        throw new Error("checkpoint is missing");
      },
    });
    await server.open();
    await server.runtime.dispatch(openDiff, server.sessionId(), "turn", 1);
    const panel = server.environment().Local.ThreadSessions[THREAD_ID]!.Panels.Diff;
    expect(panel).toMatchObject({ Error: "checkpoint is missing", Text: null });
  });

  it("takes a file change's counts from its run's checkpoint when the item has none", async () => {
    const server = await connect();
    await server.open();
    await server.sendThread(withCheckpoints());
    expect(fileChangeCounts(server.thread(), fileChange)).toEqual({ additions: 1, deletions: 0 });
    expect(diffTurnOf(server.thread(), fileChange)).toBe(1);
    expect(
      fileChangeCounts(server.thread(), { ...fileChange, fileName: "C:\\work\\other.txt" }),
    ).toBeNull();
    expect(fileChangeCounts(server.thread(), { ...fileChange, additions: 4 })).toEqual({
      additions: 4,
      deletions: 0,
    });
  });

  it("offers only a ready checkpoint of a completed run, as the server serves", async () => {
    const server = await connect();
    await server.open();
    await server.sendThread(withCheckpoints());
    expect(latestDiffTurn(server.thread())).toBe(2);
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("run.updated", run("run-2", 2, "interrupted")),
    } as IWireThreadItem);
    expect(latestDiffTurn(server.thread())).toBe(1);
    const stopped = { ...fileChange, runId: "run-2" } as typeof fileChange;
    expect(diffTurnOf(server.thread(), stopped)).toBeNull();
    await server.sendThread({
      kind: "event",
      sequence: 3,
      event: event("checkpoint.captured", { ...checkpoint(1, "run-1"), status: "failed" }),
    } as IWireThreadItem);
    expect(latestDiffTurn(server.thread())).toBeNull();
  });

  it("takes a path from the file headers when the name itself contains b/", () => {
    const [file] = parseDiff(
      [
        "diff --git a/foo b/x.ts b/foo b/x.ts",
        "--- a/foo b/x.ts",
        "+++ b/foo b/x.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"),
    );
    expect(file!.Path).toBe("foo b/x.ts");
  });

  it("parses a unified diff into files with counts, not counting its headers", () => {
    const files = parseDiff(
      [
        "diff --git a/one.txt b/one.txt",
        "--- a/one.txt",
        "+++ b/one.txt",
        "@@ -1,2 +1,2 @@",
        "-old",
        "+new",
        "+more",
        "diff --git a/dir/two.txt b/dir/two.txt",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/dir/two.txt",
        "@@ -0,0 +1 @@",
        "+hello",
        "",
      ].join("\n"),
    );
    expect(files.map((file) => [file.Path, file.Additions, file.Deletions])).toEqual([
      ["one.txt", 2, 1],
      ["dir/two.txt", 1, 0],
    ]);
    expect(parseDiff("")).toEqual([]);
  });
});

describe("the terminal", () => {
  const withProject = async (
    server: Awaited<ReturnType<typeof connect>>,
    worktree: string | null,
  ) => {
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "p-1", title: "One", workspaceRoot: "/root" }],
        threads: [],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    const projection = emptyProjection();
    await server.sendThread(
      snapshotOf(
        {
          ...projection,
          thread: { ...projection.thread, projectId: "p-1", worktreePath: worktree },
        } as never,
        1,
      ),
    );
  };
  const panel = (server: Awaited<ReturnType<typeof connect>>, threadId = THREAD_ID) =>
    server.environment().Local.ThreadSessions[threadId]!.Terminal;
  const terminal = (server: Awaited<ReturnType<typeof connect>>, threadId = THREAD_ID) =>
    server.runtime.processSelector(terminalAttachment, () => server.session(threadId));
  const attached = (server: Awaited<ReturnType<typeof connect>>) =>
    server.runtime
      .resources()
      .filter((row) => row.Key === "Terminal/Session")
      .map((row) => row.Params as unknown as { ThreadId: string; TerminalId: string; Cwd: string });

  it("runs in the worktree when the thread has one, otherwise the project root", async () => {
    const server = await connect();
    await server.open();
    await withProject(server, null);
    await server.runtime.dispatch(openTerminal, server.sessionId());
    expect(attached(server)[0]).toMatchObject({ Cwd: "/root", TerminalId: "term-1" });
    await server.runtime.dispatch(closeTerminal, server.sessionId());
    await withProject(server, "/root/wt");
    await server.runtime.dispatch(openTerminal, server.sessionId());
    expect(attached(server)[0]).toMatchObject({ Cwd: "/root/wt", WorktreePath: "/root/wt" });
  });

  it("hiding detaches and keeps the terminal id, and asks the server to end nothing", async () => {
    const closes: unknown[] = [];
    const server = await connect(undefined, null, {
      closeTerminal: (effect: unknown) => {
        closes.push(effect);
      },
    });
    await server.open();
    await withProject(server, null);
    await server.runtime.dispatch(openTerminal, server.sessionId());
    expect(panel(server).Open).toBe(true);
    await server.runtime.dispatch(closeTerminal, server.sessionId());
    expect(panel(server)).toMatchObject({ Open: false, TerminalId: "term-1" });
    expect(attached(server)).toEqual([]);
    expect(closes).toEqual([]);
    await server.runtime.dispatch(openTerminal, server.sessionId());
    expect(attached(server).map((row) => row.TerminalId)).toEqual(["term-1"]);
  });

  it("ending the shell tells the server and hides the panel; a failure keeps it open", async () => {
    const closes: Array<{ TerminalId: string }> = [];
    let refuse = true;
    const server = await connect(undefined, null, {
      closeTerminal: (effect: { TerminalId: string }) => {
        if (refuse) throw new Error("server said no");
        closes.push(effect);
      },
    });
    await server.open();
    await withProject(server, null);
    await server.runtime.dispatch(openTerminal, server.sessionId());
    await server.runtime.dispatch(endTerminal, server.sessionId());
    expect(panel(server)).toMatchObject({ Open: true, Error: "server said no" });
    expect(server.runtime.processSelector(ending, () => server.session())).toBe(false);
    expect(attached(server)).toHaveLength(1);
    refuse = false;
    await server.runtime.dispatch(endTerminal, server.sessionId());
    expect(closes.map((close) => close.TerminalId)).toEqual(["term-1"]);
    expect(panel(server).Open).toBe(false);
    expect(attached(server)).toEqual([]);
    expect(server.terminals.size).toBe(0);
  });

  it("detaches while another thread is selected, and a return or a reload reattaches", async () => {
    const launch = { Cwd: "/root", WorktreePath: null, ProjectRoot: "/root" };
    const server = await connect();
    server.terminals.set("a", launch);
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    await settled();
    expect(attached(server).map((row) => row.ThreadId)).toEqual(["a"]);
    expect(panel(server, "a").Open).toBe(true);
    expect(terminal(server, "a").FocusOnMount).toBe(false);
    await server.runtime.dispatch(selectThread, server.envId(), "b");
    await settled();
    expect(attached(server)).toEqual([]);
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    await settled();
    expect(attached(server).map((row) => row.ThreadId)).toEqual(["a"]);
  });

  it("deleting the thread disposes the attachment and forgets the launch", async () => {
    const server = await connect();
    await server.open();
    await withProject(server, null);
    await server.runtime.dispatch(openTerminal, server.sessionId());
    expect(server.terminals.has(THREAD_ID)).toBe(true);
    const gone = server.disposed(server.sessionId());
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("thread.deleted", {}),
    } as IWireThreadItem);
    await gone;
    expect(attached(server)).toEqual([]);
    await settled();
    expect(server.terminals.has(THREAD_ID)).toBe(false);
  });

  it("shows what the shell reports, and forgets it when the thread closes", async () => {
    const server = await connect();
    await server.open();
    await withProject(server, null);
    await server.runtime.dispatch(openTerminal, server.sessionId());
    const session = server.sessionId();
    const deliver = (message: object) =>
      server.runtime.dispatch(
        TerminalReceiver.handle,
        session,
        { Type: "Terminal/Session", ...message } as never,
        { publisher: { Id: session } },
      );
    await deliver({ Status: "running", Error: null });
    expect(terminal(server).Status).toBe("running");
    await deliver({ Status: "exited", Error: null });
    expect(terminal(server).Status).toBe("exited");
    await server.runtime.dispatch(closeThread, server.envId(), THREAD_ID);
    await settled();
    expect(terminal(server).Status).toBeNull();
  });
});

describe("reconnect", () => {
  it("keeps the data on screen, skips what it has, and applies what it missed", async () => {
    const server = await connect();
    await server.open();
    await server.sendThread(snapshotOf(longThread(3), 5));
    await server.sendThread({ kind: "synchronized" });
    const node = server.thread();
    const resubscribed = { Type: "Thread/Stream", Resubscribing: true } as const;
    await server.runtime.dispatch(ThreadReceiver.handle, server.openId(), resubscribed, {
      publisher: { Id: server.openId() },
    });
    const synchronized = () => server.runtime.processSelector(threadSynchronized, server.thread);
    expect(synchronized()).toBe(false);
    expect(server.thread().Timeline).toEqual(["item-0", "item-1", "item-2"]);

    await server.sendThread({
      kind: "event",
      sequence: 5,
      event: event("turn-item.updated", commandItem("stale", "run-0", 9)),
    } as IWireThreadItem);
    await server.sendThread({
      kind: "event",
      sequence: 6,
      event: event("turn-item.updated", commandItem("missed", "run-0", 9)),
    } as IWireThreadItem);
    await server.sendThread({ kind: "synchronized" });
    expect(server.thread()).toBe(node);
    expect(server.thread().Timeline).toEqual(["item-0", "item-1", "item-2", "missed"]);
    expect(server.thread().LastSequence).toBe(6);
    expect(synchronized()).toBe(true);
    const row = server.runtime.resources().find((resource) => resource.Key === "Thread/Stream");
    expect(row?.ResumeFrom).toBe("LastSequence");
  });
});

describe("the replica's writers", () => {
  it("are the stream receivers, opening and closing, history pages and providers, plus every action on a replica entity", async () => {
    const server = await connect(
      async () =>
        ({
          snapshotSequence: 1,
          items: [localRow(commandItem("c-0", "run-1", 0), 0)],
          nextCursor: null,
          hasMoreHistory: false,
        }) as unknown as IWireHistoryPage,
      null,
      {
        startTurn: () => undefined,
        stopThread: () => undefined,
        threadDiff: () => "",
        respondRequest: () => undefined,
      },
    );
    const actions = new Map<string, { Name: string | null; Path: string[] }>();
    const writers = new Set<string | null>();
    const replica = server.environment().Replica.$Id;
    server.runtime.on("record", (record) => {
      if (record.Kind === "action:start") actions.set(record.ActionId, record);
      if (record.Kind !== "step") return;
      const action = actions.get(record.ActionId);
      const onReplica =
        action?.Path.includes(replica) ||
        record.Changes.some((change) => change.Path.includes("Replica"));
      if (onReplica) writers.add(action?.Name ?? null);
    });
    await server.open();
    await server.sendThread({
      ...snapshotOf(
        {
          ...longThread(3),
          runtimeRequests: [
            {
              id: "r-1",
              kind: "command",
              status: "pending",
              responseCapability: { type: "live" },
            },
          ],
        } as never,
        1,
      ),
      historyCursor: "older",
      hasMoreHistory: true,
    });
    await server.sendShell({ kind: "synchronized" });
    await server.runtime.dispatch(loadProviders, server.envId());
    await server.runtime.dispatch(setDraft, server.sessionId(), "local only");
    await server.runtime.dispatch(send, server.sessionId());
    await server.runtime.dispatch(stopRun, server.sessionId());
    await server.runtime.dispatch(openDiff, server.sessionId(), "thread", null);
    await server.runtime.dispatch(openTerminal, server.sessionId());
    await server.runtime.dispatch(closeTerminal, server.sessionId());
    const request = server.thread().RuntimeRequests["r-1"]!.$Id;
    await server.runtime.dispatch(answerRequest, request, ENV, THREAD_ID, "accept", null);
    await server.runtime.dispatch(loadEarlier, server.thread().History!.$Id);
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("thread.deleted", {}),
    } as IWireThreadItem);
    await settled();
    expect(server.thread()).toBeUndefined();
    await server.open();
    await server.runtime.dispatch(closeThread, server.envId(), THREAD_ID);
    expect([...writers].sort()).toEqual([
      "EnvironmentReceiver",
      "ShellReceiver",
      "ThreadReceiver",
      "answerRequest",
      "closeThread",
      "loadEarlier",
      "loadProviders",
      "openThread",
    ]);
  });
});
