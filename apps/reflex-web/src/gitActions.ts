// Follows apps/web/src/components/GitActionsControl.logic.ts, which has moved on from the copies in
// client-runtime's state/vcs that this file would otherwise import.
import type { ChangeRequestTerminology } from "@t3tools/client-runtime/source-control-clients";
import {
  changeRequestTerminologyFor,
  type DefaultBranchActionDialogCopy,
  type DefaultBranchConfirmableAction,
  type GitActionIconName,
  type GitDialogAction,
} from "@t3tools/client-runtime/state/vcs";
import type { GitStackedAction, VcsStatusResult } from "@t3tools/contracts";

export interface IGitMenuItem {
  id: "commit" | "push" | "pr";
  label: string;
  disabled: boolean;
  icon: GitActionIconName;
  dialogAction: GitDialogAction;
}

export interface IGitQuickAction {
  label: string;
  disabled: boolean;
  kind: "run_action" | "run_pull" | "open_publish" | "show_hint";
  action?: GitStackedAction;
  hint?: string;
}

export function buildMenuItems(
  gitStatus: VcsStatusResult | null,
  isBusy: boolean,
  hasPrimaryRemote = true,
): IGitMenuItem[] {
  if (!gitStatus) return [];
  const terminology = changeRequestTerminologyFor(gitStatus);
  const hasBranch = gitStatus.refName !== null;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isBehind = gitStatus.behindCount > 0;
  const hasDefaultBranchDelta = (gitStatus.aheadOfDefaultCount ?? gitStatus.aheadCount) > 0;
  const canPushWithoutUpstream = hasPrimaryRemote && !gitStatus.hasUpstream;
  const canCommit = !isBusy && gitStatus.hasWorkingTreeChanges;
  const canPush =
    !isBusy &&
    hasBranch &&
    !isBehind &&
    gitStatus.aheadCount > 0 &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);
  const canCreatePr =
    !isBusy &&
    hasBranch &&
    !hasOpenPr &&
    hasDefaultBranchDelta &&
    !isBehind &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);
  const commit: IGitMenuItem = {
    id: "commit",
    label: "Commit",
    disabled: !canCommit,
    icon: "commit",
    dialogAction: "commit",
  };
  if (!hasPrimaryRemote) return [commit];
  const push: IGitMenuItem = {
    id: "push",
    label: "Push",
    disabled: !canPush,
    icon: "push",
    dialogAction: "push",
  };
  if (hasOpenPr) return [commit, push];
  return [
    commit,
    push,
    {
      id: "pr",
      label: `Create ${terminology.shortLabel}`,
      disabled: !canCreatePr,
      icon: "pr",
      dialogAction: "create_pr",
    },
  ];
}

export function menuItemDisabledReason(input: {
  item: IGitMenuItem;
  gitStatus: VcsStatusResult | null;
  isBusy: boolean;
  hasPrimaryRemote: boolean;
}): string | null {
  const { item, gitStatus, isBusy, hasPrimaryRemote } = input;
  if (!item.disabled) return null;
  if (isBusy) return "Git action in progress.";
  if (!gitStatus) return "Git status is unavailable.";
  const hasBranch = gitStatus.refName !== null;
  const isBehind = gitStatus.behindCount > 0;
  const terminology = changeRequestTerminologyFor(gitStatus);
  if (item.id === "commit") {
    return gitStatus.hasWorkingTreeChanges
      ? "Commit is currently unavailable."
      : "Worktree is clean. Make changes before committing.";
  }
  if (item.id === "push") {
    if (!hasBranch) return "Detached HEAD: check out a branch before pushing.";
    if (isBehind) return "Branch is behind upstream. Pull/rebase before pushing.";
    if (!gitStatus.hasUpstream && !hasPrimaryRemote)
      return 'Add an "origin" remote before pushing.';
    if (gitStatus.aheadCount === 0) return "No local commits to push.";
    return "Push is currently unavailable.";
  }
  if (!hasBranch) {
    return `Detached HEAD: check out a branch before creating a ${terminology.singular}.`;
  }
  if (!gitStatus.hasUpstream && !hasPrimaryRemote) {
    return `Add an "origin" remote before creating a ${terminology.singular}.`;
  }
  if ((gitStatus.aheadOfDefaultCount ?? gitStatus.aheadCount) <= 0) {
    return `No local commits to include in a ${terminology.singular}.`;
  }
  if (isBehind) {
    return `Branch is behind upstream. Pull/rebase before creating a ${terminology.singular}.`;
  }
  return `Create ${terminology.singular} is currently unavailable.`;
}

const upToDate: IGitQuickAction = {
  label: "Commit",
  disabled: true,
  kind: "show_hint",
  hint: "Branch is up to date. No action needed.",
};

export function resolveQuickAction(
  gitStatus: VcsStatusResult | null,
  isBusy: boolean,
  isDefaultRef = false,
  hasPrimaryRemote = true,
): IGitQuickAction {
  if (isBusy) {
    return { label: "Commit", disabled: true, kind: "show_hint", hint: "Git action in progress." };
  }
  if (!gitStatus) {
    return {
      label: "Commit",
      disabled: true,
      kind: "show_hint",
      hint: "Git status is unavailable.",
    };
  }
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const hasDefaultBranchDelta = (gitStatus.aheadOfDefaultCount ?? gitStatus.aheadCount) > 0;
  const isBehind = gitStatus.behindCount > 0;
  const terminology = changeRequestTerminologyFor(gitStatus);
  const push = (): IGitQuickAction =>
    hasOpenPr || isDefaultRef
      ? {
          label: "Push",
          disabled: false,
          kind: "run_action",
          action: isDefaultRef ? "commit_push" : "push",
        }
      : {
          label: `Push & create ${terminology.shortLabel}`,
          disabled: false,
          kind: "run_action",
          action: "create_pr",
        };

  if (gitStatus.refName === null) {
    return {
      label: "Commit",
      disabled: true,
      kind: "show_hint",
      hint: `Create and checkout a ref before pushing or opening a ${terminology.singular}.`,
    };
  }
  if (gitStatus.hasWorkingTreeChanges) {
    if (isBehind || (!gitStatus.hasUpstream && !hasPrimaryRemote)) {
      return { label: "Commit", disabled: false, kind: "run_action", action: "commit" };
    }
    if (hasOpenPr || isDefaultRef) {
      return { label: "Commit & push", disabled: false, kind: "run_action", action: "commit_push" };
    }
    return {
      label: `Commit, push & ${terminology.shortLabel}`,
      disabled: false,
      kind: "run_action",
      action: "commit_push_pr",
    };
  }
  if (!gitStatus.hasUpstream) {
    if (!hasPrimaryRemote) {
      return { label: "Publish repository", disabled: false, kind: "open_publish" };
    }
    if (!isAhead) {
      return hasOpenPr
        ? upToDate
        : { label: "Push", disabled: true, kind: "show_hint", hint: "No local commits to push." };
    }
    return push();
  }
  if (isAhead && isBehind) {
    return {
      label: "Sync ref",
      disabled: true,
      kind: "show_hint",
      hint: "Branch has diverged from upstream. Rebase/merge first.",
    };
  }
  if (isBehind) return { label: "Pull", disabled: false, kind: "run_pull" };
  if (isAhead) return push();
  if (hasOpenPr) return upToDate;
  if (hasDefaultBranchDelta && !isDefaultRef) {
    return {
      label: `Create ${terminology.shortLabel}`,
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }
  return upToDate;
}

export function defaultBranchDialogCopy(input: {
  action: DefaultBranchConfirmableAction;
  branchName: string;
  includesCommit: boolean;
  terminology: ChangeRequestTerminology;
}): DefaultBranchActionDialogCopy {
  const branch = input.branchName;
  const suffix = ` on "${branch}". You can continue on this ref or create a feature ref and run the same action there.`;
  const { shortLabel, singular } = input.terminology;
  if (input.action === "push" || input.action === "commit_push") {
    return input.includesCommit
      ? {
          title: "Commit & push to default ref?",
          description: `This action will commit and push changes${suffix}`,
          continueLabel: `Commit & push to ${branch}`,
        }
      : {
          title: "Push to default ref?",
          description: `This action will push local commits${suffix}`,
          continueLabel: `Push to ${branch}`,
        };
  }
  return input.includesCommit
    ? {
        title: `Commit, push & create ${shortLabel} from default ref?`,
        description: `This action will commit, push, and create a ${singular}${suffix}`,
        continueLabel: `Commit, push & create ${shortLabel}`,
      }
    : {
        title: `Push & create ${shortLabel} from default ref?`,
        description: `This action will push local commits and create a ${singular}${suffix}`,
        continueLabel: `Push & create ${shortLabel}`,
      };
}

/** The server names a feature branch from the commit it makes, so the action must commit changes. */
export function featureBranchUnavailableReason(input: {
  action: DefaultBranchConfirmableAction;
  branchName: string;
  hasWorkingTreeChanges: boolean;
}): string | null {
  if (!input.hasWorkingTreeChanges) {
    return `There are no changes to commit, so a feature branch can't be named. Create a branch yourself or continue on ${input.branchName}.`;
  }
  if (input.action === "push" || input.action === "create_pr") {
    return `This action doesn't commit your changes, so a feature branch can't be named. Create a branch yourself or continue on ${input.branchName}.`;
  }
  return null;
}
