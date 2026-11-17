import {
  CLAUDE_RESUME_COMPACTION_NEVER_ANSWER,
  formatClaudeResumeCompactionQuestion,
} from "@t3tools/shared/claudeCompaction";
import { describe, expect, it } from "vite-plus/test";

import {
  compactBeforeSendTokens,
  compactionLabel,
  compactionReason,
  formatContextTokens,
  type ICompactionInput,
} from "./compaction";
import type { IWireTurnItem } from "./Infrastructure/wire";
import { getDefaultOpenThread, type IOpenThread } from "./OpenThread";
import { commandItem, run, THREAD_ID, thread } from "./testing/threadFixture";

const USED_AT = "2026-06-20T00:00:00.000Z";
const HOUR = 60 * 60_000;
const PROVIDER_THREAD = "provider-thread";
const CLAUDE = { instanceId: "claudeAgent", model: "claude-opus-4-7" };

function userItem(text = "do the thing", runId = "run-1", attachments: unknown[] = []) {
  return {
    ...commandItem(`user-${runId}`, runId, 0),
    type: "user_message",
    messageId: `message-${runId}`,
    text,
    inputIntent: "turn_start",
    attachments,
  } as unknown as IWireTurnItem;
}

function compactionItem(afterTokenCount: number, providerThreadId: string | null = null) {
  return {
    ...commandItem("compaction-1", "run-1", 1),
    type: "compaction",
    providerThreadId,
    beforeTokenCount: afterTokenCount * 2,
    afterTokenCount,
  } as unknown as IWireTurnItem;
}

function claudeThread(usedTokens: number | null = 300_000, ttlMs?: number): IOpenThread {
  const open = { $Id: "open", ...getDefaultOpenThread("env", THREAD_ID) } as IOpenThread;
  open.Thread = {
    ...thread(),
    modelSelection: CLAUDE,
    activeProviderThreadId: PROVIDER_THREAD,
  } as never;
  open.Runs["run-1"] = { ...run("run-1", 1), modelSelection: CLAUDE } as never;
  open.ProviderThreads[PROVIDER_THREAD] = {
    id: PROVIDER_THREAD,
    providerInstanceId: "claudeAgent",
    contextUsage: null,
    updatedAt: USED_AT,
  } as never;
  if (usedTokens !== null) {
    open.ProviderTurns["turn-1"] = {
      id: "turn-1",
      providerThreadId: PROVIDER_THREAD,
      tokenUsage: {
        usedTokens,
        updatedAt: USED_AT,
        ...(ttlMs === undefined ? {} : { promptCacheTtlMs: ttlMs }),
      },
    } as never;
  }
  return open;
}

const claudeProvider = (slashCommands = [{ name: "compact" }]) => ({
  instanceId: "claudeAgent",
  driver: "claudeAgent",
  slashCommands,
});

function input(patch: Partial<ICompactionInput> = {}): ICompactionInput {
  const items = [userItem()];
  return {
    Thread: claudeThread(),
    Items: () => items,
    Selection: CLAUDE as never,
    Config: {
      providers: [claudeProvider()],
      settings: { providerInstances: {}, compactIdleThreads: false },
    } as never,
    Text: "carry on",
    Idle: true,
    Now: Date.parse(USED_AT) + 2 * HOUR,
    ...patch,
  };
}

describe("compactBeforeSendTokens", () => {
  it("offers the latest context figure once Claude's cache has expired", () => {
    expect(compactBeforeSendTokens(input())).toBe(300_000);
  });

  it("waits out the prompt cache, the turn's own TTL when it reports one", () => {
    expect(compactBeforeSendTokens(input({ Now: Date.parse(USED_AT) + HOUR }))).toBeNull();
    expect(
      compactBeforeSendTokens(
        input({ Thread: claudeThread(300_000, 5 * 60_000), Now: Date.parse(USED_AT) + HOUR }),
      ),
    ).toBe(300_000);
  });

  it("stays quiet below 200K tokens", () => {
    expect(compactBeforeSendTokens(input({ Thread: claudeThread(199_999) }))).toBeNull();
    expect(compactBeforeSendTokens(input({ Thread: claudeThread(200_000) }))).toBe(200_000);
  });

  it("falls back to the provider thread's usage, then the last compaction's result", () => {
    const fromThread = claudeThread(null);
    fromThread.ProviderThreads[PROVIDER_THREAD]!.contextUsage = { usedTokens: 250_000 } as never;
    expect(compactBeforeSendTokens(input({ Thread: fromThread }))).toBe(250_000);

    const items = [userItem(), compactionItem(210_000, PROVIDER_THREAD)];
    expect(compactBeforeSendTokens(input({ Thread: claudeThread(null), Items: () => items }))).toBe(
      210_000,
    );
    const retired = [userItem(), compactionItem(210_000, "retired-thread")];
    expect(
      compactBeforeSendTokens(input({ Thread: claudeThread(null), Items: () => retired })),
    ).toBeNull();
  });

  it("needs a provider that compacts, with idle compaction left on", () => {
    const noCompact = { providers: [claudeProvider([])], settings: input().Config.settings };
    expect(compactBeforeSendTokens(input({ Config: noCompact as never }))).toBeNull();
    const codex = { instanceId: "codex", driver: "codex", slashCommands: [{ name: "compact" }] };
    expect(
      compactBeforeSendTokens(
        input({
          Config: { providers: [codex], settings: input().Config.settings } as never,
          Selection: { instanceId: "codex", model: "gpt-5.4" } as never,
        }),
      ),
    ).toBeNull();
    const off = {
      providers: [claudeProvider()],
      settings: { providerInstances: {}, compactIdleThreads: false, idleCompaction: "off" },
    };
    expect(compactBeforeSendTokens(input({ Config: off as never }))).toBeNull();
  });

  it("stays quiet while the thread is busy, asks something, or holds its queue", () => {
    expect(compactBeforeSendTokens(input({ Idle: false }))).toBeNull();
    const asking = claudeThread();
    asking.RuntimeRequests["request-1"] = { id: "request-1", status: "pending" } as never;
    expect(compactBeforeSendTokens(input({ Thread: asking }))).toBeNull();
    const held = claudeThread();
    held.Runs["run-2"] = { ...run("run-2", 2, "queued"), queueHeld: true } as never;
    expect(compactBeforeSendTokens(input({ Thread: held }))).toBeNull();
  });

  it("leaves a typed /compact alone, since it is the compaction", () => {
    expect(compactBeforeSendTokens(input({ Text: "/compact" }))).toBeNull();
    expect(compactBeforeSendTokens(input({ Text: "/compact keep the plan" }))).toBeNull();
  });

  it("needs a conversation beyond earlier compactions", () => {
    const onlyCompact = [userItem("/compact")];
    expect(compactBeforeSendTokens(input({ Items: () => onlyCompact }))).toBeNull();
    const withFile = [userItem("/compact", "run-1", [{ id: "file" }])];
    expect(compactBeforeSendTokens(input({ Items: () => withFile }))).toBe(300_000);
    // An earlier page can hold the prompt: a started run with no loaded message counts.
    expect(compactBeforeSendTokens(input({ Items: () => [] }))).toBe(300_000);
  });

  it("stops offering once the provider's own question was answered never ask again", () => {
    const dismissed = claudeThread();
    const question = formatClaudeResumeCompactionQuestion({
      ageMinutes: 90,
      estimatedTokens: 300_000,
    });
    dismissed.RuntimeRequests["request-1"] = {
      id: "request-1",
      kind: "user_input",
      status: "resolved",
      answers: { [question]: CLAUDE_RESUME_COMPACTION_NEVER_ANSWER },
    } as never;
    expect(compactBeforeSendTokens(input({ Thread: dismissed }))).toBeNull();
  });

  it("is off when switching to a model that would hand the thread off", () => {
    const codex = { instanceId: "codex", driver: "codex", slashCommands: [{ name: "compact" }] };
    const config = { providers: [claudeProvider(), codex], settings: input().Config.settings };
    const selection = { instanceId: "codex", model: "gpt-5.4" } as never;
    expect(
      compactBeforeSendTokens(input({ Config: config as never, Selection: selection })),
    ).toBeNull();
  });
});

describe("compaction rows", () => {
  const item = (status: string, counts = true) =>
    ({
      ...commandItem("compaction-1", "run-1", 1),
      type: "compaction",
      status,
      ...(counts ? { beforeTokenCount: 64_800, afterTokenCount: 14_300 } : {}),
    }) as unknown as Extract<IWireTurnItem, { type: "compaction" }>;

  it("say why T3 Code compacted, from the prompt that started the run", () => {
    const open = claudeThread();
    open.Runs["run-1"] = { ...run("run-1", 1), userMessageId: "message-1" } as never;
    const prompt = { id: "message-1", role: "user", text: "/compact", attachments: [] };
    open.Messages["message-1"] = { ...prompt, idleCompaction: "onReturn" } as never;
    expect(compactionReason(open, item("completed"))).toBe("onReturn");
    open.Messages["message-1"] = prompt as never;
    expect(compactionReason(open, item("completed"))).toBeUndefined();
  });

  it("read like stock's, by reason and status", () => {
    expect([
      compactionLabel(item("completed"), "onReturn"),
      compactionLabel(item("completed", false), "onReturn"),
      compactionLabel(item("running"), "onReturn"),
      compactionLabel(item("completed"), "beforeCacheExpires"),
      compactionLabel(item("completed"), undefined),
      compactionLabel(item("failed"), "onReturn"),
    ]).toEqual([
      "Context compacted before sending 64.8K → 14.3K tokens",
      "Context compacted before sending",
      "Compacting…",
      "Auto-compacted before cache expiry 64.8K → 14.3K tokens",
      "Context compacted 64.8K → 14.3K tokens",
      "Context compaction failed",
    ]);
  });
});

describe("formatContextTokens", () => {
  it("reads like stock's composer", () => {
    expect([999, 1_500, 10_000, 439_400, 999_499, 999_500, 1_250_000].map(formatContextTokens))
      .toMatchInlineSnapshot(`
        [
          "999",
          "1.5k",
          "10k",
          "439k",
          "999k",
          "1m",
          "1.3m",
        ]
      `);
  });
});
