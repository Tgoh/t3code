import { expect, it, vi } from "vite-plus/test";

import { readChangedFiles } from "./changedFilesMemory";

it("reads each card's choices, and an earlier build's Expand all entry as a closed card", () => {
  const held = new Map([
    [
      "treflex-web:changed-files-expanded:thread-1",
      JSON.stringify({
        "run-1": true,
        "run-2": { Open: true, Expanded: false },
        "run-3": { Open: false, Expanded: false },
        "run-4": "open",
      }),
    ],
  ]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => held.get(key) ?? null });
  expect(readChangedFiles("thread-1")).toEqual({
    "run-1": { Open: false, Expanded: true },
    "run-2": { Open: true, Expanded: false },
  });
  expect(readChangedFiles("thread-2")).toEqual({});
});
