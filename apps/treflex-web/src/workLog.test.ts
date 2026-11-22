import { describe, expect, it } from "vite-plus/test";

import { formatWorkspaceRelativePath, type IWorkLogEntry, liveWorkEntryLabel } from "./workLog";

describe("work log labels", () => {
  it("leaves a home path as written rather than joining it to the workspace", () => {
    expect(formatWorkspaceRelativePath("~/.claude/settings.json", "/work/app")).toBe(
      "~/.claude/settings.json",
    );
    expect(formatWorkspaceRelativePath("src/a.ts", "/work/app")).toBe("app/src/a.ts");
  });

  it("names a command run that carries no command by its status", () => {
    const entry = {
      id: "e",
      createdAt: "2026-01-01T00:00:00.000Z",
      label: "Command",
      tone: "tool",
      itemType: "command_execution",
      toolLifecycleStatus: "inProgress",
    } as unknown as IWorkLogEntry;
    expect(liveWorkEntryLabel(entry, undefined, true)).toBe("Running command");
  });
});
