import { OrchestrationV2ThreadHistoryPage } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { wireCodec } from "./wire";

const decodePage = Schema.decodeUnknownSync(Schema.toCodecJson(OrchestrationV2ThreadHistoryPage));
const encodeWirePage = Schema.encodeSync(wireCodec(OrchestrationV2ThreadHistoryPage));
const decodeWirePage = Schema.decodeUnknownSync(wireCodec(OrchestrationV2ThreadHistoryPage));

const started = "2026-06-20T00:01:00.000Z";
const updated = "2026-06-20T00:03:00.000Z";

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
    startedAt: started,
    completedAt: null,
    updatedAt: updated,
    type: "notification",
    source,
    outcome: "completed",
    summary: "Done",
  },
});

// bench/wire/roundTrip.ts runs the same round trip over a running server's real data.
describe("the tree's codec", () => {
  it("keeps the decoded shape with dates as strings, and decodes what it encoded", () => {
    const decoded = decodePage({
      snapshotSequence: 7,
      items: [
        notification("item-1", {
          kind: "background_task",
          work: "subagent",
          childThreadId: "child-1",
        }),
        notification("item-2", { kind: "background_command" }),
        { ...notification("item-3", { kind: "system" }), item: { type: "from_the_future" } },
      ],
      nextCursor: null,
      hasMoreHistory: false,
    });
    const encoded = JSON.parse(JSON.stringify(encodeWirePage(decoded)));
    expect(encoded.items.map((row: { item: unknown }) => row.item)).toMatchObject([
      {
        source: { kind: "subagent", childThreadId: "child-1" },
        startedAt: started,
        updatedAt: updated,
      },
      { source: { kind: "command" }, completedAt: null },
    ]);
    expect(decodeWirePage(encoded)).toEqual(decoded);
  });
});
