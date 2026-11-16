import { describe, expect, it } from "vite-plus/test";

import {
  addProjectSources,
  browseSubmitLabel,
  filterSources,
  stepHighlight,
  willCreateFolder,
} from "./addProjectPalette";

describe("add project sources", () => {
  it("offer New project only when the server has a projects root", () => {
    expect(addProjectSources(true).map((source) => source.Id)).toEqual(["new", "local", "url"]);
    expect(addProjectSources(false).map((source) => source.Id)).toEqual(["local", "url"]);
  });

  it("filter on title and search terms, ignoring case", () => {
    const sources = addProjectSources(true);
    expect(filterSources(sources, "").map((source) => source.Id)).toEqual(["new", "local", "url"]);
    expect(filterSources(sources, "CLONE").map((source) => source.Id)).toEqual(["url"]);
    expect(filterSources(sources, "fold").map((source) => source.Id)).toEqual(["local"]);
    expect(filterSources(sources, "repo").map((source) => source.Id)).toEqual(["new", "url"]);
    expect(filterSources(sources, "nothing")).toEqual([]);
  });
});

describe("highlight steps", () => {
  it("start at an end when nothing is highlighted", () => {
    expect(stepHighlight(null, 3, 1)).toBe(0);
    expect(stepHighlight(null, 3, -1)).toBe(2);
  });

  it("wrap at both ends", () => {
    expect(stepHighlight(2, 3, 1)).toBe(0);
    expect(stepHighlight(0, 3, -1)).toBe(2);
    expect(stepHighlight(1, 3, 1)).toBe(2);
  });

  it("have nowhere to go in an empty list", () => {
    expect(stepHighlight(null, 0, 1)).toBeNull();
    expect(stepHighlight(4, 0, -1)).toBeNull();
  });
});

describe("browse submit", () => {
  const base = {
    query: "G:\\Code\\demo",
    pending: false,
    highlighted: false,
    trailingSeparator: false,
    listed: true,
    exactMatch: false,
  };

  it("creates a typed folder that isn't in its parent's listing", () => {
    expect(willCreateFolder(base)).toBe(true);
    expect(willCreateFolder({ ...base, exactMatch: true })).toBe(false);
  });

  it("creates a folder ending in a separator only when it couldn't be listed", () => {
    expect(willCreateFolder({ ...base, trailingSeparator: true, listed: true })).toBe(false);
    expect(willCreateFolder({ ...base, trailingSeparator: true, listed: false })).toBe(true);
  });

  it("never creates while loading, with a row highlighted, or with nothing typed", () => {
    expect(willCreateFolder({ ...base, pending: true })).toBe(false);
    expect(willCreateFolder({ ...base, highlighted: true })).toBe(false);
    expect(willCreateFolder({ ...base, query: "  " })).toBe(false);
  });

  it("labels the button for adding or cloning", () => {
    expect(browseSubmitLabel(false, false)).toBe("Add");
    expect(browseSubmitLabel(false, true)).toBe("Create & Add");
    expect(browseSubmitLabel(true, false)).toBe("Clone");
    expect(browseSubmitLabel(true, true)).toBe("Create & Clone");
  });
});
