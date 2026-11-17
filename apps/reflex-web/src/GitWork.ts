import {
  type DefaultBranchConfirmableAction,
  requiresDefaultBranchConfirmation,
} from "@t3tools/client-runtime/state/vcs";
import type { GitStackedAction } from "@t3tools/contracts";
import {
  generateGuid,
  type IActionGenerator,
  type IEntity,
  type IOpenGenerator,
  leading,
  open,
  receiver,
  startTimer,
  stopTimer,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import { serverError } from "./Infrastructure/serverError";
import { threadCommandEffect, withCommandId } from "./Infrastructure/commandEffects";
import {
  gitActionEffect,
  type IGitActionOutcome,
  openWithEditorEffect,
  pullEffect,
} from "./Infrastructure/sourceControlEffects";
import type { ICheckout } from "./ThreadDetails";

declare module "treflex" {
  interface ITimerRegistry {
    "Git/Notice": {};
  }
}

// Follows GIT_ACTION_SUCCESS_VISIBLE_MS in apps/web/src/components/GitActionsControl.logic.ts.
export const NOTICE_VISIBLE_MS = 10_000;

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

/** The details card's work whose result outlives the card: git actions and opening an editor. */
export interface IGitWork extends IEntity {
  Notice: IGitNotice | null;
  PendingDefaultBranch: IPendingDefaultBranch | null;
  BranchError: string | null;
}

export function getDefaultGitWork(): Omit<IGitWork, "$Id"> {
  return { Notice: null, PendingDefaultBranch: null, BranchError: null };
}

const includesCommit = (ask: IGitActionAsk, context: IActionContext) =>
  (ask.Action === "commit" || ask.Action === "commit_push" || ask.Action === "commit_push_pr") &&
  (ask.Action === "commit" || context.HasWorkingTreeChanges || ask.FeatureBranch);

/** Moves the thread to `branch`; throws the server's refusal. */
export function* sendThreadBranch(checkout: ICheckout, branch: string): IOpenGenerator {
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
  if (notice.Tone === "success") {
    yield* startTimer(draft, "Git/Notice", GitReceiver, NOTICE_VISIBLE_MS);
  }
}

export function* dismissNotice(draft: IGitWork): IActionGenerator {
  yield* stopTimer(draft, "Git/Notice");
  draft.Notice = null;
}

export function* openEditor(
  draft: IGitWork,
  checkout: ICheckout,
  editor: string | null,
): IOpenGenerator {
  if (editor === null) {
    yield* showNotice(draft, {
      Tone: "error",
      Title: "No editor found",
      Description: `No editor on this machine can open ${checkout.Cwd}.`,
      Url: null,
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
    yield* showNotice(draft, {
      Tone: "error",
      Title: "Unable to open editor",
      Description: serverError(error).message,
      Url: null,
    });
  }
}

/**
 * Follows runGitActionWithToast in apps/web/src/components/GitActionsControl.tsx: a push or pull
 * request from the default branch waits for the person to confirm it first.
 */
export function* runGitAction(
  draft: IGitWork,
  checkout: ICheckout,
  ask: IGitActionAsk,
  context: IActionContext,
  confirmed: boolean,
): IOpenGenerator {
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
  draft.BranchError = null;
  const actionId = yield* generateGuid();
  let outcome: IGitActionOutcome;
  try {
    outcome = yield* open(
      gitActionEffect({
        EnvironmentId: checkout.EnvironmentId,
        Cwd: checkout.Cwd,
        ActionId: actionId,
        Action: action,
        CommitMessage: ask.CommitMessage,
        FeatureBranch: ask.FeatureBranch,
        FilePaths: ask.FilePaths,
        ThreadId: checkout.ThreadId,
      }),
    );
  } catch (error) {
    yield* showNotice(draft, {
      Tone: "error",
      Title: "Action failed",
      Description: serverError(error).message,
      Url: null,
    });
    return;
  }
  if (outcome.Branch !== null) {
    try {
      yield* sendThreadBranch(checkout, outcome.Branch);
    } catch (error) {
      draft.BranchError = serverError(error).message;
    }
  }
  yield* showNotice(draft, {
    Tone: "success",
    Title: outcome.PrCreated ? "Created PR" : outcome.Title,
    Description: outcome.PrCreated ? null : outcome.Description,
    Url: outcome.PrUrl,
  });
}
leading(runGitAction);

export function* continueDefaultBranch(
  draft: IGitWork,
  checkout: ICheckout,
  featureBranch: boolean,
  context: IActionContext,
): IOpenGenerator {
  const pending = draft.PendingDefaultBranch;
  if (pending === null) return;
  draft.PendingDefaultBranch = null;
  yield* runGitAction(
    draft,
    checkout,
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

export function* cancelDefaultBranch(draft: IGitWork): IActionGenerator {
  draft.PendingDefaultBranch = null;
}

export function* pull(draft: IGitWork, checkout: ICheckout): IOpenGenerator {
  yield* dismissNotice(draft);
  try {
    const result = yield* open(
      pullEffect({ EnvironmentId: checkout.EnvironmentId, Cwd: checkout.Cwd }),
    );
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
      Description: serverError(error).message,
      Url: null,
    });
  }
}
leading(pull);

export const GitReceiver = receiver<IGitWork>("GitReceiver")({
  *"Git/Notice"(draft) {
    yield* stopTimer(draft, "Git/Notice");
    draft.Notice = null;
  },
});

export default createEntityFeature<IGitWork>(import.meta.url)(
  {
    dismissNotice,
    openEditor,
    runGitAction,
    continueDefaultBranch,
    cancelDefaultBranch,
    pull,
  },
  {},
);
