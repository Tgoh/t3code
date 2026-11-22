import { describe, expect, it } from "vite-plus/test";

import { caretOnEdge, promptHistoryEntries, stepPromptHistory } from "./promptHistory";
import type { ISentMessage } from "./userMessage";

const sent = (id: string, text: string, at: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    role: "user",
    text,
    attachments: [],
    createdAt: at,
    ...extra,
  }) as unknown as ISentMessage & {
    id: string;
    role: string;
    createdAt: string;
  };

describe("prompt history", () => {
  it("recalls the user's own prompts oldest to newest, collapsing repeats", () => {
    const entries = promptHistoryEntries([
      sent("m3", "second", "2026-01-03"),
      sent("m1", "first", "2026-01-01"),
      sent("m2", "first", "2026-01-02"),
      { ...sent("a1", "reply", "2026-01-04"), role: "assistant" },
      sent("m4", "Ultrathink:\nthink hard", "2026-01-05"),
      sent("m5", "", "2026-01-06"),
    ]);
    expect(entries).toEqual([
      { Id: "m2", Prompt: "first" },
      { Id: "m3", Prompt: "second" },
      { Id: "m4", Prompt: "think hard" },
    ]);
  });

  it("steps back from an empty draft, forward past the newest to empty, and stops once edited", () => {
    const entries = [
      { Id: "m1", Prompt: "first" },
      { Id: "m2", Prompt: "second" },
    ];
    const back = stepPromptHistory({
      Direction: "backward",
      Entries: entries,
      Position: null,
      Current: "",
    });
    expect(back?.Prompt).toBe("second");
    const older = stepPromptHistory({
      Direction: "backward",
      Entries: entries,
      Position: back!.Position,
      Current: "second",
    });
    expect(older?.Prompt).toBe("first");
    expect(
      stepPromptHistory({
        Direction: "backward",
        Entries: entries,
        Position: older!.Position,
        Current: "first",
      }),
    ).toBeNull();
    const newer = stepPromptHistory({
      Direction: "forward",
      Entries: entries,
      Position: back!.Position,
      Current: "second",
    });
    expect(newer).toEqual({ Position: null, Prompt: "" });
    expect(
      stepPromptHistory({
        Direction: "backward",
        Entries: entries,
        Position: back!.Position,
        Current: "second, edited",
      }),
    ).toBeNull();
    expect(
      stepPromptHistory({ Direction: "forward", Entries: entries, Position: null, Current: "" }),
    ).toBeNull();
  });

  it("moves only from the first line up or the last line down", () => {
    expect(caretOnEdge("one\ntwo", 2, 2, "backward")).toBe(true);
    expect(caretOnEdge("one\ntwo", 5, 5, "backward")).toBe(false);
    expect(caretOnEdge("one\ntwo", 5, 5, "forward")).toBe(true);
    expect(caretOnEdge("one\ntwo", 2, 2, "forward")).toBe(false);
    expect(caretOnEdge("one", 0, 2, "backward")).toBe(false);
  });
});
