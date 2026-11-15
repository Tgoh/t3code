import { sortActiveThreadsByOrderKey } from "@t3tools/client-runtime/state/thread-sort";
import { isListedThreadLineage } from "@t3tools/contracts";
import {
  type IActionGenerator,
  type IEntity,
  type ISelectorGenerator,
  isEnded,
  openResource,
  receiver,
  startTimer,
  stopTimer,
  transient,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import type {
  IWireProject,
  IWireShellItem,
  IWireShellSnapshot,
  IWireThreadShell,
} from "./Infrastructure/wire";
import { byId, put, reconcile } from "./rows";

declare module "treflex" {
  interface IResourceRegistry {
    "Shell/Stream": { Type: "shellStream" };
  }
  interface ITimerRegistry {
    "Shell/Reopen": {};
  }
}

const REOPEN_MS = 1_000;

export interface IShell extends IEntity {
  EnvironmentId: string;
  LastSequence: number;
  Projects: Record<string, IWireProject>;
  Threads: Record<string, IWireThreadShell>;
}

export function getDefaultShell(environmentId: string): Omit<IShell, "$Id"> {
  return {
    EnvironmentId: environmentId,
    LastSequence: 0,
    Projects: {},
    Threads: {},
  };
}

const streamState = (draft: IShell) =>
  transient(draft, "Shell/StreamState", { Synchronized: false });

export function* openShellStream(draft: IShell): IActionGenerator {
  yield* openResource(
    draft,
    "Shell/Stream",
    ShellReceiver,
    { Type: "shellStream", EnvironmentId: draft.EnvironmentId },
    { ResumeFrom: "LastSequence" },
  );
}

function retainRepositoryIdentity(
  held: IWireProject | undefined,
  next: IWireProject,
): IWireProject {
  return next.repositoryIdentity == null &&
    held?.repositoryIdentity != null &&
    held.workspaceRoot === next.workspaceRoot
    ? { ...next, repositoryIdentity: held.repositoryIdentity }
    : next;
}

// An enrichment carries only repository identities: its other fields can be older than what is held.
function applyEnrichment(draft: IShell, projects: IWireProject[], roots: string[]): void {
  for (const candidate of projects) {
    const held = draft.Projects[candidate.id];
    if (held === undefined || held.workspaceRoot !== candidate.workspaceRoot) continue;
    if (roots.includes(held.workspaceRoot) || held.repositoryIdentity == null) {
      if (candidate.repositoryIdentity === undefined) delete held.repositoryIdentity;
      else held.repositoryIdentity = candidate.repositoryIdentity;
    }
  }
}

// A row the snapshot leaves out only leaves the list: the shell trims idle subagents and older
// settled threads, so nothing about the thread itself follows from its absence here.
function applySnapshot(draft: IShell, snapshot: IWireShellSnapshot): void {
  draft.LastSequence = snapshot.snapshotSequence;
  reconcile(
    draft.Projects,
    byId(snapshot.projects.map((p) => retainRepositoryIdentity(draft.Projects[p.id], p))),
  );
  reconcile(
    draft.Threads,
    byId(
      snapshot.threads.map((thread) => {
        const links = draft.Threads[thread.id]?.pullRequests;
        return thread.pullRequests === undefined && links !== undefined
          ? { ...thread, pullRequests: links }
          : thread;
      }),
    ),
  );
}

function applyItem(draft: IShell, item: Exclude<IWireShellItem, { kind: "synchronized" }>): void {
  if (item.kind === "snapshot") {
    if (item.resolvedRepositoryIdentityRoots !== undefined)
      applyEnrichment(draft, item.snapshot.projects, item.resolvedRepositoryIdentityRoots);
    else applySnapshot(draft, item.snapshot);
    return;
  }
  if (item.sequence <= draft.LastSequence) return;
  draft.LastSequence = item.sequence;
  switch (item.kind) {
    case "project.updated":
      put(draft.Projects, retainRepositoryIdentity(draft.Projects[item.project.id], item.project));
      break;
    case "project.removed":
      delete draft.Projects[item.projectId];
      break;
    case "thread.updated":
      if (item.location === "active") put(draft.Threads, item.thread);
      else delete draft.Threads[item.thread.id];
      break;
    case "thread.removed":
      delete draft.Threads[item.threadId];
      break;
  }
}

export function* dropThreadRow(draft: IShell, threadId: string): IActionGenerator {
  delete draft.Threads[threadId];
}

function* reopenLater(draft: IShell): IActionGenerator {
  yield* startTimer(draft, "Shell/Reopen", ShellReceiver, REOPEN_MS);
}

export const ShellReceiver = receiver<IShell>("ShellReceiver")({
  *"Shell/Stream"(draft, message) {
    if (isEnded(message)) {
      // A batch the receiver failed would fail again on every reopen.
      if (message.$Ended.Reason !== "receiver-failed") yield* reopenLater(draft);
      return;
    }
    if (!("Item" in message)) (yield* streamState(draft)).Synchronized = false;
    else if (message.Item.kind === "synchronized") (yield* streamState(draft)).Synchronized = true;
    else applyItem(draft, message.Item);
  },
  *"Shell/Reopen"(draft) {
    yield* stopTimer(draft, "Shell/Reopen");
    yield* openShellStream(draft);
  },
});

export function* shellSynchronized(draft: IShell): ISelectorGenerator<boolean> {
  return (yield* streamState(draft)).Synchronized;
}

export type IThreadStatus = "running" | "waiting" | "failed" | "completed" | "stopped" | "idle";

export function runStatus(status: IWireThreadShell["status"]): IThreadStatus {
  switch (status) {
    case "preparing":
    case "queued":
    case "starting":
    case "running":
      return "running";
    case "waiting":
      return "waiting";
    case "failed":
      return "failed";
    case "completed":
      return "completed";
    case "interrupted":
    case "cancelled":
      return "stopped";
    case "rolled_back":
    case "idle":
      return "idle";
  }
}

export function* sidebarThreads(draft: IShell): ISelectorGenerator<IWireThreadShell[]> {
  return sortActiveThreadsByOrderKey(
    Object.values(draft.Threads).filter((thread) => isListedThreadLineage(thread.lineage as never)),
  );
}

export type ISidebarStatus = "working" | "approval" | "input" | "failed" | "done" | null;

// Follows resolveSidebarThreadStatus and hasUnseenCompletion in apps/web/src/components/Sidebar.logic.ts.
export function sidebarStatus(thread: IWireThreadShell): ISidebarStatus {
  const request = thread.pendingRuntimeRequest;
  if (request !== null && request.kind === "user_input") return "input";
  if (request !== null && request.kind !== "auth_refresh") return "approval";
  const status = runStatus(thread.activityRunStatus ?? thread.status);
  if (status === "running" || status === "waiting") return "working";
  if (status === "failed") return "failed";
  const completed = thread.latestRunCompletedAt;
  const visited = thread.lastVisitedAt;
  return completed != null && visited != null && Date.parse(completed) > Date.parse(visited)
    ? "done"
    : null;
}

export interface ISidebarSections {
  Pinned: IWireThreadShell[];
  Active: IWireThreadShell[];
  Snoozed: IWireThreadShell[];
  Settled: IWireThreadShell[];
}

// Follows threadRaisedHandWhileSnoozed in packages/client-runtime/src/state/threadSettled.ts: only a
// request for the user or a fresh failure ends a snooze early.
export function isSnoozed(thread: IWireThreadShell, now: number): boolean {
  if (thread.snoozedUntil == null || Date.parse(thread.snoozedUntil) <= now) return false;
  if (thread.pendingRuntimeRequest !== null || (thread.pendingGuestMessageCount ?? 0) > 0)
    return false;
  if (thread.status !== "failed") return true;
  const failedAt = thread.latestRunCompletedAt;
  const snoozedAt = thread.snoozedAt;
  return failedAt != null && snoozedAt != null && Date.parse(failedAt) <= Date.parse(snoozedAt);
}

const newestFirst = (left: string | null | undefined, right: string | null | undefined): number =>
  Date.parse(right ?? "") - Date.parse(left ?? "");

export interface IProjectFolder {
  ProjectId: string;
  Project: IWireProject | undefined;
  Threads: IWireThreadShell[];
}

export function projectFolders(
  active: IWireThreadShell[],
  projects: Record<string, IWireProject>,
): IProjectFolder[] {
  const folders = new Map<string, IProjectFolder>();
  const folderOf = (projectId: string) => {
    let folder = folders.get(projectId);
    if (folder === undefined) {
      folder = { ProjectId: projectId, Project: projects[projectId], Threads: [] };
      folders.set(projectId, folder);
    }
    return folder;
  };
  for (const project of Object.values(projects)) {
    if (project.archivedAt == null) folderOf(project.id);
  }
  for (const thread of active) folderOf(thread.projectId).Threads.push(thread);
  const rank = (folder: IProjectFolder) =>
    folder.Project?.archivedAt != null ? 2 : folder.Project?.pinnedAt != null ? 0 : 1;
  const title = (folder: IProjectFolder) => folder.Project?.title ?? "";
  return [...folders.values()].sort(
    (left, right) =>
      rank(left) - rank(right) ||
      (rank(left) === 0
        ? Date.parse(left.Project!.pinnedAt!) - Date.parse(right.Project!.pinnedAt!)
        : title(left).localeCompare(title(right))),
  );
}

// `threads` keeps its order within Active, so the inbox stays on the server's order key.
export function sidebarSections(threads: IWireThreadShell[], now: number): ISidebarSections {
  const sections: ISidebarSections = { Pinned: [], Active: [], Snoozed: [], Settled: [] };
  for (const thread of threads) {
    if (isSnoozed(thread, now)) sections.Snoozed.push(thread);
    else if (thread.settledOverride === "settled") sections.Settled.push(thread);
    else if (thread.pinnedAt != null) sections.Pinned.push(thread);
    else sections.Active.push(thread);
  }
  sections.Pinned.sort((left, right) =>
    (left.pinOrderKey ?? left.id).localeCompare(right.pinOrderKey ?? right.id),
  );
  sections.Snoozed.sort(
    (left, right) => Date.parse(left.snoozedUntil ?? "") - Date.parse(right.snoozedUntil ?? ""),
  );
  sections.Settled.sort((left, right) => newestFirst(left.settledAt, right.settledAt));
  return sections;
}

export function hasUnseenCompletion(thread: IWireThreadShell): boolean {
  const completed = thread.latestRunCompletedAt;
  if (completed == null) return false;
  const visited = thread.lastVisitedAt;
  return visited == null || Date.parse(completed) > Date.parse(visited);
}

// Follows resolveThreadWorkingStartedAt in packages/client-runtime/src/state/models.ts.
export function workingStartedAt(thread: IWireThreadShell): string | null {
  if (thread.activityRunStartedAt !== undefined) return thread.activityRunStartedAt;
  if (thread.latestRunCompletedAt != null || thread.latestRunId !== thread.activeRunId) return null;
  return thread.latestRunStartedAt ?? thread.latestRunRequestedAt ?? null;
}

export default createEntityFeature<IShell>(import.meta.url)(
  {},
  { sidebarThreads, shellSynchronized },
);
