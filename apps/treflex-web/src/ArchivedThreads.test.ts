import { children, createComponent, createRenderEffect, createRoot, flush } from "solid-js";
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
  const outcome = { Done: true };
  const threadCommand = async (_threadId: string, command: IThreadCommand) => {
    calls.push({ Type: "threadCommand", Command: command });
    return outcome.Done;
  };
  const Page = ArchivedThreads.provider(() => {
    page = useArchivedThreads("env-1", threadCommand);
    return null;
  }, getDefaultArchivedThreads);
  const close = createRoot((dispose) => {
    const view = children(() =>
      createComponent(TreflexProvider, {
        value: runtime,
        get children() {
          return createComponent(Page, {});
        },
      }),
    );
    createRenderEffect(view, () => {});
    return dispose;
  });
  flush();
  return { runtime, calls, outcome, page: () => page, close };
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

  it("unarchives with stock's command and reads the archive again only when it's taken", async () => {
    const archive = open();
    await settled();
    archive.page().command("t-9", "unarchive");
    await settled();
    expect(archive.calls.slice(-2)).toEqual([
      { Type: "threadCommand", Command: { Kind: "unarchive" } },
      { Type: "archivedShell", EnvironmentId: "env-1" },
    ]);
    archive.outcome.Done = false;
    archive.page().command("t-9", "delete");
    await settled();
    expect(archive.calls.at(-1)).toEqual({ Type: "threadCommand", Command: { Kind: "delete" } });
    archive.close();
  });
});
