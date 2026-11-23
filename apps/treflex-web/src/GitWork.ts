import {
  type DefaultBranchConfirmableAction,
  requiresDefaultBranchConfirmation,
} from "@t3tools/client-runtime/state/vcs";
import type { GitStackedAction } from "@t3tools/contracts";
import {
  answer,
  ask,
  generateGuid,
  type IActionGenerator,
  type IAskEntry,
  type IAskId,
  type IOpenGenerator,
  type ISelectorGenerator,
  leading,
  open,
  pendingAsks,
  receiver,
  select,
  startTimer,
  stopTimer,
  workTag,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import { type ICheckout, type IThreadPart, checkout as threadCheckout } from "./checkout";
import { serverError } from "./Infrastructure/serverError";
import { threadCommandEffect, withCommandId } from "./Infrastructure/commandEffects";
import { toast } from "./Infrastructure/toasts";
import {
  gitActionEffect,
  type IGitActionOutcome,
  openWithEditorEffect,
  pullEffect,
} from "./Infrastructure/sourceControlEffects";

declare module "treflex" {
  interface ITimerRegistry {
    "Git/Notice": {};
  }
}

// Follows GIT_ACTION_SUCCESS_VISIBLE_MS in apps/web/src/components/GitActionsControl.logic.ts.
export const NOTICE_VISIBLE_MS = 10_000;

/** A finished action's result, shown in the quick action's row as stock's inline success is. */
export interface IGitNotice {
  Title: string;
  Description: string | null;
  Url: string | null;
}

export interface IDefaultBranchConfirm {
  Path: "Git/DefaultBranch";
  Action: DefaultBranchConfirmableAction;
  Branch: string;
  IncludesCommit: boolean;
}

export type IDefaultBranchChoice = "continue" | "featureBranch";

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

export interface IGitWork extends IThreadPart {
  Notice: IGitNotice | null;
}

export function getDefaultGitWork(environmentId: string, threadId: string): Omit<IGitWork, "$Id"> {
  return { EnvironmentId: environmentId, ThreadId: threadId, Notice: null };
}

const includesCommit = ({ Action, FeatureBranch }: IGitActionAsk, context: IActionContext) =>
  (Action === "commit" || Action === "commit_push" || Action === "commit_push_pr") &&
  (Action === "commit" || context.HasWorkingTreeChanges || FeatureBranch);

/** Moves the thread to `branch`; throws the server's refusal. */
export function* sendThreadBranch(
  checkout: Pick<ICheckout, "EnvironmentId" | "ThreadId">,
  branch: string,
): IOpenGenerator {
  yield* open(
    withCommandId((commandId) =>
      threadCommandEffect({
        EnvironmentId: checkout.EnvironmentId,
        ThreadId: checkout.ThreadId,
        CommandId: commandId,
        Command: { Kind: "branch", Branch: branch },
      }),
    ),
  );
}

function* showNotice(draft: IGitWork, notice: IGitNotice): IActionGenerator {
  yield* stopTimer(draft, "Git/Notice");
  draft.Notice = notice;
  yield* startTimer(draft, "Git/Notice", GitReceiver, NOTICE_VISIBLE_MS);
}

// Follows the error toasts in apps/web/src/components/GitActionsControl.tsx, which stay until
// dismissed (`resolveGitActionResultToastTiming`).
const failed = (draft: IGitWork, title: string, description: string) =>
  toast({
    Kind: "error",
    Title: title,
    Description: description,
    Thread: { EnvironmentId: draft.EnvironmentId, ThreadId: draft.ThreadId },
    Sticky: true,
  });

export function* dismissNotice(draft: IGitWork): IActionGenerator {
  yield* stopTimer(draft, "Git/Notice");
  draft.Notice = null;
}

export function* openEditor(draft: IGitWork, editor: string | null): IOpenGenerator {
  const checkout = yield* select(threadCheckout);
  if (checkout === null) return;
  if (editor === null) {
    yield* toast({
      Kind: "error",
      Title: "No editor found",
      Description: `No editor on this machine can open ${checkout.Cwd}.`,
      Thread: { EnvironmentId: draft.EnvironmentId, ThreadId: draft.ThreadId },
    });
    return;
  }
  try {
    yield* open(
      openWithEditorEffect({
        EnvironmentId: checkout.EnvironmentId,
        Cwd: checkout.Cwd,
        Editor: editor,
      }),
    );
  } catch (error) {
    yield* toast({
      Kind: "error",
      Title: "Unable to open editor",
      Description: serverError(error).message,
      Thread: { EnvironmentId: draft.EnvironmentId, ThreadId: draft.ThreadId },
    });
  }
}

/**
 * Follows runGitActionWithToast in apps/web/src/components/GitActionsControl.tsx: a push or pull
 * request from the default branch waits for the person to confirm it first.
 */
export function* runGitAction(
  draft: IGitWork,
  request: IGitActionAsk,
  context: IActionContext,
): IOpenGenerator {
  const action = request.Action;
  let featureBranch = request.FeatureBranch;
  if (
    !featureBranch &&
    context.RefName !== null &&
    requiresDefaultBranchConfirmation(action, context.IsDefaultRef) &&
    action !== "commit"
  ) {
    const confirm: IDefaultBranchConfirm = {
      Path: "Git/DefaultBranch",
      Action: action,
      Branch: context.RefName,
      IncludesCommit: includesCommit(request, context),
    };
    const choice = yield* open(ask<IDefaultBranchChoice>(draft, confirm));
    if (choice === undefined) return;
    featureBranch = choice === "featureBranch";
  }
  const checkout = yield* select(threadCheckout);
  if (checkout === null) return;
  yield* dismissNotice(draft);
  const actionId = yield* generateGuid();
  let outcome: IGitActionOutcome;
  try {
    outcome = yield* open(
      gitActionEffect({
        EnvironmentId: checkout.EnvironmentId,
        Cwd: checkout.Cwd,
        ActionId: actionId,
        Action: action,
        CommitMessage: request.CommitMessage,
        FeatureBranch: featureBranch,
        FilePaths: request.FilePaths,
        ThreadId: checkout.ThreadId,
      }),
    );
  } catch (error) {
    yield* failed(draft, "Action failed", serverError(error).message);
    return;
  }
  if (outcome.Branch !== null) {
    try {
      yield* sendThreadBranch(checkout, outcome.Branch);
    } catch (error) {
      yield* failed(draft, "Failed to switch ref.", serverError(error).message);
    }
  }
  yield* showNotice(draft, {
    Title: outcome.PrCreated ? "Created PR" : outcome.Title,
    Description: outcome.PrCreated ? null : outcome.Description,
    Url: outcome.PrUrl,
  });
}
leading(runGitAction);

export function* defaultBranchConfirm(
  draft: IGitWork,
): ISelectorGenerator<(IAskEntry & { Request: IDefaultBranchConfirm }) | null> {
  const entry = (yield* pendingAsks(draft)).find(
    (held) => (held.Request as { Path?: string }).Path === "Git/DefaultBranch",
  );
  return (entry as (IAskEntry & { Request: IDefaultBranchConfirm }) | undefined) ?? null;
}

/** The confirm dialog's answer; no choice cancels. */
export function* chooseDefaultBranch(
  _draft: IGitWork,
  askId: IAskId<IDefaultBranchChoice>,
  choice?: IDefaultBranchChoice,
): IActionGenerator {
  yield* answer(askId, choice);
}

export function* pull(draft: IGitWork): IOpenGenerator {
  const checkout = yield* select(threadCheckout);
  if (checkout === null) return;
  yield* dismissNotice(draft);
  try {
    const result = yield* open(
      pullEffect({ EnvironmentId: checkout.EnvironmentId, Cwd: checkout.Cwd }),
    );
    yield* showNotice(draft, {
      Title: result.Pulled ? "Pulled" : "Already up to date",
      Description: result.Pulled
        ? `Updated ${result.RefName} from ${result.Upstream ?? "upstream"}`
        : `${result.RefName} is already synchronized.`,
      Url: null,
    });
  } catch (error) {
    yield* failed(draft, "Pull failed", serverError(error).message);
  }
}
leading(pull);

export const GitRunning = workTag("Git/Running");
GitRunning.mark(runGitAction, pull);

export const GitReceiver = receiver<IGitWork>("GitReceiver")({
  *"Git/Notice"(draft) {
    yield* stopTimer(draft, "Git/Notice");
    draft.Notice = null;
  },
});

export default createEntityFeature<IGitWork>("GitWork")(
  {
    dismissNotice,
    openEditor,
    runGitAction,
    chooseDefaultBranch,
    pull,
  },
  { defaultBranchConfirm },
);
