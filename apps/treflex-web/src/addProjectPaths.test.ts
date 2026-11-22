import { describe, expect, it } from "vite-plus/test";

import {
  browseTarget,
  chosenFolder,
  defaultCloneDestination,
  enterFolder,
  filterPinnedBrowseEntries,
  folderChoices,
  leaveFolder,
} from "./addProjectPaths";

const entry = (name: string, parent = "/code/") => ({ name, fullPath: `${parent}${name}` });
const names = (entries: ReadonlyArray<{ name: string }>) => entries.map((held) => held.name);

describe("clone destinations", () => {
  it("default to the repository's folder under the add-project folder, or home", () => {
    const url = "https://github.com/pingdotgg/t3code.git";
    expect(defaultCloneDestination({ BaseDirectory: "", GhqCloneLayout: false }, url)).toBe(
      "~/t3code",
    );
    expect(defaultCloneDestination({ BaseDirectory: "E:\\Code", GhqCloneLayout: false }, url)).toBe(
      "E:\\Code\\t3code",
    );
  });

  it("follow the host/owner/repo layout when ghq layout is on", () => {
    expect(
      defaultCloneDestination(
        { BaseDirectory: "/src", GhqCloneLayout: true },
        "git@github.com:pingdotgg/t3code.git",
      ),
    ).toBe("/src/github.com/pingdotgg/t3code");
    expect(
      defaultCloneDestination(
        { BaseDirectory: "E:\\src", GhqCloneLayout: true },
        "https://gitlab.com/group/app",
      ),
    ).toBe("E:\\src\\gitlab.com\\group\\app");
  });

  it("keep the clone's folder at the end while browsing in and out", () => {
    const into = enterFolder({
      query: "/code/t3code",
      directoryPath: "/code/",
      name: "work",
      cloneFolder: "t3code",
      platform: "Linux",
    });
    expect(into).toBe("/code/work/t3code");
    expect(
      enterFolder({
        query: "/code/t3code",
        directoryPath: "/code/",
        name: "t3code",
        cloneFolder: "t3code",
        platform: "Linux",
      }),
    ).toBe("/code/t3code/");
    expect(leaveFolder("/code/", "t3code")).toBe("/code/t3code");
  });
});

describe("folder browsing", () => {
  const entries = [entry("t3code"), entry("reflex"), entry("t3code-addproject"), entry(".git")];

  it("matches by substring and subsequence, best first, and hides dot folders until asked", () => {
    const shown = (query: string) =>
      names(folderChoices({ query, platform: "Linux", entries, cloneFolder: "" }).visibleEntries);
    expect(shown("/code/")).toEqual(["t3code", "reflex", "t3code-addproject"]);
    expect(shown("/code/t3c")).toEqual(["t3code", "t3code-addproject"]);
    expect(shown("/code/add")).toEqual(["t3code-addproject"]);
    expect(shown("/code/rfx")).toEqual(["reflex"]);
    expect(shown("/code/.g")).toEqual([".git"]);
  });

  it("lists everything while the filter is the clone's own folder name", () => {
    const pinned = filterPinnedBrowseEntries({
      entries,
      filterQuery: "T3CODE",
      pinnedName: "t3code",
      caseSensitive: false,
    });
    expect(names(pinned.visibleEntries)).toEqual(["t3code", "reflex", "t3code-addproject"]);
    expect(pinned.exactEntry?.name).toBe("t3code");
    expect(
      filterPinnedBrowseEntries({
        entries,
        filterQuery: "T3CODE",
        pinnedName: "t3code",
        caseSensitive: true,
      }).exactEntry,
    ).toBeNull();
  });

  it("browses a relative path only from an open project", () => {
    expect(browseTarget("./sub/", "Linux", "/code/app")).toBe("./sub/");
    expect(browseTarget("../sib", "Linux", "/code/app")).toBe("../");
    expect(browseTarget("./sub/", "Linux", null)).toBe("");
    expect(browseTarget("/code/sub", "Linux", null)).toBe("/code/");
    expect(browseTarget("app", "Linux", "/code/app")).toBe("");
  });

  it("adds the listed folder for a trailing separator, else the exact match or the typed path", () => {
    const listing = { ParentPath: "/home/me/code/", Entries: entries };
    expect(chosenFolder("~/code/", listing, null)).toBe("/home/me/code/");
    expect(chosenFolder("~/code/", null, null)).toBe("~/code/");
    expect(chosenFolder("~/code/reflex", listing, entries[1]!)).toBe("/code/reflex");
    expect(chosenFolder(" /code/new ", listing, null)).toBe("/code/new");
  });
});
