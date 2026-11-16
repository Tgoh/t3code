import { getInitialServerConfig, request } from "@t3tools/client-runtime/rpc";
import {
  createVcsActionManager,
  createVcsEnvironmentAtoms,
} from "@t3tools/client-runtime/state/vcs";
import { EDITORS, type EditorId, EnvironmentId, ThreadId, WS_METHODS } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { implementation } from "treflex";

import { inEnvironment, LAST_EDITOR_KEY, preferredEditor } from "./commandsImpl";
import { connectionRuntime } from "./connection";
import { atomRuntime, runCommand } from "./sourceControl";
import {
  branchDiffEffect,
  editorsEffect,
  gitActionEffect,
  listBranchesEffect,
  openWithEditorEffect,
  pullEffect,
  refreshVcsStatusEffect,
  runScriptEffect,
  switchBranchEffect,
} from "./sourceControlEffects";

const vcs = createVcsEnvironmentAtoms(atomRuntime);
const vcsActions = createVcsActionManager(atomRuntime);

const BRANCH_LIMIT = 100;

// A thread can open before its environment registers, and followStream waits for that.
const configOnceReady = (environmentId: string) =>
  connectionRuntime.runPromise(
    EnvironmentRegistry.EnvironmentRegistry.pipe(
      Effect.flatMap((registry) =>
        registry
          .followStream(
            EnvironmentId.make(environmentId),
            Stream.fromEffect(getInitialServerConfig()),
          )
          .pipe(Stream.runHead),
      ),
      Effect.map(Option.getOrThrow),
    ),
  );

// Follows getLocalFileManagerName in apps/web/src/lib/utils.ts.
function fileManagerName(platform: string): string {
  if (isMacPlatform(platform)) return "Finder";
  if (/^win(dows)?/i.test(platform)) return "File Explorer";
  return "Files";
}

// The installed editors change only with a server restart, so each card mount needn't ask again.
const editorsByEnvironment = new Map<string, Promise<ReadonlyArray<EditorId>>>();

export const editorsImpl = implementation(editorsEffect, async (input) => {
  let editors = editorsByEnvironment.get(input.EnvironmentId);
  if (editors === undefined) {
    editors = configOnceReady(input.EnvironmentId).then((config) => config.availableEditors);
    editorsByEnvironment.set(input.EnvironmentId, editors);
    editors.catch(() => editorsByEnvironment.delete(input.EnvironmentId));
  }
  const ids = await editors;
  return {
    Available: EDITORS.filter((editor) => ids.includes(editor.id)).map((editor) => ({
      Id: editor.id,
      Label: editor.id === "file-manager" ? fileManagerName(navigator.platform) : editor.label,
    })),
    Preferred: preferredEditor(ids),
  };
});

export const openWithEditorImpl = implementation(openWithEditorEffect, async (input) => {
  try {
    localStorage.setItem(LAST_EDITOR_KEY, JSON.stringify(input.Editor));
  } catch {
    // Without storage the choice lasts only for this open.
  }
  await inEnvironment(
    input.EnvironmentId,
    request(WS_METHODS.shellOpenInEditor, { cwd: input.Cwd, editor: input.Editor as EditorId }),
  );
});

export const refreshVcsStatusImpl = implementation(refreshVcsStatusEffect, async (input) => {
  await runCommand(vcs.refreshStatus, {
    environmentId: EnvironmentId.make(input.EnvironmentId),
    input: { cwd: input.Cwd },
  });
});

export const listBranchesImpl = implementation(listBranchesEffect, async (input) => {
  const query = input.Query.trim();
  const result = await runCommand(vcs.readRefs, {
    environmentId: EnvironmentId.make(input.EnvironmentId),
    input: {
      cwd: input.Cwd,
      limit: BRANCH_LIMIT,
      ...(query === "" ? {} : { query: query.slice(0, 256) }),
    },
  });
  return result.refs.map((ref) => ({
    Name: ref.name,
    IsRemote: ref.isRemote === true,
    Current: ref.current,
    IsDefault: ref.isDefault,
    WorktreePath: ref.worktreePath,
  }));
});

export const switchBranchImpl = implementation(switchBranchEffect, async (input) => {
  const environmentId = EnvironmentId.make(input.EnvironmentId);
  if (input.Create) {
    const created = await runCommand(vcs.createRef, {
      environmentId,
      input: { cwd: input.Cwd, refName: input.RefName, switchRef: true },
    });
    return created.refName;
  }
  const switched = await runCommand(vcs.switchRef, {
    environmentId,
    input: { cwd: input.Cwd, refName: input.RefName },
  });
  return switched.refName;
});

export const gitActionImpl = implementation(gitActionEffect, async (input) => {
  const target = { environmentId: EnvironmentId.make(input.EnvironmentId), cwd: input.Cwd };
  const result = await runCommand(vcsActions.runStackedAction(target), {
    actionId: input.ActionId,
    action: input.Action,
    ...(input.CommitMessage === null ? {} : { commitMessage: input.CommitMessage }),
    ...(input.FeatureBranch ? { featureBranch: true } : {}),
    ...(input.FilePaths === null ? {} : { filePaths: input.FilePaths }),
    threadId: ThreadId.make(input.ThreadId),
  });
  return {
    Title: result.toast.title,
    Description: result.toast.description ?? null,
    Branch: result.branch.status === "created" ? (result.branch.name ?? null) : null,
    PrUrl: result.pr.url ?? null,
    PrCreated: result.pr.status === "created",
  };
});

export const pullImpl = implementation(pullEffect, async (input) => {
  const result = await runCommand(vcs.pull, {
    environmentId: EnvironmentId.make(input.EnvironmentId),
    input: { cwd: input.Cwd },
  });
  return {
    Pulled: result.status === "pulled",
    RefName: result.refName,
    Upstream: result.upstreamRef ?? null,
  };
});

export const branchDiffImpl = implementation(branchDiffEffect, async (input, action) => {
  const preview = await inEnvironment(
    input.EnvironmentId,
    request(WS_METHODS.reviewGetDiffPreview, { cwd: input.Cwd, sourceKind: "branch-range" }),
    action?.signal,
  );
  const source = preview.sources.find((held) => held.kind === "branch-range") ?? null;
  return {
    Diff: source?.diff ?? "",
    BaseRef: source?.baseRef ?? null,
    Truncated: source?.truncated ?? false,
  };
});

export const runScriptImpl = implementation(runScriptEffect, async (input) => {
  const ids = { threadId: input.ThreadId, terminalId: input.TerminalId };
  await inEnvironment(
    input.EnvironmentId,
    request(WS_METHODS.terminalOpen, {
      ...ids,
      cwd: input.Cwd,
      worktreePath: input.WorktreePath,
      env: projectScriptRuntimeEnv({
        project: { cwd: input.ProjectRoot },
        worktreePath: input.WorktreePath,
      }),
    }),
  );
  await inEnvironment(
    input.EnvironmentId,
    request(WS_METHODS.terminalWrite, { ...ids, data: `${input.Command}\r` }),
  );
});

export const sourceControlImplementations = [
  editorsImpl,
  openWithEditorImpl,
  refreshVcsStatusImpl,
  listBranchesImpl,
  switchBranchImpl,
  gitActionImpl,
  pullImpl,
  branchDiffImpl,
  runScriptImpl,
];
