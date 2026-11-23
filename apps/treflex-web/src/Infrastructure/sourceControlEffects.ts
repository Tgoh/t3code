import type { GitStackedAction } from "@t3tools/contracts";
import { defineEffect, type IEffect } from "treflex";

interface IInCheckout extends IEffect {
  EnvironmentId: string;
  Cwd: string;
}

interface IOpenWithEditorEffect extends IInCheckout {
  Type: "openWithEditor";
  Editor: string;
}

export const openWithEditorEffect = defineEffect<IOpenWithEditorEffect, void>("openWithEditor");

interface IRefreshVcsStatusEffect extends IInCheckout {
  Type: "refreshVcsStatus";
}

export const refreshVcsStatusEffect = defineEffect<IRefreshVcsStatusEffect, void>(
  "refreshVcsStatus",
);

export interface IBranchRef {
  Name: string;
  IsRemote: boolean;
  Current: boolean;
  IsDefault: boolean;
  WorktreePath: string | null;
}

interface IListBranchesEffect extends IInCheckout {
  Type: "listBranches";
  Query: string;
}

export const listBranchesEffect = defineEffect<IListBranchesEffect, IBranchRef[]>("listBranches");

interface ISwitchBranchEffect extends IInCheckout {
  Type: "switchBranch";
  RefName: string;
  Create: boolean;
}

/** Returns the branch now checked out, which differs from `RefName` for a remote ref. */
export const switchBranchEffect = defineEffect<ISwitchBranchEffect, string | null>("switchBranch");

export interface IGitActionOutcome {
  Title: string;
  Description: string | null;
  Branch: string | null;
  PrUrl: string | null;
  PrCreated: boolean;
}

export interface IGitActionRequest {
  EnvironmentId: string;
  Cwd: string;
  ActionId: string;
  Action: GitStackedAction;
  CommitMessage: string | null;
  FeatureBranch: boolean;
  FilePaths: string[] | null;
  ThreadId: string;
}

interface IGitActionEffect extends IEffect, IGitActionRequest {
  Type: "gitAction";
}

export const gitActionEffect = defineEffect<IGitActionEffect, IGitActionOutcome>("gitAction");

interface IPullEffect extends IInCheckout {
  Type: "pull";
}

export const pullEffect = defineEffect<
  IPullEffect,
  { Pulled: boolean; RefName: string; Upstream: string | null }
>("pull");

export interface IBranchDiff {
  Diff: string;
  HeadRef: string | null;
  BaseRef: string | null;
  Truncated: boolean;
}

interface IBranchDiffEffect extends IInCheckout {
  Type: "branchDiff";
  /** The branch's changes against its base, or what isn't committed yet. */
  Source: "branch-range" | "working-tree";
  IgnoreWhitespace: boolean;
}

export const branchDiffEffect = defineEffect<IBranchDiffEffect, IBranchDiff>("branchDiff");

interface IRunScriptEffect extends IInCheckout {
  Type: "runScript";
  ThreadId: string;
  TerminalId: string;
  WorktreePath: string | null;
  ProjectRoot: string;
  Command: string;
}

export const runScriptEffect = defineEffect<IRunScriptEffect, void>("runScript");
