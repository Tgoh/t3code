import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { threadHistoryPageImpl } from "./threadHistory";

const at = "2026-06-20T00:03:00.000Z";

const notification = (id: string, source: Record<string, unknown>) => ({
  position: 0,
  visibility: "local",
  sourceThreadId: "thread-1",
  sourceItemId: id,
  item: {
    id,
    threadId: "thread-1",
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: null,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
    type: "notification",
    source,
    outcome: "completed",
    summary: "  Done  ",
  },
});

describe("a history page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("comes back decoded, with stock's notification source and its unknown items dropped", async () => {
    const page = {
      snapshotSequence: 7,
      items: [
        notification("item-1", {
          kind: "background_task",
          work: "subagent",
          childThreadId: "child-1",
        }),
        { ...notification("item-2", { kind: "system" }), item: { type: "from_the_future" } },
      ],
      nextCursor: null,
      hasMoreHistory: false,
    };
    vi.stubGlobal("fetch", async () => Response.json(page));
    const loaded = await threadHistoryPageImpl.fn({
      Type: "threadHistoryPage",
      ThreadId: "thread-1",
      Cursor: "cursor-1",
    });
    expect(loaded.items).toHaveLength(1);
    expect(loaded.items[0]!.item).toMatchObject({
      source: { kind: "subagent", childThreadId: "child-1" },
      summary: "Done",
      updatedAt: at,
    });
  });
});
