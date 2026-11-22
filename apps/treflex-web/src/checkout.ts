import { getData, type IEntity, type ISelectorGenerator } from "treflex";

export interface ICheckout {
  EnvironmentId: string;
  ThreadId: string;
  ProjectId: string;
  Cwd: string;
  ProjectRoot: string;
  WorktreePath: string | null;
}

export interface IThreadPart extends IEntity {
  EnvironmentId: string;
  ThreadId: string;
}

/** Null until both the thread and its project have arrived, and always for a new-thread draft. */
export function* checkout(draft: IThreadPart): ISelectorGenerator<ICheckout | null> {
  const replica = yield* getData(draft, "Replica");
  const thread = replica?.OpenThreads[draft.ThreadId]?.Thread;
  if (replica === undefined || thread == null) return null;
  const root = replica.Shell.Projects[thread.projectId]?.workspaceRoot;
  if (root === undefined) return null;
  return {
    EnvironmentId: draft.EnvironmentId,
    ThreadId: draft.ThreadId,
    ProjectId: thread.projectId,
    Cwd: thread.worktreePath ?? root,
    ProjectRoot: root,
    WorktreePath: thread.worktreePath,
  };
}

export function* threadShown(draft: IThreadPart): ISelectorGenerator<boolean> {
  const selection = yield* getData(draft, "Selection");
  return selection?.SelectedThreadId === draft.ThreadId && selection.View === null;
}
