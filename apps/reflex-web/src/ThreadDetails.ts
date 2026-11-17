import type { ProjectScript, VcsStatusResult } from "@t3tools/contracts";
import {
  type IActionGenerator,
  type IEntity,
  type IOpenGenerator,
  type ISelectorGenerator,
  inFlight,
  latest,
  leading,
  open,
  openResource,
} from "treflex";
import { createComponentFeature } from "treflex-solid";

import { sendThreadBranch } from "./GitWork";
import { projectCommandEffect, withCommandId } from "./Infrastructure/commandEffects";
import { storedEditorEffect, storeEditorEffect } from "./Infrastructure/preferences";
import {
  editorsEffect,
  type IBranchRef,
  type IEditors,
  listBranchesEffect,
  refreshVcsStatusEffect,
  runScriptEffect,
  switchBranchEffect,
} from "./Infrastructure/sourceControlEffects";

declare module "treflex" {
  interface IResourceRegistry {
    "Details/Status": { Type: "vcsStatus" };
  }
}

export interface ICheckout {
  EnvironmentId: string;
  ThreadId: string;
  ProjectId: string;
  Cwd: string;
  ProjectRoot: string;
  WorktreePath: string | null;
}

export interface IThreadDetails extends IEntity {
  Checkout: ICheckout | null;
  Editors: IEditors | null;
  Branches: IBranchRef[] | null;
  BranchError: string | null;
  ScriptError: string | null;
}

export function getDefaultThreadDetails(): Omit<IThreadDetails, "$Id"> {
  return {
    Checkout: null,
    Editors: null,
    Branches: null,
    BranchError: null,
    ScriptError: null,
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

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const samePath = (left: string, right: string) => {
  const normal = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  return normal(left) === normal(right);
};

export function* attach(draft: IThreadDetails, checkout: ICheckout): IOpenGenerator {
  draft.Checkout = checkout;
  yield* openResource(draft, "Details/Status", {
    Type: "vcsStatus",
    EnvironmentId: checkout.EnvironmentId,
    Cwd: checkout.Cwd,
  });
  yield* refreshStatus(draft);
  const stored = yield* storedEditorEffect();
  try {
    draft.Editors = yield* open(
      editorsEffect({ EnvironmentId: checkout.EnvironmentId, Stored: stored }),
    );
  } catch {
    draft.Editors = { Available: [], Preferred: null };
  }
  const preferred = draft.Editors.Preferred;
  if (preferred !== null && preferred !== stored) yield* storeEditorEffect({ Editor: preferred });
}

/** Terminal edits and commits made outside a turn publish no status, so a refresh asks for one. */
export function* refreshStatus(draft: IThreadDetails): IOpenGenerator {
  const checkout = draft.Checkout;
  if (checkout === null) return;
  try {
    yield* open(
      refreshVcsStatusEffect({ EnvironmentId: checkout.EnvironmentId, Cwd: checkout.Cwd }),
    );
  } catch {
    // The status stream reports its own failure.
  }
}
leading(refreshStatus);

export function* preferEditor(draft: IThreadDetails, editor: string): IActionGenerator {
  if (draft.Editors !== null) draft.Editors.Preferred = editor;
  yield* storeEditorEffect({ Editor: editor });
}

export function* loadBranches(draft: IThreadDetails, query: string): IOpenGenerator {
  const checkout = draft.Checkout;
  if (checkout === null) return;
  draft.BranchError = null;
  try {
    draft.Branches = yield* open(
      listBranchesEffect({
        EnvironmentId: checkout.EnvironmentId,
        Cwd: checkout.Cwd,
        Query: query,
      }),
    );
  } catch (error) {
    draft.Branches = [];
    draft.BranchError = errorText(error);
  }
}
latest(loadBranches);

function* checkout(draft: IThreadDetails, refName: string, create: boolean): IOpenGenerator {
  const held = draft.Checkout;
  if (held === null) return;
  draft.BranchError = null;
  let switched: string | null = null;
  try {
    switched = yield* open(
      switchBranchEffect({
        EnvironmentId: held.EnvironmentId,
        Cwd: held.Cwd,
        RefName: refName,
        Create: create,
      }),
    );
  } catch (error) {
    draft.BranchError = errorText(error);
    return;
  }
  try {
    yield* sendThreadBranch(held, switched ?? refName);
  } catch (error) {
    draft.BranchError = errorText(error);
  }
  yield* refreshStatus(draft);
}

export function blockedByWorktree(ref: IBranchRef, cwd: string): boolean {
  return ref.WorktreePath !== null && !samePath(ref.WorktreePath, cwd);
}

export function* selectBranch(draft: IThreadDetails, ref: IBranchRef): IOpenGenerator {
  const held = draft.Checkout;
  if (held === null || ref.Current) return;
  if (blockedByWorktree(ref, held.Cwd)) {
    draft.BranchError = `${ref.Name} is checked out in ${ref.WorktreePath}.`;
    return;
  }
  yield* checkout(draft, ref.Name, false);
}
leading(selectBranch);

export function* createBranch(draft: IThreadDetails, name: string): IOpenGenerator {
  const trimmed = name.trim();
  if (trimmed === "") return;
  yield* checkout(draft, trimmed, true);
}
leading(createBranch);

export function* runScript(
  draft: IThreadDetails,
  script: ProjectScript,
  terminalId: string,
): IOpenGenerator {
  const held = draft.Checkout;
  if (held === null) return;
  draft.ScriptError = null;
  try {
    yield* open(
      runScriptEffect({
        EnvironmentId: held.EnvironmentId,
        Cwd: held.Cwd,
        ThreadId: held.ThreadId,
        TerminalId: terminalId,
        WorktreePath: held.WorktreePath,
        ProjectRoot: held.ProjectRoot,
        Command: script.command,
      }),
    );
  } catch (error) {
    draft.ScriptError = errorText(error);
  }
}

/** Replaces the project's scripts, so an add or a removal sends the whole list. */
export function* saveScripts(draft: IThreadDetails, scripts: ProjectScript[]): IOpenGenerator {
  const held = draft.Checkout;
  if (held === null) return;
  draft.ScriptError = null;
  try {
    yield* open(
      withCommandId((commandId) =>
        projectCommandEffect({
          EnvironmentId: held.EnvironmentId,
          ProjectId: held.ProjectId,
          CommandId: commandId,
          Command: { Kind: "scripts", Scripts: scripts },
        }),
      ),
    );
  } catch (error) {
    draft.ScriptError = errorText(error);
  }
}
leading(saveScripts);

export function* switchingBranch(draft: IThreadDetails): ISelectorGenerator<boolean> {
  return yield* inFlight([selectBranch, createBranch], draft);
}

export function* loadingBranches(draft: IThreadDetails): ISelectorGenerator<boolean> {
  return yield* inFlight(loadBranches, draft);
}

export function* savingScripts(draft: IThreadDetails): ISelectorGenerator<boolean> {
  return yield* inFlight(saveScripts, draft);
}

export default createComponentFeature<IThreadDetails>(import.meta.url)(
  {
    attach,
    refreshStatus,
    preferEditor,
    loadBranches,
    selectBranch,
    createBranch,
    runScript,
    saveScripts,
  },
  { switchingBranch, loadingBranches, savingScripts },
);
