import { describe, expect, it } from "vite-plus/test";

import type { IWireThreadShell } from "./Infrastructure/wire";
import {
  groupResults,
  type IThreadSearchMatch,
  liveScope,
  rankMessages,
  scopeThreads,
  searchThreads,
} from "./threadSearch";

const NOW = Date.parse("2026-06-01T00:00:00.000Z");

const shell = (id: string, title: string, projectId = "p1", extra: object = {}): IWireThreadShell =>
  ({
    id,
    title,
    projectId,
    branch: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    latestUserMessageAt: null,
    ...extra,
  }) as never;

const match = (threadId: string, extra: object = {}): IThreadSearchMatch =>
  ({
    threadId,
    projectId: "p1",
    environmentId: "env",
    source: "user",
    snippet: `about ${threadId}`,
    messageCreatedAt: null,
    ...extra,
  }) as never;

const titles = (results: { Thread: IWireThreadShell }[]) =>
  results.map((held) => held.Thread.title);

describe("searchThreads", () => {
  const threads = [
    shell("t1", "Fix the login page"),
    shell("t2", "Logging cleanup"),
    shell("t3", "Unrelated work"),
    shell("t4", "Another unrelated"),
  ];

  it("ranks title matches, then threads listed only for their messages, in message order", () => {
    const results = searchThreads({
      threads,
      environmentId: "env",
      query: "login",
      messages: [match("t4"), match("t1"), match("t3")],
      messageOrder: ["t4", "t1", "t3"],
      now: NOW,
    });
    expect(titles(results)).toEqual(["Fix the login page", "Another unrelated", "Unrelated work"]);
    expect(results[0]!.Match).toBeNull();
    expect(results[0]!.Ranges.length).toBeGreaterThan(0);
    expect(results[1]!.Match?.snippet).toBe("about t4");
  });

  it("matches nothing for a blank query and leaves out message rows for unlisted threads", () => {
    expect(
      searchThreads({
        threads,
        environmentId: "env",
        query: "  ",
        messages: [],
        messageOrder: [],
        now: NOW,
      }),
    ).toEqual([]);
    const results = searchThreads({
      threads,
      environmentId: "env",
      query: "zzzz",
      messages: [match("gone")],
      messageOrder: ["gone"],
      now: NOW,
    });
    expect(results).toEqual([]);
  });
});

describe("rankMessages", () => {
  it("puts whole-word matches first and keeps shown rows in place when late ones arrive", () => {
    const threads = [shell("a", "A"), shell("b", "B"), shell("c", "C")];
    const first = rankMessages({
      threads,
      environmentId: "env",
      query: "deploy",
      matches: [match("a", { quality: 0.3 }), match("b", { quality: 1 })],
      shown: null,
      now: NOW,
    });
    expect(first.keys).toEqual(["b", "a"]);
    const later = rankMessages({
      threads,
      environmentId: "env",
      query: "deploy",
      matches: [
        match("a", { quality: 0.3 }),
        match("b", { quality: 1 }),
        match("c", { quality: 1 }),
      ],
      shown: first,
      now: NOW,
    });
    expect(later.keys.slice(0, 2)).toEqual(["b", "a"]);
    expect(later.keys).toContain("c");
  });

  it("drops matches for threads this client doesn't list", () => {
    const ranked = rankMessages({
      threads: [shell("a", "A")],
      environmentId: "env",
      query: "deploy",
      matches: [match("a"), match("missing")],
      shown: null,
      now: NOW,
    });
    expect(ranked.keys).toEqual(["a"]);
  });
});

describe("groupResults", () => {
  const result = (thread: IWireThreadShell) => ({ Thread: thread, Ranges: [], Match: null });

  it("groups by project in folder order with a Main thread leading, and lists the rest after", () => {
    const results = [
      result(shell("1", "Feature", "p2")),
      result(shell("2", "Other", "p1")),
      result(shell("3", " main ", "p2")),
      result(shell("4", "Stray", "p9")),
    ];
    const groups = groupResults(results, ["p1", "p2", "p3"]);
    expect(groups.map((group) => group.ProjectId)).toEqual(["p1", "p2", "p9"]);
    expect(titles(groups[1]!.Results)).toEqual([" main ", "Feature"]);
  });

  it("keeps the ranked order as one list when the sidebar isn't grouped", () => {
    const results = [result(shell("1", "B", "p2")), result(shell("2", "A", "p1"))];
    expect(groupResults(results, null)).toEqual([{ ProjectId: null, Results: results }]);
    expect(groupResults([], null)).toEqual([]);
  });
});

describe("project scope", () => {
  const threads = [shell("1", "One", "p1"), shell("2", "Two", "p2"), shell("3", "Three", "p3")];

  it("keeps chosen projects and the selected thread, and an empty scope keeps everything", () => {
    expect(scopeThreads(threads, new Set(["p1"]), "3").map((thread) => thread.id)).toEqual([
      "1",
      "3",
    ]);
    expect(scopeThreads(threads, new Set(), null)).toHaveLength(3);
  });

  it("reads a scope whose projects are gone or hidden as every project", () => {
    const scope = new Set(["p1", "gone"]);
    expect([...liveScope(scope, new Set(["p1", "p2"]))]).toEqual(["p1"]);
    expect(liveScope(new Set(["gone"]), new Set(["p1"])).size).toBe(0);
    const held = new Set(["p1"]);
    expect(liveScope(held, new Set(["p1"]))).toBe(held);
  });
});
