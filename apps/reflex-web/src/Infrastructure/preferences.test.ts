import { describe, expect, it, vi } from "vite-plus/test";

import { readPreferences, writePreferences } from "./preferences";

function stubStorage(entries: Record<string, string>) {
  const held = new Map(Object.entries(entries));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
  });
  return held;
}

describe("this device's preferences", () => {
  it("reads the keys and shapes earlier builds and stock wrote", () => {
    stubStorage({
      "reflex-web:group-by-project": "false",
      "reflex-web:closed-folders": '["p-1"]',
      "reflex-web:project-sort": '"created_at"',
      "reflex-web:project-order": '["p-2","p-1",3]',
      "reflex-web:hidden-projects": '["p-3"]',
      "reflex-web:project-scope": '["p-2"]',
      "reflex-web:sidebar-collapsed": "true",
      "t3code:theme-appearance-mode": "dark",
      "t3code:usage-page-preferences:v1": '{"metric":"cost","windowDays":7}',
    });
    expect(readPreferences()).toEqual({
      GroupByProject: false,
      ClosedFolders: ["p-1"],
      ProjectSort: "created_at",
      ProjectOrder: ["p-2", "p-1"],
      HiddenProjects: ["p-3"],
      ProjectScope: ["p-2"],
      SidebarCollapsed: true,
      AppearanceMode: "dark",
      Usage: { Metric: "cost", Days: 7 },
    });
    vi.unstubAllGlobals();
  });

  it("falls back to the defaults for missing or unreadable values", () => {
    stubStorage({
      "reflex-web:project-sort": '"sideways"',
      "reflex-web:closed-folders": "not json",
      "t3code:theme-appearance-mode": "sepia",
    });
    expect(readPreferences()).toEqual({
      GroupByProject: true,
      ClosedFolders: [],
      ProjectSort: "manual",
      ProjectOrder: [],
      HiddenProjects: [],
      ProjectScope: [],
      SidebarCollapsed: false,
      AppearanceMode: "system",
      Usage: { Metric: "limits", Days: 30 },
    });
    vi.unstubAllGlobals();
  });

  it("writes only the patched keys, in the same shapes", () => {
    const held = stubStorage({});
    writePreferences({
      HiddenProjects: ["p-1"],
      ProjectSort: "updated_at",
      AppearanceMode: "light",
      Usage: { Metric: "tokens", Days: 90 },
    });
    expect(Object.fromEntries(held)).toEqual({
      "reflex-web:hidden-projects": '["p-1"]',
      "reflex-web:project-sort": '"updated_at"',
      "t3code:theme-appearance-mode": "light",
      "t3code:usage-page-preferences:v1": '{"metric":"tokens","windowDays":90}',
    });
    expect(readPreferences()).toMatchObject({
      HiddenProjects: ["p-1"],
      ProjectSort: "updated_at",
      AppearanceMode: "light",
      Usage: { Metric: "tokens", Days: 90 },
    });
    vi.unstubAllGlobals();
  });
});
