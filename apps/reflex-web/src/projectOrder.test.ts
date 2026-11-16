import { describe, expect, it } from "vite-plus/test";

import { dropGap, moveProject, orderFolders } from "./projectOrder";
import type { IProjectFolder } from "./Shell";

const folder = (id: string, extra: object = {}): IProjectFolder =>
  ({
    ProjectId: id,
    Project: {
      id,
      title: id,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...extra,
    },
    Threads: [],
  }) as never;

const ids = (folders: readonly IProjectFolder[]) => folders.map((held) => held.ProjectId);

describe("moveProject", () => {
  const order = ["a", "b", "c", "d"];

  it("moves up and down by the gap it's dropped in", () => {
    expect(moveProject(order, "c", 0)).toEqual(["c", "a", "b", "d"]);
    expect(moveProject(order, "a", 2)).toEqual(["b", "a", "c", "d"]);
    expect(moveProject(order, "a", 4)).toEqual(["b", "c", "d", "a"]);
    expect(moveProject(order, "d", 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("does nothing when dropped beside itself, and clamps the gap", () => {
    expect(moveProject(order, "b", 1)).toBeNull();
    expect(moveProject(order, "b", 2)).toBeNull();
    expect(moveProject(order, "a", -3)).toBeNull();
    expect(moveProject(order, "c", 99)).toEqual(["a", "b", "d", "c"]);
  });

  it("ignores an id it doesn't hold", () => {
    expect(moveProject(order, "zz", 0)).toBeNull();
  });
});

describe("orderFolders, manual", () => {
  const folders = [folder("b"), folder("a"), folder("c", { pinnedAt: "2026-01-02T00:00:00.000Z" })];

  it("falls back to pinned first, then by title, before anything is saved", () => {
    expect(ids(orderFolders(folders, "manual", [], []))).toEqual(["c", "a", "b"]);
  });

  it("follows the saved order, past pins", () => {
    expect(ids(orderFolders(folders, "manual", ["b", "a", "c"], []))).toEqual(["b", "a", "c"]);
  });

  it("puts a new project after the saved ones and skips deleted or unknown ids", () => {
    const withNew = [...folders, folder("aa")];
    expect(ids(orderFolders(withNew, "manual", ["gone", "b", "nope", "c", "a"], []))).toEqual([
      "b",
      "c",
      "a",
      "aa",
    ]);
    expect(ids(orderFolders([folder("a")], "manual", ["b", "a"], []))).toEqual(["a"]);
  });

  it("keeps an archived project's folder last", () => {
    const archived = folder("old", { archivedAt: "2026-01-01T00:00:00.000Z" });
    expect(ids(orderFolders([archived, ...folders], "manual", ["old", "a"], []))).toEqual([
      "a",
      "c",
      "b",
      "old",
    ]);
  });

  it("round-trips a move through the saved order", () => {
    const shown = ids(orderFolders(folders, "manual", [], []));
    const moved = moveProject(shown, "b", 0)!;
    expect(ids(orderFolders(folders, "manual", moved, []))).toEqual(["b", "c", "a"]);
  });
});

describe("orderFolders, by time", () => {
  const thread = (projectId: string, at: string, extra: object = {}) =>
    ({ id: `${projectId}-${at}`, projectId, createdAt: at, updatedAt: at, ...extra }) as never;

  it("sorts by the latest user message, newest first, pinned on top", () => {
    const folders = [folder("a"), folder("b"), folder("p", { pinnedAt: "2026-01-01" })];
    const threads = [
      thread("a", "2026-02-01T00:00:00.000Z", { latestUserMessageAt: "2026-02-01T00:00:00.000Z" }),
      thread("b", "2026-03-01T00:00:00.000Z", { latestUserMessageAt: "2026-03-01T00:00:00.000Z" }),
      thread("b", "2026-04-01T00:00:00.000Z", { archivedAt: "2026-04-01T00:00:00.000Z" }),
    ];
    expect(ids(orderFolders(folders, "updated_at", [], threads))).toEqual(["p", "b", "a"]);
  });

  it("uses the project's own time when it has no threads, and ignores the saved order", () => {
    const folders = [
      folder("old", { createdAt: "2025-01-01T00:00:00.000Z" }),
      folder("new", { createdAt: "2026-06-01T00:00:00.000Z" }),
    ];
    expect(ids(orderFolders(folders, "created_at", ["old", "new"], []))).toEqual(["new", "old"]);
  });
});

describe("dropGap", () => {
  it("counts the header middles above the pointer", () => {
    const middles = [10, 50, 90];
    expect([0, 10, 11, 49, 51, 200].map((y) => dropGap(middles, y))).toEqual([0, 1, 1, 1, 2, 3]);
    expect(dropGap([], 5)).toBe(0);
  });
});
