import { describe, expect, it } from "vite-plus/test";

import type { IWireThreadShell } from "./Infrastructure/wire";
import { forkLineage } from "./lineage";
import { thread } from "./testing/threadFixture";

function shell(
  id: string,
  parentThreadId: string | null,
  createdAt: string,
  options: { Relationship?: "fork" | "subagent"; SideChat?: boolean; Run?: boolean } = {},
): IWireThreadShell {
  return {
    ...thread(id),
    title: `Thread ${id}`,
    createdAt,
    status: "completed",
    activityRunStatus: null,
    lineage: {
      rootThreadId: parentThreadId ?? id,
      parentThreadId,
      relationshipToParent: parentThreadId === null ? null : (options.Relationship ?? "fork"),
      ...(options.SideChat ? { sideChat: true } : {}),
    },
    forkedFrom:
      options.Run && parentThreadId !== null
        ? { type: "run", threadId: parentThreadId, runId: "run-1" }
        : null,
  } as unknown as IWireThreadShell;
}

describe("forkLineage", () => {
  it("lists the parent first, then forks newest first, leaving out subagents and side chats", () => {
    const current = shell("current", "parent", "2026-06-20T00:00:00.000Z", { Run: true });
    const rows = forkLineage(current as never, [
      shell("parent", null, "2026-06-19T00:00:00.000Z"),
      current,
      shell("older-fork", "current", "2026-06-21T00:00:00.000Z"),
      shell("newer-fork", "current", "2026-06-22T00:00:00.000Z"),
      shell("agent", "current", "2026-06-23T00:00:00.000Z", { Relationship: "subagent" }),
      shell("side", "current", "2026-06-24T00:00:00.000Z", { SideChat: true }),
    ]);
    expect(rows.map((row) => [row.ThreadId, row.Parent, row.Title])).toEqual([
      ["parent", true, "Thread parent"],
      ["newer-fork", false, "Thread newer-fork"],
      ["older-fork", false, "Thread older-fork"],
    ]);
  });

  it("keeps a parent the shell has dropped, without a title", () => {
    const current = shell("current", "gone", "2026-06-20T00:00:00.000Z", { Run: true });
    expect(forkLineage(current as never, [current])).toMatchObject([
      { ThreadId: "gone", Parent: true, Title: null },
    ]);
  });
});
