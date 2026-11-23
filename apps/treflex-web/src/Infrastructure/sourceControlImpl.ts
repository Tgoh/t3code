import { request } from "@t3tools/client-runtime/rpc";
import {
  createVcsActionManager,
  createVcsEnvironmentAtoms,
} from "@t3tools/client-runtime/state/vcs";
import { type EditorId, EnvironmentId, ThreadId, WS_METHODS } from "@t3tools/contracts";
import { projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import { implementation } from "treflex";

import { inEnvironment } from "./commandsImpl";
import { atomRuntime, runCommand } from "./sourceControl";
import {
  branchDiffEffect,
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

export const openWithEditorImpl = implementation(openWithEditorEffect, async (input) => {
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
    request(WS_METHODS.reviewGetDiffPreview, {
      cwd: input.Cwd,
      sourceKind: input.Source,
      ignoreWhitespace: input.IgnoreWhitespace,
    }),
    action?.signal,
  );
  const source = preview.sources.find((held) => held.kind === input.Source) ?? null;
  return {
    Diff: source?.diff ?? "",
    HeadRef: source?.headRef ?? null,
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
  openWithEditorImpl,
  refreshVcsStatusImpl,
  listBranchesImpl,
  switchBranchImpl,
  gitActionImpl,
  pullImpl,
  branchDiffImpl,
  runScriptImpl,
];
