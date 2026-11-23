import { describe, expect, it } from "vite-plus/test";

import {
  type ITitleBatch,
  type ITitleRow,
  settleTitleBatches,
  titleRegenerationToast,
  titleRequest,
} from "./titleRegeneration";

const batch = (...threadIds: string[]): ITitleBatch => ({
  Requests: threadIds.map((id) => titleRequest(id, `req-${id}`)),
});

const armed = (id: string): ITitleRow => ({
  titleRegeneration: { requestId: `req-${id}` },
  lastTitleRegeneration: null,
});

const done = (id: string, status: "renamed" | "unchanged" | "failed", message?: string) => ({
  titleRegeneration: null,
  lastTitleRegeneration: {
    requestId: `req-${id}`,
    status,
    ...(message === undefined ? {} : { message }),
    completedAt: "2026-01-01T00:00:01.000Z",
  },
});

describe("regenerating titles", () => {
  it("waits for every row in a batch to report its request, then hands the outcomes back once", () => {
    const batches = [batch("a", "b")];
    expect(settleTitleBatches(batches, { a: armed("a"), b: armed("b") })).toEqual([]);
    expect(settleTitleBatches(batches, { a: done("a", "renamed"), b: armed("b") })).toEqual([]);
    expect(
      settleTitleBatches(batches, { a: done("a", "renamed"), b: done("b", "unchanged") }),
    ).toEqual([[{ Status: "renamed" }, { Status: "unchanged" }]]);
    expect(batches).toEqual([]);
  });

  it("doesn't take an older request's outcome, or a row that hasn't armed yet, as this one's", () => {
    const batches = [batch("a")];
    const older = {
      titleRegeneration: null,
      lastTitleRegeneration: { ...done("a", "renamed").lastTitleRegeneration, requestId: "old" },
    };
    expect(settleTitleBatches(batches, { a: older })).toEqual([]);
    expect(settleTitleBatches(batches, { a: armed("a") })).toEqual([]);
    expect(settleTitleBatches(batches, { a: older })).toEqual([[null]]);
  });

  it("counts a request another one replaced before the row showed it as no outcome", () => {
    const batches = [batch("a")];
    expect(settleTitleBatches(batches, { a: armed("other") })).toEqual([[null]]);
  });

  it("counts a row that left the shell as no outcome", () => {
    const batches = [batch("a", "b")];
    expect(settleTitleBatches(batches, { b: done("b", "failed", "No model") })).toEqual([
      [null, { Status: "failed", Message: "No model" }],
    ]);
  });

  it("toasts stock's copy for failures and kept titles, and nothing when every title changed", () => {
    expect(titleRegenerationToast([{ Status: "renamed" }])).toBeNull();
    expect(titleRegenerationToast([null])).toBeNull();
    expect(titleRegenerationToast([{ Status: "failed", Message: "No model" }])).toEqual({
      Kind: "error",
      Title: "Failed to regenerate thread title",
      Description: "No model",
    });
    expect(
      titleRegenerationToast([{ Status: "failed" }, { Status: "renamed" }, { Status: "failed" }]),
    ).toEqual({
      Kind: "error",
      Title: "Failed to regenerate 2 of 3 thread titles",
      Description: "Title generation failed.",
    });
    expect(titleRegenerationToast([{ Status: "unchanged" }])).toEqual({
      Kind: "info",
      Title: "Title kept",
      Description: "The current title already fits this thread.",
    });
    expect(titleRegenerationToast([{ Status: "unchanged" }, { Status: "unchanged" }])).toEqual({
      Kind: "info",
      Title: "Titles kept",
      Description: "The current titles already fit these threads.",
    });
    expect(titleRegenerationToast([{ Status: "unchanged" }, { Status: "renamed" }])).toEqual({
      Kind: "info",
      Title: "Kept 1 of 2 titles",
      Description: "Those titles already fit their threads.",
    });
  });
});
