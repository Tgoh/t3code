import { describe, expect, it } from "vite-plus/test";

import type { TurnRepositoryChanges } from "@t3tools/client-runtime/state/thread-repositories";

import {
  buildChangedFilesTree,
  changedFilesGroups,
  groupDiffPath,
  visibleChangedRows,
} from "./changedFilesTree";

const file = (path: string, additions = 1, deletions = 0) => ({
  path,
  kind: "modified",
  additions,
  deletions,
});

const repository = (
  name: string,
  relativePath: string | undefined,
  files: ReturnType<typeof file>[],
  baselineMissing = false,
) =>
  ({
    scopeId: `scope-${name}`,
    name,
    repositoryPath: `/work/${name}`,
    cwd: `/work/${name}`,
    ...(relativePath === undefined ? {} : { relativePath }),
    files,
    baselineMissing,
  }) as unknown as TurnRepositoryChanges;

describe("changedFilesGroups", () => {
  it("lists a turn without repositories as one tree", () => {
    expect(changedFilesGroups({ files: [file("a.ts")] }, "Test")).toBeNull();
  });

  it("leaves out an unchanged project folder and keeps each repository with its totals", () => {
    const groups = changedFilesGroups(
      {
        files: [],
        repositories: [
          repository("api", "api", [file("src/a.ts", 2, 1), file("b.ts")]),
          repository("old", "old", [], true),
        ],
      },
      "Test",
    )!;
    expect(groups.map((group) => [group.Key, group.Name, group.Totals, group.Note])).toEqual([
      ["scope-api", "api", { count: 2, additions: 3, deletions: 1 }, null],
      [
        "scope-old",
        "old",
        { count: 0, additions: 0, deletions: 0 },
        "This turn's changes in this repository cannot be listed.",
      ],
    ]);
  });

  it("puts the project folder's own files first, under the project's name", () => {
    const groups = changedFilesGroups(
      { files: [file("notes.md")], repositories: [repository("api", "api", [file("a.ts")])] },
      "Test",
    )!;
    expect(groups.map((group) => group.Name)).toEqual(["Test", "api"]);
  });

  it("names a file from the thread's folder, or not at all for a repository outside any shared root", () => {
    const [root, inside, outside] = changedFilesGroups(
      {
        files: [file("notes.md")],
        repositories: [
          repository("api", "../api", [file("a.ts")]),
          repository("far", undefined, [file("b.ts")]),
        ],
      },
      "Test",
    )!;
    expect(groupDiffPath(root!, "notes.md")).toBe("notes.md");
    expect(groupDiffPath(inside!, "src/a.ts")).toBe("../api/src/a.ts");
    expect(groupDiffPath(outside!, "b.ts")).toBeNull();
  });
});

describe("buildChangedFilesTree", () => {
  it("puts folders first and sorts names numerically", () => {
    const tree = buildChangedFilesTree([
      file("file10.ts"),
      file("dir10/file10.ts"),
      file("file2.ts"),
      file("dir2/file10.ts"),
      file("dir2/file2.ts"),
    ]);
    expect(tree.map((node) => node.name)).toEqual(["dir2", "dir10", "file2.ts", "file10.ts"]);
    expect(tree[0]).toMatchObject({ children: [{ name: "file2.ts" }, { name: "file10.ts" }] });
  });

  it("sums each folder's stats over the files below it", () => {
    expect(
      buildChangedFilesTree([
        file("src/index.ts", 2, 1),
        file("src/components/Button.tsx", 4, 2),
        file("README.md", 1, 0),
      ]),
    ).toEqual([
      {
        kind: "directory",
        name: "src",
        path: "src",
        stat: { additions: 6, deletions: 3 },
        children: [
          {
            kind: "directory",
            name: "components",
            path: "src/components",
            stat: { additions: 4, deletions: 2 },
            children: [
              {
                kind: "file",
                name: "Button.tsx",
                path: "src/components/Button.tsx",
                stat: { additions: 4, deletions: 2 },
              },
            ],
          },
          {
            kind: "file",
            name: "index.ts",
            path: "src/index.ts",
            stat: { additions: 2, deletions: 1 },
          },
        ],
      },
      { kind: "file", name: "README.md", path: "README.md", stat: { additions: 1, deletions: 0 } },
    ]);
  });

  it("compacts single-folder chains and stops where a folder branches", () => {
    expect(
      buildChangedFilesTree([file("src/a/b/first.ts"), file("src/c/d/second.ts")]),
    ).toMatchObject([
      {
        name: "src",
        children: [
          { name: "a/b", path: "src/a/b", children: [{ name: "first.ts" }] },
          { name: "c/d", path: "src/c/d", children: [{ name: "second.ts" }] },
        ],
      },
    ]);
    expect(
      buildChangedFilesTree([file("apps/server/src/index.ts"), file("apps/server/main.ts")]),
    ).toMatchObject([
      {
        name: "apps/server",
        path: "apps/server",
        children: [{ name: "src", path: "apps/server/src" }, { name: "main.ts" }],
      },
    ]);
  });
});

describe("visibleChangedRows", () => {
  const tree = buildChangedFilesTree([
    file("src/a/one.ts"),
    file("src/b/two.ts"),
    file("README.md"),
  ]);
  const shown = (overrides: Record<string, boolean>, allExpanded: boolean) =>
    visibleChangedRows(tree, overrides, allExpanded).map(
      (row) => `${"  ".repeat(row.depth)}${row.node.name}`,
    );

  it("shows only the top level while every folder is collapsed", () => {
    expect(shown({}, false)).toEqual(["src", "README.md"]);
  });

  it("shows every row while every folder is expanded", () => {
    expect(shown({}, true)).toEqual(["src", "  a", "    one.ts", "  b", "    two.ts", "README.md"]);
  });

  it("lets a folder's own toggle override the card's state", () => {
    expect(shown({ src: true }, false)).toEqual(["src", "  a", "  b", "README.md"]);
    expect(shown({ "src/b": false }, true)).toEqual([
      "src",
      "  a",
      "    one.ts",
      "  b",
      "README.md",
    ]);
  });
});
