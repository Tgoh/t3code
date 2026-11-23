import { describe, expect, it } from "vite-plus/test";

import type { IWireThreadShell } from "./Infrastructure/wire";
import {
  emptyNotifyGate,
  nextRelease,
  notificationStatus,
  notificationTitle,
  observeNotifications,
  pauseNotifications,
  releaseNotifications,
  threadNotificationTag,
} from "./threadNotifications";

const AT = "2026-01-01T00:00:00.000Z";
const DONE_AT = "2026-01-01T00:05:00.000Z";

const thread = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "t-1",
    projectId: "p-1",
    title: "Fix the build",
    status: "running",
    latestRunId: "run-1",
    activeRunId: "run-1",
    latestRunCompletedAt: null,
    updatedAt: AT,
    archivedAt: null,
    pendingRuntimeRequest: null,
    lineage: { rootThreadId: "t-1", parentThreadId: null, relationshipToParent: null },
    ...overrides,
  }) as unknown as IWireThreadShell;

const completed = (overrides: Record<string, unknown> = {}) =>
  thread({ status: "completed", activeRunId: null, latestRunCompletedAt: DONE_AT, ...overrides });

const request = (id: string, kind = "command_approval") => ({
  pendingRuntimeRequest: { id, kind, createdAt: AT },
});

function track() {
  const gate = emptyNotifyGate();
  return {
    gate,
    see: (threads: IWireThreadShell[], now = 0, subagents = {}) =>
      observeNotifications(gate, threads, subagents, now).map((note) => [note.ThreadId, note.Kind]),
  };
}

describe("which thread transitions notify", () => {
  it("stays quiet on the first sighting, then notifies a run that completes", () => {
    const { see } = track();
    expect(see([completed()])).toEqual([]);
    expect(see([thread({ latestRunId: "run-2", activeRunId: "run-2" })])).toEqual([]);
    expect(
      see([completed({ latestRunId: "run-2", latestRunCompletedAt: "2026-01-01T00:09:00.000Z" })]),
    ).toEqual([["t-1", "completion"]]);
  });

  it("notifies each completion once", () => {
    const { see } = track();
    see([thread()]);
    expect(see([completed()])).toEqual([["t-1", "completion"]]);
    expect(see([completed({ title: "Renamed" })])).toEqual([]);
  });

  it("notifies an approval, a question and a failure as needing input", () => {
    const { see } = track();
    see([thread()]);
    expect(see([thread(request("req-1"))])).toEqual([["t-1", "input"]]);
    expect(see([thread(request("req-2", "user_input"))])).toEqual([["t-1", "input"]]);
    expect(see([thread({ status: "failed", activeRunId: null })])).toEqual([["t-1", "input"]]);
  });

  it("announces a request once by its id, even when queued runs move the latest run", () => {
    const { see } = track();
    see([thread()]);
    expect(see([thread(request("req-1"))])).toEqual([["t-1", "input"]]);
    expect(see([thread({ ...request("req-1"), latestRunId: "run-2" })])).toEqual([]);
  });

  it("notifies a subagent's approval on its listed parent, and nothing for the subagent", () => {
    const { see } = track();
    const child = thread({
      id: "child",
      lineage: { rootThreadId: "t-1", parentThreadId: "t-1", relationshipToParent: "subagent" },
    });
    see([thread(), child]);
    expect(see([thread(), child], 0, { "t-1": "approval" })).toEqual([["t-1", "input"]]);
  });

  it.each([
    ["an archived thread", { archivedAt: AT }],
    ["a stopped run", { latestRunStopRequested: true }],
    ["a snoozed thread", { snoozedUntil: "2099-01-01T00:00:00.000Z", snoozedAt: AT }],
  ])("stays quiet when %s completes", (_label, change) => {
    const { see } = track();
    see([thread(change)], Date.parse(DONE_AT));
    expect(see([completed(change)], Date.parse(DONE_AT))).toEqual([]);
  });

  it("waits out the grace after a background wake before announcing it", () => {
    const { gate, see } = track();
    see([thread()], 0);
    expect(see([completed({ latestRunBackgroundWake: true })], 1_000)).toEqual([]);
    expect(nextRelease(gate)).toBe(6_000);
    expect(releaseNotifications(gate, 5_999)).toEqual([]);
    expect(releaseNotifications(gate, 6_000).map((note) => note.Kind)).toEqual(["completion"]);
    expect(nextRelease(gate)).toBeNull();
  });

  it("drops a held background wake when a new run starts", () => {
    const { gate, see } = track();
    see([thread()], 0);
    see([completed({ latestRunBackgroundWake: true })], 1_000);
    see([thread({ latestRunId: "run-2", activeRunId: "run-2" })], 2_000);
    expect(nextRelease(gate)).toBeNull();
  });

  it("restarts a paused grace on the next sighting", () => {
    const { gate, see } = track();
    see([thread()], 0);
    see([completed({ latestRunBackgroundWake: true })], 1_000);
    pauseNotifications(gate);
    expect(nextRelease(gate)).toBeNull();
    see([completed({ latestRunBackgroundWake: true })], 10_000);
    expect(nextRelease(gate)).toBe(15_000);
  });

  it("forgets threads that leave the shell", () => {
    const { gate, see } = track();
    see([thread()]);
    see([]);
    expect(gate).toEqual(emptyNotifyGate());
  });
});

describe("what a notification says", () => {
  it.each([
    ["completion", completed(), "Thread completed"],
    ["input", thread(request("req-1")), "Approval needed"],
    ["input", thread(request("req-1", "user_input")), "Input needed"],
    ["input", thread({ status: "failed" }), "Thread failed"],
    ["input", thread({ status: "failed", lastErrorClass: "usage_limit" }), "Usage limit reached"],
    ["input", thread({ pendingGuestMessageCount: 1 }), "Guest request"],
  ] as const)("titles %s for %s", (kind, shell, title) => {
    expect(notificationTitle(notificationStatus(kind, shell, undefined))).toBe(title);
  });

  it("tags a thread with a short hash Windows keeps", () => {
    expect(threadNotificationTag("env-1", "t-1")).toMatch(/^[0-9a-f]{16}$/);
    expect(threadNotificationTag("env-1", "t-1")).not.toBe(threadNotificationTag("env-1", "t-2"));
  });
});
