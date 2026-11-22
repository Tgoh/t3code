import { createComponent, createRoot } from "solid-js";
import { createTestRuntime, type IEntity, settled } from "treflex";
import { TreflexProvider } from "treflex-solid";
import { describe, expect, it } from "vite-plus/test";

import ArchivedThreads, { getDefaultArchivedThreads, useArchivedThreads } from "./ArchivedThreads";
import type { IThreadCommand } from "./Infrastructure/commandEffects";

const ARCHIVE = { projects: [], threads: [{ id: "t-9" }] };

function open() {
  const calls: Array<{ Type: string; [key: string]: unknown }> = [];
  const runtime = createTestRuntime<IEntity>(
    { $Id: "Root" },
    {
      archivedShell: (effect: { EnvironmentId: string }) => {
        calls.push({ Type: "archivedShell", EnvironmentId: effect.EnvironmentId });
        return ARCHIVE;
      },
    },
  );
  let page!: ReturnType<typeof useArchivedThreads>;
  const threadCommand = async (_threadId: string, command: IThreadCommand) => {
    calls.push({ Type: "threadCommand", Command: command });
  };
  const Page = ArchivedThreads.provider(() => {
    page = useArchivedThreads("env-1", threadCommand);
    return null;
  }, getDefaultArchivedThreads);
  const close = createRoot((dispose) => {
    createComponent(TreflexProvider, {
      value: runtime,
      get children() {
        return createComponent(Page, {});
      },
    });
    return dispose;
  });
  return { runtime, calls, page: () => page, close };
}

describe("the archive page", () => {
  it("reads the archive as it opens, and drops it as it closes", async () => {
    const archive = open();
    await settled();
    expect(archive.calls).toEqual([{ Type: "archivedShell", EnvironmentId: "env-1" }]);
    const held = archive.page().state;
    expect(held.Archived).toEqual(ARCHIVE);
    expect(archive.runtime.locate(held)).toBeDefined();
    archive.close();
    expect(archive.runtime.locate(held)).toBeUndefined();
  });

  it("unarchives with stock's command and reads the archive again", async () => {
    const archive = open();
    await settled();
    archive.page().command("t-9", "unarchive");
    await settled();
    expect(archive.calls.slice(-2)).toEqual([
      { Type: "threadCommand", Command: { Kind: "unarchive" } },
      { Type: "archivedShell", EnvironmentId: "env-1" },
    ]);
    archive.close();
  });
});
