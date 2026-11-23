import { describe, expect, it } from "vite-plus/test";

import type { IWireTurnItem } from "./Infrastructure/wire";
import { getDefaultOpenThread, type IOpenThread } from "./OpenThread";
import { commandItem, run, THREAD_ID, thread } from "./testing/threadFixture";
import {
  shownThreadError,
  threadErrorBannerMessage,
  threadErrorKey,
  threadRuntimeError,
} from "./threadError";

function errorItem(id: string, runId: string, message: string, completedAt: string) {
  return {
    ...commandItem(id, runId, 1),
    type: "error",
    status: "failed",
    failure: { class: "provider_error", message, code: null, retryable: null },
    completedAt,
    updatedAt: completedAt,
  } as unknown as IWireTurnItem;
}

function failedThread(...failures: Array<{ runId: string; ordinal: number; item: IWireTurnItem }>) {
  const open = { ...getDefaultOpenThread("env-1", THREAD_ID), $Id: "open-1" } as IOpenThread;
  open.Thread = thread();
  for (const failure of failures) {
    open.Runs[failure.runId] = run(failure.runId, failure.ordinal, "failed");
    open.TurnItems[failure.item.id] = failure.item;
  }
  return open;
}

describe("threadRuntimeError", () => {
  it("is the failed run's root error, with that item as its source", () => {
    const open = failedThread({
      runId: "run-1",
      ordinal: 1,
      item: errorItem("error-1", "run-1", "Model overloaded", "2026-11-20T00:00:00.000Z"),
    });
    expect(threadRuntimeError(open)).toEqual({
      Error: "Model overloaded",
      Class: "provider_error",
      Code: null,
      Source: "error-1@2026-11-20T00:00:00.000Z",
    });
  });

  it("is null once a later run completes", () => {
    const open = failedThread({
      runId: "run-1",
      ordinal: 1,
      item: errorItem("error-1", "run-1", "Model overloaded", "2026-11-20T00:00:00.000Z"),
    });
    open.Runs["run-2"] = run("run-2", 2, "completed");
    expect(threadRuntimeError(open)).toBeNull();
  });
});

describe("shownThreadError", () => {
  const first = failedThread({
    runId: "run-1",
    ordinal: 1,
    item: errorItem("error-1", "run-1", "Model overloaded", "2026-11-20T00:00:00.000Z"),
  });

  it("stays hidden once dismissed", () => {
    const error = threadRuntimeError(first)!;
    expect(shownThreadError(error, [])).toBe(error);
    expect(shownThreadError(error, [threadErrorKey(error)])).toBeNull();
  });

  it("comes back when the same text fails again on a new run", () => {
    const dismissed = [threadErrorKey(threadRuntimeError(first)!)];
    const again = failedThread(
      {
        runId: "run-1",
        ordinal: 1,
        item: errorItem("error-1", "run-1", "Model overloaded", "2026-11-20T00:00:00.000Z"),
      },
      {
        runId: "run-2",
        ordinal: 2,
        item: errorItem("error-2", "run-2", "Model overloaded", "2026-11-21T00:00:00.000Z"),
      },
    );
    const error = threadRuntimeError(again)!;
    expect(error.Source).toBe("error-2@2026-11-21T00:00:00.000Z");
    expect(shownThreadError(error, dismissed)).toBe(error);
  });
});

describe("threadErrorBannerMessage", () => {
  it("shows a JSON payload's nested message, and other text as is", () => {
    expect(threadErrorBannerMessage('{"error":{"message":"Rate limited"}}')).toBe("Rate limited");
    expect(threadErrorBannerMessage("plain failure")).toBe("plain failure");
    expect(threadErrorBannerMessage('{"error":{"message":"  "}}')).toBe(
      '{"error":{"message":"  "}}',
    );
  });
});
