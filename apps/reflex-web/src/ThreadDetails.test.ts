import type { VcsStatusResult } from "@t3tools/contracts";
import { createTestRuntime, guids } from "treflex";
import { describe, expect, it } from "vite-plus/test";

import {
  cancelDefaultBranch,
  continueDefaultBranch,
  getDefaultGitWork,
  type IActionContext,
  type IGitWork,
  runGitAction,
} from "./GitWork";
import type { IGitActionOutcome, IGitActionRequest } from "./Infrastructure/sourceControlEffects";
import {
  changesTotals,
  getDefaultThreadDetails,
  type ICheckout,
  type IThreadDetails,
  selectBranch,
} from "./ThreadDetails";
import { detailsLayout } from "./threadDetailsLayout";
import { ServerError } from "./Infrastructure/serverError";
import { shortcutAction, surfaceActions } from "./surfaces";

const CHECKOUT: ICheckout = {
  EnvironmentId: "env-1",
  ThreadId: "thread-1",
  ProjectId: "project-1",
  Cwd: "G:\\Sorted\\Test\\repo",
  ProjectRoot: "G:\\Sorted\\Test\\repo",
  WorktreePath: null,
};

const ON_MAIN: IActionContext = {
  RefName: "main",
  IsDefaultRef: true,
  HasWorkingTreeChanges: true,
};
const ON_FEATURE: IActionContext = { ...ON_MAIN, RefName: "feature", IsDefaultRef: false };

const OUTCOME: IGitActionOutcome = {
  Title: "Pushed",
  Description: "feature to origin",
  Branch: null,
  PrUrl: null,
  PrCreated: false,
};

function details(outcome: () => IGitActionOutcome = () => OUTCOME) {
  const actions: IGitActionRequest[] = [];
  const commands: unknown[] = [];
  const switches: unknown[] = [];
  const runtime = createTestRuntime<IThreadDetails & { Git: IGitWork }>(
    {
      $Id: "Details",
      ...getDefaultThreadDetails(),
      Checkout: CHECKOUT,
      Git: { $Id: "Git", ...getDefaultGitWork() },
    },
    {
      generateGuid: guids("id"),
      gitAction: (effect: IGitActionRequest) => {
        actions.push(effect);
        return outcome();
      },
      threadCommand: (effect: { Command: unknown }) => {
        commands.push(effect.Command);
      },
      switchBranch: (effect: { RefName: string; Create: boolean }) => {
        switches.push([effect.RefName, effect.Create]);
        return effect.RefName;
      },
      refreshVcsStatus: () => {},
    },
  );
  return { runtime, actions, commands, switches };
}

const ask = (action: "push" | "commit" | "commit_push", featureBranch = false) => ({
  Action: action,
  CommitMessage: null,
  FilePaths: null,
  FeatureBranch: featureBranch,
});

describe("runGitAction", () => {
  it("holds a push from the default branch until it's confirmed", async () => {
    const { runtime, actions } = details();
    await runtime.dispatch(runGitAction, "Git", CHECKOUT, ask("commit_push"), ON_MAIN, false);
    expect(actions).toEqual([]);
    expect(runtime.state.Git.PendingDefaultBranch).toEqual({
      Action: "commit_push",
      Branch: "main",
      IncludesCommit: true,
      CommitMessage: null,
      FilePaths: null,
    });
    await runtime.dispatch(continueDefaultBranch, "Git", CHECKOUT, false, ON_MAIN);
    expect(runtime.state.Git.PendingDefaultBranch).toBeNull();
    expect(actions.map((held) => [held.Action, held.FeatureBranch])).toEqual([
      ["commit_push", false],
    ]);
  });

  it("moves a confirmed action to a feature branch, or drops it on abort", async () => {
    const { runtime, actions } = details();
    await runtime.dispatch(runGitAction, "Git", CHECKOUT, ask("push"), ON_MAIN, false);
    await runtime.dispatch(cancelDefaultBranch, "Git");
    expect(runtime.state.Git.PendingDefaultBranch).toBeNull();
    expect(actions).toEqual([]);
    await runtime.dispatch(runGitAction, "Git", CHECKOUT, ask("push"), ON_MAIN, false);
    await runtime.dispatch(continueDefaultBranch, "Git", CHECKOUT, true, ON_MAIN);
    expect(actions.map((held) => [held.Action, held.FeatureBranch])).toEqual([["push", true]]);
  });

  it("runs a commit, and anything off the default branch, at once", async () => {
    const { runtime, actions } = details();
    await runtime.dispatch(runGitAction, "Git", CHECKOUT, ask("commit"), ON_MAIN, false);
    await runtime.dispatch(runGitAction, "Git", CHECKOUT, ask("push"), ON_FEATURE, false);
    expect(runtime.state.Git.PendingDefaultBranch).toBeNull();
    expect(actions.map((held) => [held.Action, held.ThreadId, held.Cwd])).toEqual([
      ["commit", "thread-1", CHECKOUT.Cwd],
      ["push", "thread-1", CHECKOUT.Cwd],
    ]);
    expect(runtime.state.Git.Notice).toMatchObject({ Tone: "success", Title: "Pushed" });
  });

  it("moves the thread to a branch the action created, and names a created PR", async () => {
    const { runtime, commands } = details(() => ({
      ...OUTCOME,
      Branch: "t3/feature",
      PrCreated: true,
      PrUrl: "https://example.invalid/pr/1",
    }));
    await runtime.dispatch(runGitAction, "Git", CHECKOUT, ask("commit", true), ON_MAIN, false);
    expect(commands).toEqual([{ Kind: "branch", Branch: "t3/feature" }]);
    expect(runtime.state.Git.Notice).toMatchObject({
      Title: "Created PR",
      Description: null,
      Url: "https://example.invalid/pr/1",
    });
  });

  it("shows a failure as an error notice", async () => {
    const { runtime } = details(() => {
      throw new ServerError("nothing to commit");
    });
    await runtime.dispatch(runGitAction, "Git", CHECKOUT, ask("commit"), ON_FEATURE, false);
    expect(runtime.state.Git.Notice).toEqual({
      Tone: "error",
      Title: "Action failed",
      Description: "nothing to commit",
      Url: null,
    });
  });
});

describe("selectBranch", () => {
  const ref = { Name: "other", IsRemote: false, Current: false, IsDefault: false };

  it("checks out the branch and moves the thread to it", async () => {
    const { runtime, switches, commands } = details();
    await runtime.dispatch(selectBranch, "Details", { ...ref, WorktreePath: null });
    expect(switches).toEqual([["other", false]]);
    expect(commands).toEqual([{ Kind: "branch", Branch: "other" }]);
  });

  it("refuses a branch checked out in another worktree, but not in this one", async () => {
    const { runtime, switches } = details();
    await runtime.dispatch(selectBranch, "Details", {
      ...ref,
      WorktreePath: "G:\\Sorted\\Test\\repo-other",
    });
    expect(switches).toEqual([]);
    expect(runtime.state.BranchError).toBe("other is checked out in G:\\Sorted\\Test\\repo-other.");
    await runtime.dispatch(selectBranch, "Details", {
      ...ref,
      WorktreePath: "g:/sorted/test/repo/",
    });
    expect(switches).toEqual([["other", false]]);
  });
});

describe("changesTotals", () => {
  const status = (tree: [number, number], branch?: [number, number]): VcsStatusResult =>
    ({
      workingTree: { files: [], insertions: tree[0], deletions: tree[1] },
      ...(branch === undefined
        ? {}
        : {
            branchChanges: { baseRef: "origin/main", insertions: branch[0], deletions: branch[1] },
          }),
    }) as unknown as VcsStatusResult;

  it("prefers the branch's changes, then uncommitted ones", () => {
    expect(changesTotals(status([1, 2], [3, 4]))).toEqual({
      Insertions: 3,
      Deletions: 4,
      BaseRef: "origin/main",
    });
    expect(changesTotals(status([1, 2], [0, 0]))).toEqual({
      Insertions: 1,
      Deletions: 2,
      BaseRef: null,
    });
    expect(changesTotals(status([0, 0], [0, 0]))).toMatchObject({ BaseRef: "origin/main" });
    expect(changesTotals(status([0, 0]))).toEqual({ Insertions: 0, Deletions: 0, BaseRef: null });
    expect(changesTotals(null)).toBeNull();
  });
});

describe("detailsLayout", () => {
  const at = (width: number, open = true) =>
    detailsLayout({ Width: width, Height: 800, Padding: 48, MaxChatWidth: 736, Open: open });

  it("pins the card only where the chat keeps its minimum width beside it", () => {
    expect(at(1011)).toEqual({ Inline: false, Shift: 0, LaneWidth: null });
    expect(at(1012).Inline).toBe(true);
    expect(at(1012, false)).toEqual({ Inline: true, Shift: 0, LaneWidth: null });
  });

  it("narrows and moves the lane left to clear the card, and leaves a wide one centred", () => {
    const narrow = at(1100);
    expect(narrow.LaneWidth).toBe(728);
    expect(narrow.Shift).toBe(-138);
    expect(at(2000)).toEqual({ Inline: true, Shift: 0, LaneWidth: null });
  });
});

describe("surface launcher shortcuts", () => {
  const actions = surfaceActions({ TerminalAvailable: true, DiffAvailable: false });
  const key = (value: string, extra: Partial<KeyboardEvent> = {}) => ({
    key: value,
    defaultPrevented: false,
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...extra,
  });
  const outside = { closest: () => null };

  it("opens an available surface by its letter, outside text fields and modifiers", () => {
    expect(shortcutAction(actions, key("t"), outside)?.Label).toBe("Terminal");
    expect(shortcutAction(actions, key("d"), outside)).toBeNull();
    expect(shortcutAction(actions, key("b"), outside)).toBeNull();
    expect(shortcutAction(actions, key("t", { ctrlKey: true }), outside)).toBeNull();
    expect(shortcutAction(actions, key("t"), { closest: () => ({}) })).toBeNull();
  });
});
