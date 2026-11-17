import {
  type DefaultBranchConfirmableAction,
  requiresDefaultBranchConfirmation,
} from "@t3tools/client-runtime/state/vcs";
import type { GitStackedAction, ProjectScript, VcsStatusResult } from "@t3tools/contracts";
import {
  generateGuid,
  type IActionGenerator,
  type IEntity,
  type IOpenGenerator,
  type ISelectorGenerator,
  inFlight,
  latest,
  leading,
  open,
  openResource,
  receiver,
  startTimer,
  stopTimer,
} from "treflex";
import { createComponentFeature } from "treflex-solid";

import {
  projectCommandEffect,
  threadCommandEffect,
  withCommandId,
} from "./Infrastructure/commandEffects";
import { storedEditorEffect, storeEditorEffect } from "./Infrastructure/preferences";
import {
  editorsEffect,
  gitActionEffect,
  type IBranchRef,
  type IEditors,
  type IGitActionOutcome,
  listBranchesEffect,
  openWithEditorEffect,
  pullEffect,
  refreshVcsStatusEffect,
  runScriptEffect,
  switchBranchEffect,
} from "./Infrastructure/sourceControlEffects";

declare module "treflex" {
  interface IResourceRegistry {
    "Details/Status": { Type: "vcsStatus" };
  }
  interface ITimerRegistry {
    "Details/Notice": {};
  }
}

// Follows GIT_ACTION_SUCCESS_VISIBLE_MS in apps/web/src/components/GitActionsControl.logic.ts.
export const NOTICE_VISIBLE_MS = 10_000;

export interface ICheckout {
  EnvironmentId: string;
  ThreadId: string;
  ProjectId: string;
  Cwd: string;
  ProjectRoot: string;
  WorktreePath: string | null;
}

export interface IGitNotice {
  Tone: "success" | "error";
  Title: string;
  Description: string | null;
  Url: string | null;
}

export interface IPendingDefaultBranch {
  Action: DefaultBranchConfirmableAction;
  Branch: string;
  IncludesCommit: boolean;
  CommitMessage: string | null;
  FilePaths: string[] | null;
}

export interface IActionContext {
  RefName: string | null;
  IsDefaultRef: boolean;
  HasWorkingTreeChanges: boolean;
}

export interface IGitActionAsk {
  Action: GitStackedAction;
  CommitMessage: string | null;
  FilePaths: string[] | null;
  FeatureBranch: boolean;
}

export interface IThreadDetails extends IEntity {
  Checkout: ICheckout | null;
  Editors: IEditors | null;
  Branches: IBranchRef[] | null;
  BranchError: string | null;
  Notice: IGitNotice | null;
  PendingDefaultBranch: IPendingDefaultBranch | null;
  ScriptError: string | null;
}

export function getDefaultThreadDetails(): Omit<IThreadDetails, "$Id"> {
  return {
    Checkout: null,
    Editors: null,
    Branches: null,
    BranchError: null,
    Notice: null,
    PendingDefaultBranch: null,
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

const includesCommit = (ask: IGitActionAsk, context: IActionContext) =>
  (ask.Action === "commit" || ask.Action === "commit_push" || ask.Action === "commit_push_pr") &&
  (ask.Action === "commit" || context.HasWorkingTreeChanges || ask.FeatureBranch);

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

export function* openEditor(draft: IThreadDetails, editor: string | null): IOpenGenerator {
  const checkout = draft.Checkout;
  const target = editor ?? draft.Editors?.Preferred ?? null;
  if (checkout === null) return;
  if (target === null) {
    yield* showNotice(draft, {
      Tone: "error",
      Title: "No editor found",
      Description: `No editor on this machine can open ${checkout.Cwd}.`,
      Url: null,
    });
    return;
  }
  if (draft.Editors !== null) draft.Editors.Preferred = target;
  yield* storeEditorEffect({ Editor: target });
  try {
    yield* open(
      openWithEditorEffect({
        EnvironmentId: checkout.EnvironmentId,
        Cwd: checkout.Cwd,
        Editor: target,
      }),
    );
  } catch (error) {
    yield* showNotice(draft, {
      Tone: "error",
      Title: "Unable to open editor",
      Description: errorText(error),
      Url: null,
    });
  }
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
  yield* setThreadBranch(draft, switched ?? refName);
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

function* setThreadBranch(draft: IThreadDetails, branch: string): IOpenGenerator {
  const held = draft.Checkout;
  if (held === null) return;
  try {
    yield* open(
      withCommandId((commandId) =>
        threadCommandEffect({
          EnvironmentId: held.EnvironmentId,
          ThreadId: held.ThreadId,
          CommandId: commandId,
          Command: { Kind: "branch", Branch: branch },
        }),
      ),
    );
  } catch (error) {
    draft.BranchError = errorText(error);
  }
}

function* showNotice(draft: IThreadDetails, notice: IGitNotice): IActionGenerator {
  yield* stopTimer(draft, "Details/Notice");
  draft.Notice = notice;
  if (notice.Tone === "success") {
    yield* startTimer(draft, "Details/Notice", DetailsReceiver, NOTICE_VISIBLE_MS);
  }
}

export function* dismissNotice(draft: IThreadDetails): IActionGenerator {
  yield* stopTimer(draft, "Details/Notice");
  draft.Notice = null;
}

/**
 * Follows runGitActionWithToast in apps/web/src/components/GitActionsControl.tsx: a push or pull
 * request from the default branch waits for the person to confirm it first.
 */
export function* runGitAction(
  draft: IThreadDetails,
  ask: IGitActionAsk,
  context: IActionContext,
  confirmed: boolean,
): IOpenGenerator {
  const held = draft.Checkout;
  if (held === null) return;
  const action = ask.Action;
  if (
    !confirmed &&
    !ask.FeatureBranch &&
    context.RefName !== null &&
    requiresDefaultBranchConfirmation(action, context.IsDefaultRef) &&
    action !== "commit"
  ) {
    draft.PendingDefaultBranch = {
      Action: action,
      Branch: context.RefName,
      IncludesCommit: includesCommit(ask, context),
      CommitMessage: ask.CommitMessage,
      FilePaths: ask.FilePaths,
    };
    return;
  }
  yield* dismissNotice(draft);
  const actionId = yield* generateGuid();
  let outcome: IGitActionOutcome;
  try {
    outcome = yield* open(
      gitActionEffect({
        EnvironmentId: held.EnvironmentId,
        Cwd: held.Cwd,
        ActionId: actionId,
        Action: action,
        CommitMessage: ask.CommitMessage,
        FeatureBranch: ask.FeatureBranch,
        FilePaths: ask.FilePaths,
        ThreadId: held.ThreadId,
      }),
    );
  } catch (error) {
    yield* showNotice(draft, {
      Tone: "error",
      Title: "Action failed",
      Description: errorText(error),
      Url: null,
    });
    return;
  }
  if (outcome.Branch !== null) yield* setThreadBranch(draft, outcome.Branch);
  yield* showNotice(draft, {
    Tone: "success",
    Title: outcome.PrCreated ? "Created PR" : outcome.Title,
    Description: outcome.PrCreated ? null : outcome.Description,
    Url: outcome.PrUrl,
  });
}
leading(runGitAction);

export function* continueDefaultBranch(
  draft: IThreadDetails,
  featureBranch: boolean,
  context: IActionContext,
): IOpenGenerator {
  const pending = draft.PendingDefaultBranch;
  if (pending === null) return;
  draft.PendingDefaultBranch = null;
  yield* runGitAction(
    draft,
    {
      Action: pending.Action,
      CommitMessage: pending.CommitMessage,
      FilePaths: pending.FilePaths,
      FeatureBranch: featureBranch,
    },
    context,
    true,
  );
}

export function* cancelDefaultBranch(draft: IThreadDetails): IActionGenerator {
  draft.PendingDefaultBranch = null;
}

export function* pull(draft: IThreadDetails): IOpenGenerator {
  const held = draft.Checkout;
  if (held === null) return;
  yield* dismissNotice(draft);
  try {
    const result = yield* open(pullEffect({ EnvironmentId: held.EnvironmentId, Cwd: held.Cwd }));
    yield* showNotice(draft, {
      Tone: "success",
      Title: result.Pulled ? "Pulled" : "Already up to date",
      Description: result.Pulled
        ? `Updated ${result.RefName} from ${result.Upstream ?? "upstream"}`
        : `${result.RefName} is already synchronized.`,
      Url: null,
    });
  } catch (error) {
    yield* showNotice(draft, {
      Tone: "error",
      Title: "Pull failed",
      Description: errorText(error),
      Url: null,
    });
  }
}
leading(pull);

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

export function* gitBusy(draft: IThreadDetails): ISelectorGenerator<boolean> {
  return yield* inFlight([runGitAction, continueDefaultBranch, pull], draft);
}

export function* switchingBranch(draft: IThreadDetails): ISelectorGenerator<boolean> {
  return yield* inFlight([selectBranch, createBranch], draft);
}

export function* loadingBranches(draft: IThreadDetails): ISelectorGenerator<boolean> {
  return yield* inFlight(loadBranches, draft);
}

export function* savingScripts(draft: IThreadDetails): ISelectorGenerator<boolean> {
  return yield* inFlight(saveScripts, draft);
}

export const DetailsReceiver = receiver<IThreadDetails>("DetailsReceiver")({
  *"Details/Notice"(draft) {
    yield* stopTimer(draft, "Details/Notice");
    draft.Notice = null;
  },
});

export default createComponentFeature<IThreadDetails>(import.meta.url)(
  {
    attach,
    refreshStatus,
    openEditor,
    loadBranches,
    selectBranch,
    createBranch,
    dismissNotice,
    runGitAction,
    continueDefaultBranch,
    cancelDefaultBranch,
    pull,
    runScript,
    saveScripts,
  },
  { gitBusy, switchingBranch, loadingBranches, savingScripts },
);
