import type { VcsStatusResult } from "@t3tools/contracts";
import { type IOpenGenerator, latest, leading, open, openResource, workTag } from "treflex";
import { createEntityFeature } from "treflex-solid";

import type { IThreadPart } from "./checkout";
import { serverError } from "./Infrastructure/serverError";
import { sendThreadBranch } from "./GitWork";
import {
  type IBranchRef,
  listBranchesEffect,
  refreshVcsStatusEffect,
  switchBranchEffect,
} from "./Infrastructure/sourceControlEffects";

declare module "treflex" {
  interface IResourceRegistry {
    "Details/Status": { Type: "vcsStatus" };
  }
}

/**
 * The details card's data for one checkout while its thread is shown. A new one is minted when
 * the checkout moves, which stops a branch load or switch made against the old one.
 */
export interface IThreadDetails extends IThreadPart {
  Cwd: string;
  Branches: IBranchRef[] | null;
  BranchError: string | null;
}

export function getDefaultThreadDetails(
  environmentId: string,
  threadId: string,
  cwd: string,
): Omit<IThreadDetails, "$Id"> {
  return {
    EnvironmentId: environmentId,
    ThreadId: threadId,
    Cwd: cwd,
    Branches: null,
    BranchError: null,
  };
}

export interface IChangesTotals {
  Insertions: number;
  Deletions: number;
  /** Null for uncommitted changes, which are measured against the working tree. */
  BaseRef: string | null;
}

/**
 * Follows resolveChangesTotals in apps/web/src/components/GitActionsControl.logic.ts, from status
 * alone: the branch's changes when it has any, else uncommitted ones.
 */
export function changesTotals(status: VcsStatusResult | null): IChangesTotals | null {
  if (status === null) return null;
  const branch = status.branchChanges;
  const tree = { ...status.workingTree, baseRef: null };
  const selected =
    branch !== undefined && (branch.insertions > 0 || branch.deletions > 0)
      ? branch
      : tree.insertions > 0 || tree.deletions > 0
        ? tree
        : (branch ?? tree);
  return {
    Insertions: selected.insertions,
    Deletions: selected.deletions,
    BaseRef: selected.baseRef,
  };
}

const samePath = (left: string, right: string) => {
  const normal = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  return normal(left) === normal(right);
};

export function* openStatus(draft: IThreadDetails): IOpenGenerator {
  yield* openResource(draft, "Details/Status", {
    Type: "vcsStatus",
    EnvironmentId: draft.EnvironmentId,
    Cwd: draft.Cwd,
  });
  yield* refreshStatus(draft);
}

/** Terminal edits and commits made outside a turn publish no status, so a refresh asks for one. */
export function* refreshStatus(draft: IThreadDetails): IOpenGenerator {
  try {
    yield* open(refreshVcsStatusEffect({ EnvironmentId: draft.EnvironmentId, Cwd: draft.Cwd }));
  } catch (error) {
    // The status stream reports its own failure.
    serverError(error);
  }
}
leading(refreshStatus);

export function* loadBranches(draft: IThreadDetails, query: string): IOpenGenerator {
  draft.BranchError = null;
  const request = { EnvironmentId: draft.EnvironmentId, Cwd: draft.Cwd, Query: query };
  try {
    draft.Branches = yield* open(listBranchesEffect(request));
  } catch (error) {
    draft.Branches = [];
    draft.BranchError = serverError(error).message;
  }
}
latest(loadBranches);

function* switchTo(draft: IThreadDetails, refName: string, create: boolean): IOpenGenerator {
  draft.BranchError = null;
  const request = {
    EnvironmentId: draft.EnvironmentId,
    Cwd: draft.Cwd,
    RefName: refName,
    Create: create,
  };
  let switched: string | null = null;
  try {
    switched = yield* open(switchBranchEffect(request));
  } catch (error) {
    draft.BranchError = serverError(error).message;
    return;
  }
  try {
    yield* sendThreadBranch(draft, switched ?? refName);
  } catch (error) {
    draft.BranchError = serverError(error).message;
  }
  yield* refreshStatus(draft);
}

export function blockedByWorktree(ref: IBranchRef, cwd: string): boolean {
  return ref.WorktreePath !== null && !samePath(ref.WorktreePath, cwd);
}

export function* selectBranch(draft: IThreadDetails, ref: IBranchRef): IOpenGenerator {
  if (ref.Current) return;
  if (blockedByWorktree(ref, draft.Cwd)) {
    draft.BranchError = `${ref.Name} is checked out in ${ref.WorktreePath}.`;
    return;
  }
  yield* switchTo(draft, ref.Name, false);
}
leading(selectBranch);

export function* createBranch(draft: IThreadDetails, name: string): IOpenGenerator {
  const trimmed = name.trim();
  if (trimmed === "") return;
  yield* switchTo(draft, trimmed, true);
}
leading(createBranch);

export const SwitchingBranch = workTag("Details/SwitchingBranch");
SwitchingBranch.mark(selectBranch, createBranch);

export default createEntityFeature<IThreadDetails>("ThreadDetails")(
  { refreshStatus, loadBranches, selectBranch, createBranch },
  {},
);
