import type { VcsStatusResult } from "@t3tools/contracts";
import {
  createTestRuntime,
  guids,
  type IActionGenerator,
  type IAskId,
  type IEntity,
  inFlight,
  type ISelectorGenerator,
  registerDataSource,
  settled,
} from "treflex";
import { describe, expect, it } from "vite-plus/test";

import {
  chooseDefaultBranch,
  defaultBranchConfirm,
  getDefaultGitWork,
  type IActionContext,
  type IDefaultBranchChoice,
  type IGitWork,
  runGitAction,
} from "./GitWork";
import type { IGitActionOutcome, IGitActionRequest } from "./Infrastructure/sourceControlEffects";
import type { ICheckout } from "./checkout";
import {
  branchMatchesQuery,
  changesTotals,
  getDefaultThreadDetails,
  type IThreadDetails,
  selectBranch,
} from "./ThreadDetails";
import type { IReplica } from "./ThreadSession";
import { detailsLayout } from "./threadDetailsLayout";
import { serverFailure } from "./Infrastructure/serverError";
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

interface ITestRoot extends IEntity {
  Replica: IReplica;
  Details: IThreadDetails;
  Git: IGitWork;
}

function* registerReplica(draft: ITestRoot): IActionGenerator {
  yield* registerDataSource(draft, "Replica", draft.Replica);
}

async function details(outcome: () => IGitActionOutcome = () => OUTCOME) {
  const actions: IGitActionRequest[] = [];
  const commands: unknown[] = [];
  const switches: unknown[] = [];
  const { EnvironmentId, ThreadId, ProjectId, ProjectRoot, Cwd } = CHECKOUT;
  const runtime = createTestRuntime<ITestRoot>(
    {
      $Id: "Root",
      Replica: {
        $Id: "Replica",
        Shell: { Projects: { [ProjectId]: { workspaceRoot: ProjectRoot } } },
        OpenThreads: { [ThreadId]: { Thread: { projectId: ProjectId, worktreePath: null } } },
      } as never,
      Details: { $Id: "Details", ...getDefaultThreadDetails(EnvironmentId, ThreadId, Cwd) },
      Git: { $Id: "Git", ...getDefaultGitWork(EnvironmentId, ThreadId) },
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
  await runtime.dispatch(registerReplica, "Root");
  return { runtime, actions, commands, switches };
}

const ask = (action: "push" | "commit" | "commit_push", featureBranch = false) => ({
  Action: action,
  CommitMessage: null,
  FilePaths: null,
  FeatureBranch: featureBranch,
});

describe("runGitAction", () => {
  const confirm = (runtime: Awaited<ReturnType<typeof details>>["runtime"]) =>
    runtime.processSelector(defaultBranchConfirm, () => runtime.state.Git);
  const busy = (runtime: Awaited<ReturnType<typeof details>>["runtime"]) =>
    runtime.processSelector(
      function* (draft: IGitWork): ISelectorGenerator<boolean> {
        return yield* inFlight(runGitAction, draft);
      },
      () => runtime.state.Git,
    );
  const choose = (
    runtime: Awaited<ReturnType<typeof details>>["runtime"],
    choice?: IDefaultBranchChoice,
  ) =>
    runtime.dispatch(
      chooseDefaultBranch,
      "Git",
      confirm(runtime)!.Id as IAskId<IDefaultBranchChoice>,
      choice,
    );

  it("asks before a push from the default branch, busy until the answer", async () => {
    const { runtime, actions } = await details();
    const running = runtime.dispatch(runGitAction, "Git", ask("commit_push"), ON_MAIN);
    await settled();
    expect(actions).toEqual([]);
    expect(confirm(runtime)?.Request).toEqual({
      Path: "Git/DefaultBranch",
      Action: "commit_push",
      Branch: "main",
      IncludesCommit: true,
    });
    expect(busy(runtime)).toBe(true);
    await choose(runtime, "continue");
    await running;
    expect(confirm(runtime)).toBeNull();
    expect(busy(runtime)).toBe(false);
    expect(actions.map((held) => [held.Action, held.FeatureBranch])).toEqual([
      ["commit_push", false],
    ]);
  });

  it("moves a confirmed action to a feature branch, or drops it on abort", async () => {
    const { runtime, actions } = await details();
    const aborted = runtime.dispatch(runGitAction, "Git", ask("push"), ON_MAIN);
    await settled();
    await choose(runtime);
    await aborted;
    expect(confirm(runtime)).toBeNull();
    expect(busy(runtime)).toBe(false);
    expect(actions).toEqual([]);
    const moved = runtime.dispatch(runGitAction, "Git", ask("push"), ON_MAIN);
    await settled();
    await choose(runtime, "featureBranch");
    await moved;
    expect(actions.map((held) => [held.Action, held.FeatureBranch])).toEqual([["push", true]]);
  });

  it("runs a commit, and anything off the default branch, at once", async () => {
    const { runtime, actions } = await details();
    await runtime.dispatch(runGitAction, "Git", ask("commit"), ON_MAIN);
    await runtime.dispatch(runGitAction, "Git", ask("push"), ON_FEATURE);
    expect(confirm(runtime)).toBeNull();
    expect(actions.map((held) => [held.Action, held.ThreadId, held.Cwd])).toEqual([
      ["commit", "thread-1", CHECKOUT.Cwd],
      ["push", "thread-1", CHECKOUT.Cwd],
    ]);
    expect(runtime.state.Git.Notice).toMatchObject({ Tone: "success", Title: "Pushed" });
  });

  it("moves the thread to a branch the action created, and names a created PR", async () => {
    const { runtime, commands } = await details(() => ({
      ...OUTCOME,
      Branch: "t3/feature",
      PrCreated: true,
      PrUrl: "https://example.invalid/pr/1",
    }));
    await runtime.dispatch(runGitAction, "Git", ask("commit", true), ON_MAIN);
    expect(commands).toEqual([{ Kind: "branch", Branch: "t3/feature" }]);
    expect(runtime.state.Git.Notice).toMatchObject({
      Title: "Created PR",
      Description: null,
      Url: "https://example.invalid/pr/1",
    });
  });

  it("shows a failure as an error notice", async () => {
    const { runtime } = await details(() => {
      throw serverFailure("nothing to commit");
    });
    await runtime.dispatch(runGitAction, "Git", ask("commit"), ON_FEATURE);
    expect(runtime.state.Git.Notice).toEqual({
      Tone: "error",
      Title: "Action failed",
      Description: "nothing to commit",
      Url: null,
    });
  });
});

describe("branchMatchesQuery", () => {
  it("keeps only branches the query names, so a stale search's rows drop out", () => {
    expect(branchMatchesQuery("treflex-main", "")).toBe(true);
    expect(branchMatchesQuery("treflex-main", " Main ")).toBe(true);
    expect(branchMatchesQuery("treflex-main", "new-feature")).toBe(false);
    expect(branchMatchesQuery("feature/my-branch", "my branch")).toBe(true);
  });
});

describe("selectBranch", () => {
  const ref = { Name: "other", IsRemote: false, Current: false, IsDefault: false };

  it("checks out the branch and moves the thread to it", async () => {
    const { runtime, switches, commands } = await details();
    await runtime.dispatch(selectBranch, "Details", { ...ref, WorktreePath: null });
    expect(switches).toEqual([["other", false]]);
    expect(commands).toEqual([{ Kind: "branch", Branch: "other" }]);
  });

  it("refuses a branch checked out in another worktree, but not in this one", async () => {
    const { runtime, switches } = await details();
    await runtime.dispatch(selectBranch, "Details", {
      ...ref,
      WorktreePath: "G:\\Sorted\\Test\\repo-other",
    });
    expect(switches).toEqual([]);
    expect(runtime.state.Details.BranchError).toBe(
      "other is checked out in G:\\Sorted\\Test\\repo-other.",
    );
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
  const actions = surfaceActions({
    TerminalAvailable: true,
    DiffAvailable: false,
    SideChatAvailable: false,
  });
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
