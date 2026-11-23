import { describe, expect, it } from "vite-plus/test";

import type { IWireProjection, IWireThreadShell } from "./Infrastructure/wire";
import { type ILineageInput, threadLineage } from "./lineage";
import { thread } from "./testing/threadFixture";

type ISubagent = IWireProjection["subagents"][number];

function shell(
  id: string,
  parentThreadId: string | null,
  createdAt: string,
  options: {
    Relationship?: "fork" | "subagent";
    SideChat?: boolean;
    Run?: boolean;
    Status?: string;
    Extra?: Record<string, unknown>;
  } = {},
): IWireThreadShell {
  return {
    ...thread(id),
    title: `Thread ${id}`,
    createdAt,
    status: options.Status ?? "completed",
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
    ...options.Extra,
  } as unknown as IWireThreadShell;
}

function subagent(
  id: string,
  childThreadId: string | null,
  status: string,
  extra: Record<string, unknown> = {},
): ISubagent {
  return {
    id,
    threadId: "current",
    childThreadId,
    status,
    title: null,
    prompt: `Prompt ${id}`,
    startedAt: "2026-06-20T00:00:00.000Z",
    completedAt: status === "running" ? null : "2026-06-20T00:01:30.000Z",
    updatedAt: "2026-06-20T00:01:30.000Z",
    ...extra,
  } as unknown as ISubagent;
}

function lineage(input: Partial<ILineageInput> & { thread: ILineageInput["thread"] }) {
  return threadLineage({ subagents: [], contextTransfers: [], shells: [], titles: null, ...input });
}

const rowsOf = (
  rows: ReadonlyArray<{ ThreadId: string; Relation: string; Title: string | null }>,
) => rows.map((row) => [row.ThreadId, row.Relation, row.Title]);

describe("threadLineage", () => {
  it("lists the parent first, then forks newest first, with side chats in their own group", () => {
    const current = shell("current", "parent", "2026-06-20T00:00:00.000Z", { Run: true });
    const result = lineage({
      thread: current as never,
      shells: [
        shell("parent", null, "2026-06-19T00:00:00.000Z"),
        current,
        shell("older-fork", "current", "2026-06-21T00:00:00.000Z"),
        shell("newer-fork", "current", "2026-06-22T00:00:00.000Z"),
        shell("side", "current", "2026-06-24T00:00:00.000Z", { SideChat: true }),
      ],
    });
    expect(rowsOf(result.Related)).toEqual([
      ["parent", "parent", "Thread parent"],
      ["newer-fork", "fork", "Thread newer-fork"],
      ["older-fork", "fork", "Thread older-fork"],
    ]);
    expect(rowsOf(result.SideChats)).toEqual([["side", "sideChat", "Thread side"]]);
    expect(result.Related[0]?.MergeTarget).toBe(true);
    expect(result.Related[1]?.MergeTarget).toBe(false);
  });

  it("keeps a parent the shell has dropped, untitled, and asks for its title", () => {
    const current = shell("current", "gone", "2026-06-20T00:00:00.000Z", { Run: true });
    const result = lineage({ thread: current as never, shells: [current] });
    expect(result.Related).toMatchObject([{ ThreadId: "gone", Relation: "parent", Title: null }]);
    expect(result.Lookup).toEqual(["gone"]);
  });

  it("titles a dropped parent from the lookup, and drops it once the lookup says it's deleted", () => {
    const current = shell("current", "gone", "2026-06-20T00:00:00.000Z", { Run: true });
    expect(
      lineage({ thread: current as never, shells: [current], titles: { gone: "Old parent" } })
        .Related,
    ).toMatchObject([{ ThreadId: "gone", Title: "Old parent" }]);
    expect(lineage({ thread: current as never, shells: [current], titles: {} }).Related).toEqual(
      [],
    );
  });

  it("splits subagents into running and previous, and counts the running ones", () => {
    const current = shell("current", null, "2026-06-20T00:00:00.000Z");
    const result = lineage({
      thread: current as never,
      subagents: [
        subagent("a-run", "child-run", "running"),
        subagent("a-done", "child-done", "completed", { title: "Subagent: Review" }),
        subagent("a-failed", "child-failed", "failed"),
        subagent("a-inline", null, "running"),
      ],
      shells: [
        current,
        shell("child-run", "current", "2026-06-20T00:02:00.000Z", {
          Relationship: "subagent",
          Status: "running",
          Extra: { activityRunStatus: "running" },
        }),
        shell("child-done", "current", "2026-06-20T00:03:00.000Z", { Relationship: "subagent" }),
      ],
    });
    expect(rowsOf(result.Active)).toEqual([["child-run", "subagent", "Thread child-run"]]);
    expect(rowsOf(result.Previous)).toEqual([
      ["child-done", "subagent", "Thread child-done"],
      // The idle child the shell left out takes the task's own title.
      ["child-failed", "subagent", "Prompt a-failed"],
    ]);
    expect(result.Previous.map((row) => row.Status)).toEqual(["completed", "failed"]);
    // One child thread running, plus one task running inline with no thread.
    expect(result.Running).toBe(2);
    expect(result.Related).toEqual([]);
    expect(result.Lookup).toEqual([]);
  });

  it("strips the subagent prefix from a subagent's title", () => {
    const current = shell("current", null, "2026-06-20T00:00:00.000Z");
    const result = lineage({
      thread: current as never,
      subagents: [subagent("a", "child", "completed", { title: "Subagent: Review the diff" })],
      shells: [current],
    });
    expect(result.Previous[0]?.Title).toBe("Review the diff");
  });

  it("times a finished task, and follows a newer run in its child thread", () => {
    const current = shell("current", null, "2026-06-20T00:00:00.000Z");
    const result = lineage({
      thread: current as never,
      subagents: [subagent("a", "child", "completed")],
      shells: [
        current,
        shell("child", "current", "2026-06-20T00:00:00.000Z", {
          Relationship: "subagent",
          Status: "running",
          Extra: {
            activityRunStatus: "running",
            activityRunStartedAt: "2026-06-20T01:00:00.000Z",
            latestRunRequestedAt: "2026-06-20T01:00:00.000Z",
          },
        }),
      ],
    });
    expect(result.Active[0]?.Agent).toEqual({
      Status: "running",
      StartedAt: "2026-06-20T01:00:00.000Z",
      CompletedAt: null,
    });
  });

  it("lists a current subagent thread's parent as its parent agent", () => {
    const current = shell("current", "owner", "2026-06-20T00:00:00.000Z", {
      Relationship: "subagent",
    });
    const result = lineage({
      thread: current as never,
      shells: [shell("owner", null, "2026-06-19T00:00:00.000Z"), current],
    });
    expect(rowsOf(result.Related)).toEqual([["owner", "parentAgent", "Thread owner"]]);
    expect(result.Related[0]?.MergeTarget).toBe(false);
  });

  it("lists context transfers with the related threads", () => {
    const current = shell("current", null, "2026-06-20T00:00:00.000Z");
    const result = lineage({
      thread: current as never,
      contextTransfers: [
        { sourceThreadId: "current", targetThreadId: "elsewhere", status: "completed" } as never,
      ],
      shells: [current, shell("elsewhere", null, "2026-06-21T00:00:00.000Z")],
    });
    expect(rowsOf(result.Related)).toEqual([["elsewhere", "transfer", "Thread elsewhere"]]);
  });

  it("lists a task delegated to a linked environment by its status", () => {
    const current = shell("current", null, "2026-06-20T00:00:00.000Z");
    const remoteChild = { environmentId: "env-2", threadId: "there", label: "Laptop" };
    const result = lineage({
      thread: current as never,
      subagents: [
        subagent("r-run", null, "running", { remoteChild, title: "Remote task" }),
        subagent("r-done", null, "completed", { remoteChild: { ...remoteChild, threadId: "x" } }),
      ],
      shells: [current],
    });
    expect(result.Active).toMatchObject([
      { ThreadId: "there", Relation: "remote", Title: "Remote task", Remote: "Laptop" },
    ]);
    expect(result.Previous).toMatchObject([{ ThreadId: "x", Relation: "remote" }]);
    expect(result.Running).toBe(1);
  });
});
