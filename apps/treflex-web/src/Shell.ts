import { hasQueuedTurnStart } from "@t3tools/client-runtime/state/thread-settled";
import { resolveListedAncestorThreadRef } from "@t3tools/client-runtime/state/threads";
import {
  resolveThreadActivityTimestamp,
  sortActiveThreadsByOrderKey,
  sortPinnedThreadsByOrderKey,
} from "@t3tools/client-runtime/state/thread-sort";
import { isListedThreadLineage, isProviderNativeSubagentThread } from "@t3tools/contracts";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import * as DateTime from "effect/DateTime";
import {
  getData,
  type IActionGenerator,
  type IEntity,
  type IOpenGenerator,
  type ISelectorGenerator,
  isEnded,
  open,
  openResource,
  publishToNearest,
  receiver,
  resource,
  start,
  startTimer,
  stopTimer,
  transient,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import {
  type IThreadCommand,
  threadCommandEffect,
  withCommandId,
} from "./Infrastructure/commandEffects";
import { clockNowEffect } from "./Infrastructure/preferences";
import type { ISelection } from "./ThreadSession";
import { serverError } from "./Infrastructure/serverError";
import { expireInbox, type IInbox, type IInboxFacts, inboxDeadline, observeInbox } from "./inbox";
import { faviconKey, faviconTarget, type IProjectFaviconTarget } from "./projectIcon";
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
    "Project/Favicons": { Type: "projectFavicons" };
  }
  interface ITimerRegistry {
    "Shell/Reopen": {};
    "Shell/InboxGrace": {};
  }
  interface IMessageRegistry {
    /** Thread rows left the shell, so an open thread's lineage may need their titles looked up. */
    "Shell/ThreadsDropped": {};
    "Shell/ProjectsChanged": {};
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
  // Sent only to subscribers that pass httpSnapshotFallback, which shellStream.ts doesn't.
  if (item.kind === "snapshot-required") return;
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
    default:
      item satisfies never;
  }
}

function* selectedThreadId(draft: IShell): ISelectorGenerator<string | null> {
  return (yield* getData(draft, "Selection"))?.SelectedThreadId ?? null;
}

const lastVisit = (draft: IShell) =>
  transient(draft, "Shell/Visit", {
    ThreadId: null as string | null,
    Completion: null as string | null,
    /** A visit sent that neither succeeded, nor was refused, nor shows in the thread's row. */
    Unconfirmed: null as { ThreadId: string; VisitedAt: string } | null,
  });

export interface IVisitOptions {
  /** Skips the once-per-completion dedupe. */
  Again?: boolean;
  /** Resends an unconfirmed visit to the shown thread, if it's still due. */
  Retry?: boolean;
  /** The user opened the thread, which counts toward search ranking even when it's already read. */
  Opened?: boolean;
  /** The palette query that picked the thread. */
  SearchQuery?: string;
}

/**
 * Marks the shown thread visited: the selected one, when no Settings or Usage page covers it.
 * Once per completion unless `Again`, so a thread marked unread while it's shown stays unread
 * until its next completion. A call with nothing to visit still records the completion, which
 * keeps a later mark-unread sticky.
 */
export function* visitShown(draft: IShell, options: IVisitOptions = {}): IOpenGenerator {
  const selection = yield* getData(draft, "Selection");
  if (selection === undefined || selection.View !== null) return;
  const threadId = selection.SelectedThreadId;
  const row = threadId === null ? undefined : draft.Threads[threadId];
  if (threadId === null || row === undefined) return;
  const visit = yield* lastVisit(draft);
  if (options.Retry === true && visit.Unconfirmed?.ThreadId !== threadId) return;
  const completion = row.latestRunCompletedAt ?? null;
  const repeat = visit.ThreadId === threadId && visit.Completion === completion;
  const forced = options.Again === true || options.Opened === true || options.Retry === true;
  if (repeat && !forced) return;
  visit.ThreadId = threadId;
  visit.Completion = completion;
  if (!needsVisit(row) && options.Opened !== true) return;
  const environmentId = draft.EnvironmentId;
  const visitedAt = row.updatedAt;
  const command: IThreadCommand = {
    Kind: "visit",
    VisitedAt: visitedAt,
    ...(options.Opened === true ? { Opened: true } : {}),
    ...(options.SearchQuery ? { SearchQuery: options.SearchQuery.slice(0, 200) } : {}),
  };
  visit.Unconfirmed = { ThreadId: threadId, VisitedAt: visitedAt };
  try {
    yield* open(
      withCommandId((commandId) =>
        threadCommandEffect({
          EnvironmentId: environmentId,
          ThreadId: threadId,
          CommandId: commandId,
          Command: command,
        }),
      ),
    );
  } catch (error) {
    // A visit is bookkeeping the user didn't ask for, and the next one covers it.
    serverError(error);
    // A refusal and a dropped socket both arrive as a ServerError; only the second is worth a retry.
    if (!(yield* streamState(draft)).Synchronized) return;
  }
  const held = yield* lastVisit(draft);
  if (held.Unconfirmed?.ThreadId === threadId && held.Unconfirmed.VisitedAt === visitedAt)
    held.Unconfirmed = null;
}

// Starts the visit only when the item left the shown thread due, so streaming updates stay cheap.
function* visitIfDue(draft: IShell): IActionGenerator {
  const visit = yield* lastVisit(draft);
  const sent = visit.Unconfirmed;
  const echoed = sent === null ? undefined : draft.Threads[sent.ThreadId]?.lastVisitedAt;
  // The server applied the visit even if its answer was lost, so a later mark-unread stays.
  if (sent !== null && echoed != null && Date.parse(echoed) >= Date.parse(sent.VisitedAt))
    visit.Unconfirmed = null;
  const selected = yield* getData(draft, "Selection");
  const row =
    selected?.SelectedThreadId == null ? undefined : draft.Threads[selected.SelectedThreadId];
  if (selected?.View === null && row !== undefined && needsVisit(row))
    yield* start(visitShown, draft);
}

function* reopenLater(draft: IShell): IActionGenerator {
  yield* startTimer(draft, "Shell/Reopen", ShellReceiver, REOPEN_MS);
}

const changesProjects = (item: Exclude<IWireShellItem, { kind: "synchronized" }>) =>
  (item.kind === "snapshot" && item.resolvedRepositoryIdentityRoots === undefined) ||
  item.kind === "project.updated";

const dropsThreads = (item: Exclude<IWireShellItem, { kind: "synchronized" }>) =>
  (item.kind === "snapshot" && item.resolvedRepositoryIdentityRoots === undefined) ||
  item.kind === "thread.removed" ||
  (item.kind === "thread.updated" && item.location !== "active");

function faviconKeys(draft: IShell): Record<string, string | null> {
  const keys: Record<string, string | null> = {};
  for (const project of Object.values(draft.Projects)) {
    const target = faviconTarget(draft.EnvironmentId, project);
    keys[project.id] = target === null ? null : faviconKey(target);
  }
  return keys;
}

/** The favicon of each project that arrived or whose favicon source changed. */
function newFavicons(draft: IShell, previous: Record<string, string | null>) {
  return Object.values(draft.Projects).flatMap((project) => {
    const target = faviconTarget(draft.EnvironmentId, project);
    return target === null || previous[project.id] === faviconKey(target) ? [] : [target];
  });
}

export function* requestFavicons(
  draft: IShell,
  targets: IProjectFaviconTarget[],
): IActionGenerator {
  for (const target of targets) yield* resource(draft, "Project/Favicons").request(target);
}

const PROJECT_ITEMS = new Set<IWireShellItem["kind"]>([
  "snapshot",
  "project.updated",
  "project.removed",
]);

const THREAD_ITEMS = new Set<IWireShellItem["kind"]>([
  "snapshot",
  "thread.updated",
  "thread.removed",
]);

export const ShellReceiver = receiver<IShell>("ShellReceiver")({
  *"Shell/Stream"(draft, message) {
    if (isEnded(message)) {
      (yield* streamState(draft)).Synchronized = false;
      // A batch the receiver failed would fail again on every reopen.
      if (message.$Ended.Reason !== "receiver-failed") yield* reopenLater(draft);
      return;
    }
    if (!("Item" in message)) (yield* streamState(draft)).Synchronized = false;
    else if (message.Item.kind === "synchronized") {
      (yield* streamState(draft)).Synchronized = true;
      if ((yield* lastVisit(draft)).Unconfirmed !== null)
        yield* start(visitShown, draft, { Retry: true });
    } else {
      const projects = changesProjects(message.Item) ? faviconKeys(draft) : null;
      const threads = dropsThreads(message.Item) ? Object.keys(draft.Threads) : null;
      applyItem(draft, message.Item);
      const favicons = projects === null ? [] : newFavicons(draft, projects);
      if (favicons.length > 0) yield* start(requestFavicons, draft, favicons);
      if (threads?.some((id) => draft.Threads[id] === undefined))
        yield* publishToNearest(draft, "Shell/ThreadsDropped");
      if (PROJECT_ITEMS.has(message.Item.kind))
        yield* publishToNearest(draft, "Shell/ProjectsChanged");
      if (THREAD_ITEMS.has(message.Item.kind)) yield* followInbox(draft);
      yield* visitIfDue(draft);
    }
  },
  *"Shell/Reopen"(draft) {
    yield* stopTimer(draft, "Shell/Reopen");
    yield* openShellStream(draft);
  },
  *"Shell/InboxGrace"(draft) {
    const now = yield* clockNowEffect();
    const inbox = yield* inboxOf(draft);
    expireInbox(inbox, now);
    yield* scheduleInbox(draft, inbox, now);
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

/** The row that stands for the selected thread: a subagent, side chat or delegated task has none. */
export function* sidebarRowThreadId(draft: IShell): ISelectorGenerator<string | null> {
  const selected = yield* selectedThreadId(draft);
  if (selected === null) return null;
  const environmentId = draft.EnvironmentId;
  const rows: Array<Pick<IWireThreadShell, "id" | "lineage" | "delegatedFrom" | "archivedAt">> =
    Object.values(draft.Threads);
  // The shell omits idle subagents, so an open one is known only from its own thread.
  if (draft.Threads[selected] === undefined) {
    const open = (yield* getData(draft, "Replica"))?.OpenThreads[selected]?.Thread;
    if (open != null) rows.push(open);
  }
  const threads = rows.map((thread) => ({
    id: thread.id,
    environmentId,
    lineage: thread.lineage,
    delegatedFrom: thread.delegatedFrom,
    archivedAt: thread.archivedAt,
  }));
  return resolveListedAncestorThreadRef(
    { environmentId, threadId: selected } as never,
    threads as never,
  ).threadId;
}

export type ISubagentRequest = "approval" | "user_input";

const isChildRunLive = (thread: IWireThreadShell) =>
  thread.activityRunStatus !== undefined
    ? thread.activityRunStatus !== null
    : thread.status === "preparing" ||
      thread.status === "starting" ||
      thread.status === "running" ||
      thread.status === "waiting";

function requestOf(thread: IWireThreadShell): ISubagentRequest | null {
  const kind = thread.pendingRuntimeRequest?.kind;
  if (kind === undefined || kind === "auth_refresh") return null;
  return kind === "user_input" ? "user_input" : "approval";
}

const NO_SUBAGENT_REQUESTS: Record<string, ISubagentRequest> = Object.freeze({});

// Follows pendingSubagentRequestsByThread in packages/client-runtime/src/state/threadShell.ts,
// without tasks delegated to linked environments.
export function* subagentRequests(
  draft: IShell,
): ISelectorGenerator<Record<string, ISubagentRequest>> {
  const threads = draft.Threads;
  const requests: Record<string, ISubagentRequest> = {};
  const flag = (firstParentId: string | null, request: ISubagentRequest, seen: Set<string>) => {
    let parentId = firstParentId;
    while (parentId !== null && !seen.has(parentId)) {
      seen.add(parentId);
      if (requests[parentId] !== "approval") requests[parentId] = request;
      const parent = threads[parentId];
      parentId =
        parent?.lineage.relationshipToParent === "subagent" || parent?.lineage.sideChat === true
          ? parent.lineage.parentThreadId
          : null;
    }
  };
  for (const child of Object.values(threads)) {
    const parentId = child.lineage.parentThreadId;
    if (child.lineage.sideChat === true) {
      const request = requestOf(child);
      if (parentId !== null && request !== null && requests[parentId] !== "approval")
        requests[parentId] = request;
      continue;
    }
    if (child.lineage.relationshipToParent !== "subagent") continue;
    if (isProviderNativeSubagentThread(child) || !isChildRunLive(child)) continue;
    // The coordinator answers a subagent's questions, except the cards only the user can fill.
    const request = requestOf(child);
    if (request === "approval") flag(parentId, "approval", new Set([child.id]));
    else if (request === "user_input" && child.pendingRuntimeRequest?.userOnly === true)
      flag(parentId, "user_input", new Set([child.id]));
  }
  return Object.keys(requests).length === 0 ? NO_SUBAGENT_REQUESTS : requests;
}

export function runCompletedAt(thread: IWireThreadShell): string | null {
  if (thread.latestRunCompletedAt !== undefined) return thread.latestRunCompletedAt;
  const status = thread.status;
  return status === "idle" ||
    status === "completed" ||
    status === "interrupted" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "rolled_back"
    ? thread.updatedAt
    : null;
}

// Follows shellRuntime in packages/client-runtime/src/state/models.ts.
function runtimeStatus(thread: IWireThreadShell): IWireThreadShell["status"] | null {
  const parkAtIdle =
    backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks ?? []) &&
    thread.status !== "failed";
  if (thread.latestRunId === null && !parkAtIdle) return null;
  return parkAtIdle ? "idle" : (thread.activityRunStatus ?? thread.status);
}

export type ISidebarStatus =
  | "preparing"
  | "working"
  | "waiting"
  | "approval"
  | "input"
  | "failed"
  | "done"
  | null;

export const isBusy = (status: ISidebarStatus): boolean =>
  status === "working" || status === "preparing";

// Follows hasUnseenRunFailure in packages/client-runtime/src/state/threadSettled.ts.
function hasUnseenRunFailure(thread: IWireThreadShell): boolean {
  if (thread.latestRunId === null || thread.status !== "failed") return false;
  if (!thread.lastVisitedAt) return true;
  const failedAt = Date.parse(
    runCompletedAt(thread) ?? thread.latestRunStartedAt ?? thread.latestRunRequestedAt ?? "",
  );
  const visitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(failedAt) || Number.isNaN(visitedAt)) return true;
  return failedAt > visitedAt;
}

// Follows resolveSidebarRowStatus, resolveSidebarThreadStatus and hasUnseenCompletion in
// apps/web/src/components/Sidebar.logic.ts.
export function sidebarStatus(
  thread: IWireThreadShell,
  subagent: ISubagentRequest | undefined,
): ISidebarStatus {
  const request = requestOf(thread);
  if (request === "approval" || subagent === "approval") return "approval";
  if (request === "user_input" || subagent === "user_input") return "input";
  const runtime = runtimeStatus(thread);
  if (runtime === "idle")
    return backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks ?? []) ? "waiting" : null;
  if (runtime === "preparing") return "preparing";
  const status = runtime === null ? null : runStatus(runtime);
  if (status === "running" && thread.blockedOnThreadWait === true) return "waiting";
  if (status === "running" || status === "waiting") return "working";
  if (status === "failed") {
    // Stock keeps a usage limit on the row after a visit; only a plain failure settles.
    const settles =
      thread.lastErrorClass !== "usage_limit" &&
      thread.latestRunId !== null &&
      thread.status === "failed";
    return settles && !hasUnseenRunFailure(thread) ? null : "failed";
  }
  if (thread.status === "interrupted" || thread.status === "cancelled") return null;
  const completed = thread.latestRunId === null ? null : runCompletedAt(thread);
  const visited = thread.lastVisitedAt;
  if (completed == null || Number.isNaN(Date.parse(completed)) || !visited) return null;
  return Number.isNaN(Date.parse(visited)) || Date.parse(completed) > Date.parse(visited)
    ? "done"
    : null;
}

export interface ISidebarSections {
  Pinned: IWireThreadShell[];
  Active: IWireThreadShell[];
  /** Filled only while the Working section is on. */
  Working: IWireThreadShell[];
  Snoozed: IWireThreadShell[];
  Settled: IWireThreadShell[];
}

const ACTIVE_RUN = new Set(["preparing", "queued", "starting", "running", "waiting"]);

// Follows isThreadWorking in packages/client-runtime/src/state/threadInbox.ts.
export function threadWorking(
  thread: IWireThreadShell,
  subagent: ISubagentRequest | undefined,
): boolean {
  const request = thread.pendingRuntimeRequest;
  if (request !== null && request.kind !== "auth_refresh") return false;
  if (subagent !== undefined) return false;
  const runtime = runtimeStatus(thread);
  if (runtime === null || (!ACTIVE_RUN.has(runtime) && runtime !== "idle")) return false;
  const runSettled =
    thread.latestRunId !== null &&
    !ACTIVE_RUN.has(thread.status) &&
    thread.activeRunId !== thread.latestRunId;
  return !(thread.interactionMode === "plan" && thread.hasActionableProposedPlan && runSettled);
}

// Follows the `actionable`, `excluded` and `placement` checks of createInboxReturnTracker in
// packages/client-runtime/src/state/threadInbox.ts.
function inboxFacts(
  thread: IWireThreadShell,
  subagent: ISubagentRequest | undefined,
  now: number,
): IInboxFacts {
  const request = thread.pendingRuntimeRequest;
  const ended = runCompletedAt(thread);
  const endedAt = ended === null ? NaN : Date.parse(ended);
  return {
    Id: thread.id,
    Working: threadWorking(thread, subagent),
    Actionable:
      (request !== null && request.kind !== "auth_refresh") ||
      subagent !== undefined ||
      (thread.pendingGuestMessageCount ?? 0) > 0 ||
      (thread.interactionMode === "plan" && thread.hasActionableProposedPlan) ||
      thread.lastError != null ||
      (thread.latestRunId !== null && thread.status === "failed"),
    Excluded:
      thread.archivedAt != null ||
      thread.deletedAt != null ||
      thread.pinnedAt != null ||
      thread.settledOverride === "settled" ||
      isSnoozed(thread, now, subagent),
    Placement: JSON.stringify([
      thread.archivedAt,
      thread.deletedAt,
      thread.pinnedAt,
      thread.settledOverride,
      thread.settledAt,
      thread.snoozedAt,
      thread.snoozedUntil,
      thread.activeOrderKey,
    ]),
    EndedAt: Number.isFinite(endedAt) ? endedAt : null,
  };
}

/** Stock's Working section setting, which project folders turn off as its boring sidebar does. */
export const workingShelfShown = (selection: ISelection | undefined): boolean =>
  selection !== undefined &&
  !selection.Preferences.GroupByProject &&
  (selection.ClientSettings?.sidebarWorkingShelfEnabled ?? true);

const inboxOf = (draft: IShell) =>
  transient(draft, "Shell/Inbox", { Entries: {}, Returns: {} } as IInbox);

function* followInbox(draft: IShell): IActionGenerator {
  const selection = yield* getData(draft, "Selection");
  const inbox = yield* inboxOf(draft);
  if (!workingShelfShown(selection)) {
    if (Object.keys(inbox.Entries).length > 0) {
      inbox.Entries = {};
      inbox.Returns = {};
      yield* stopTimer(draft, "Shell/InboxGrace");
    }
    return;
  }
  const now = yield* clockNowEffect();
  const subagents = yield* subagentRequests(draft);
  observeInbox(
    inbox,
    Object.values(draft.Threads).map((thread) => inboxFacts(thread, subagents[thread.id], now)),
    now,
  );
  yield* scheduleInbox(draft, inbox, now);
}

function* scheduleInbox(draft: IShell, inbox: IInbox, now: number): IActionGenerator {
  yield* stopTimer(draft, "Shell/InboxGrace");
  const deadline = inboxDeadline(inbox);
  if (deadline !== null)
    yield* startTimer(draft, "Shell/InboxGrace", ShellReceiver, Math.max(0, deadline - now));
}

/** Which threads the Working section holds, with the exit grace stock gives them. */
export function* shellInbox(draft: IShell): ISelectorGenerator<IInbox> {
  return yield* inboxOf(draft);
}

function failureEdgeAt(thread: IWireThreadShell): string | null | undefined {
  if (runtimeStatus(thread) !== "failed") return undefined;
  return thread.latestRunId !== null && thread.status === "failed"
    ? runCompletedAt(thread)
    : thread.updatedAt;
}

function blocksSnooze(thread: IWireThreadShell, subagent: ISubagentRequest | undefined): boolean {
  const request = thread.pendingRuntimeRequest;
  return (
    (request !== null && request.kind !== "user_input") ||
    subagent !== undefined ||
    (thread.pendingGuestMessageCount ?? 0) > 0
  );
}

// A question already open when the thread was snoozed waits for the snooze to end.
function raisedHandWhileSnoozed(
  thread: IWireThreadShell,
  subagent: ISubagentRequest | undefined,
): boolean {
  if (blocksSnooze(thread, subagent)) return true;
  const request = thread.pendingRuntimeRequest;
  if (request?.kind !== "user_input") return false;
  const snoozedAt = thread.snoozedAt;
  return snoozedAt == null || !(Date.parse(request.createdAt) <= Date.parse(snoozedAt));
}

// Follows canSnooze in packages/client-runtime/src/state/threadSettled.ts.
export function canSnooze(
  thread: IWireThreadShell,
  subagent: ISubagentRequest | undefined,
  now: number,
): boolean {
  if (blocksSnooze(thread, subagent)) return false;
  const status = runtimeStatus(thread);
  return !hasQueuedTurnStart(
    {
      latestUserMessageAt: thread.latestUserMessageAt,
      runtime: status === null ? null : { status },
      latestRun:
        thread.latestRunId === null
          ? null
          : {
              requestedAt: thread.latestRunRequestedAt ?? null,
              startedAt: thread.latestRunStartedAt ?? null,
              completedAt: runCompletedAt(thread),
            },
    },
    { now: DateTime.formatIso(DateTime.makeUnsafe(now)) },
  );
}

// Follows effectiveSnoozed and threadRaisedHandWhileSnoozed in
// packages/client-runtime/src/state/threadSettled.ts.
export function isSnoozed(
  thread: IWireThreadShell,
  now: number,
  subagent: ISubagentRequest | undefined,
): boolean {
  if (thread.snoozedUntil == null) return false;
  const wakeAt = Date.parse(thread.snoozedUntil);
  if (Number.isNaN(wakeAt) || wakeAt <= now) return false;
  if (raisedHandWhileSnoozed(thread, subagent)) return false;
  const failedAt = failureEdgeAt(thread);
  if (failedAt === undefined) return true;
  const snoozedAt = thread.snoozedAt;
  return snoozedAt != null && (failedAt == null || !(Date.parse(failedAt) > Date.parse(snoozedAt)));
}

const newestFirst = (left: string | null | undefined, right: string | null | undefined): number =>
  Date.parse(right ?? "") - Date.parse(left ?? "");

export interface IProjectFolder {
  ProjectId: string;
  Project: IWireProject | undefined;
  Threads: IWireThreadShell[];
}

/** Leaves out threads of projects hidden on this client, except the selected one. */
export function unhiddenThreads(
  threads: IWireThreadShell[],
  hidden: ReadonlySet<string>,
  selectedId: string | null,
): IWireThreadShell[] {
  if (hidden.size === 0) return threads;
  return threads.filter((thread) => !hidden.has(thread.projectId) || thread.id === selectedId);
}

/** Folds `threads` into a folder per project, keeping their order within each folder. */
export function projectFolders(
  threads: IWireThreadShell[],
  projects: Record<string, IWireProject>,
  hidden: ReadonlySet<string> = new Set(),
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
    if (project.archivedAt == null && !hidden.has(project.id)) folderOf(project.id);
  }
  for (const thread of threads) folderOf(thread.projectId).Threads.push(thread);
  return [...folders.values()];
}

// `threads` keeps its order within Active, so the inbox stays on the server's order key.
export function sidebarSections(
  threads: IWireThreadShell[],
  now: number,
  subagents: Record<string, ISubagentRequest>,
): ISidebarSections {
  const sections: ISidebarSections = {
    Pinned: [],
    Active: [],
    Working: [],
    Snoozed: [],
    Settled: [],
  };
  for (const thread of threads) {
    if (isSnoozed(thread, now, subagents[thread.id])) sections.Snoozed.push(thread);
    else if (thread.settledOverride === "settled") sections.Settled.push(thread);
    else if (thread.pinnedAt != null) sections.Pinned.push(thread);
    else sections.Active.push(thread);
  }
  sections.Pinned = sortPinnedThreadsByOrderKey(sections.Pinned);
  sections.Snoozed.sort(
    (left, right) => Date.parse(left.snoozedUntil ?? "") - Date.parse(right.snoozedUntil ?? ""),
  );
  sections.Settled.sort((left, right) => newestFirst(left.settledAt, right.settledAt));
  return sections;
}

export function needsVisit(thread: IWireThreadShell): boolean {
  const completed = thread.latestRunCompletedAt;
  if (completed == null) return false;
  const visited = thread.lastVisitedAt;
  return visited == null || Date.parse(completed) > Date.parse(visited);
}

export function activityAt(thread: IWireThreadShell): string | null {
  return resolveThreadActivityTimestamp({
    latestUserMessageAt: thread.latestUserMessageAt ?? null,
    updatedAt: thread.updatedAt,
    latestRun:
      thread.latestRunId === null
        ? null
        : {
            requestedAt: thread.latestRunRequestedAt ?? null,
            startedAt: thread.latestRunStartedAt ?? null,
            completedAt: runCompletedAt(thread),
          },
  } as never);
}

// Follows resolveThreadWorkingStartedAt in packages/client-runtime/src/state/models.ts.
export function workingStartedAt(thread: IWireThreadShell): string | null {
  const valid = (value: string | null | undefined) =>
    value != null && Number.isFinite(Date.parse(value)) ? value : null;
  if (runtimeStatus(thread) === null) return null;
  if (thread.activityRunStartedAt !== undefined) return valid(thread.activityRunStartedAt);
  if (thread.latestRunId === null || thread.latestRunId !== thread.activeRunId) return null;
  if (runCompletedAt(thread) !== null) return null;
  return valid(thread.latestRunStartedAt) ?? valid(thread.latestRunRequestedAt);
}

export default createEntityFeature<IShell>("Shell")(
  {},
  { sidebarThreads, shellSynchronized, subagentRequests, sidebarRowThreadId },
);
