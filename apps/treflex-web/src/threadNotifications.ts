import type { ClientSettings } from "@t3tools/contracts/settings";
import { isListedThreadLineage } from "@t3tools/contracts";
import { monitorHoldsWakeCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

import type { IWireThreadShell } from "./Infrastructure/wire";
import { isSnoozed, type ISubagentRequest, runCompletedAt, runtimeStatus } from "./Shell";

export type INotificationMode = ClientSettings["notificationMode"];
export type INotificationKind = "input" | "completion";

const MODES = new Set<unknown>(["off", "notifications", "sound", "notifications-and-sound"]);

export const isNotificationMode = (value: unknown): value is INotificationMode => MODES.has(value);

// Follows apps/web/src/threadNotifications.ts.
export const hasNotificationSound = (mode: INotificationMode) =>
  mode === "sound" || mode === "notifications-and-sound";

export const hasDesktopNotifications = (mode: INotificationMode) =>
  mode === "notifications" || mode === "notifications-and-sound";

const TAG_HASH_OFFSET_BASIS = 0xcbf29ce484222325n;
const TAG_HASH_PRIME = 0x100000001b3n;
const TAG_HASH_MASK = 0xffffffffffffffffn;

/** Windows drops toast notifications with the 73-character environment/thread tag. */
export function threadNotificationTag(environmentId: string, threadId: string): string {
  const key = `${environmentId}:${threadId}`;
  let hash = TAG_HASH_OFFSET_BASIS;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= BigInt(key.charCodeAt(index));
    hash = (hash * TAG_HASH_PRIME) & TAG_HASH_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

type INotifyStatus =
  | "approval"
  | "input"
  | "request"
  | "preparing"
  | "working"
  | "waiting"
  | "failed"
  | "limited"
  | "ready";

const WORKING = new Set(["queued", "starting", "running", "waiting"]);

const latestRunStatus = (thread: IWireThreadShell) =>
  thread.latestRunId === null ? null : thread.status === "idle" ? "completed" : thread.status;

const requestKind = (thread: IWireThreadShell) => {
  const kind = thread.pendingRuntimeRequest?.kind;
  if (kind === undefined || kind === "auth_refresh") return null;
  return kind === "user_input" ? "user_input" : "approval";
};

// Follows resolveSidebarThreadStatus in apps/web/src/components/Sidebar.logic.ts, with the failed-run
// check ThreadNotificationCoordinator.tsx adds.
function notifyStatus(thread: IWireThreadShell, subagent: ISubagentRequest | undefined) {
  const request = requestKind(thread);
  const status = ((): INotifyStatus => {
    if (request === "approval" || subagent === "approval") return "approval";
    if (request === "user_input" || subagent === "user_input") return "input";
    if ((thread.pendingGuestMessageCount ?? 0) > 0) return "request";
    const runtime = runtimeStatus(thread);
    if (runtime === "running" && thread.blockedOnThreadWait === true) return "waiting";
    if (runtime === "preparing") return "preparing";
    if (runtime !== null && WORKING.has(runtime)) return "working";
    if (runtime === "idle") return "waiting";
    if (runtime === "failed") return thread.lastErrorClass === "usage_limit" ? "limited" : "failed";
    return "ready";
  })();
  return status === "ready" && latestRunStatus(thread) === "failed" ? "failed" : status;
}

// Follows resolveBackgroundThreadRequest in apps/web/src/components/backgroundThreadAnnouncement.ts:
// a subagent's request has no id here.
function requestId(thread: IWireThreadShell, status: INotifyStatus): string | null {
  const own = thread.pendingRuntimeRequest?.id ?? null;
  const kind = requestKind(thread);
  if (status === "approval") return kind === "approval" ? own : null;
  if (status === "input") return kind === "user_input" ? own : null;
  return null;
}

interface INotifyObservation {
  /** Status and request key, or status and run without a request, while the thread needs attention. */
  Attention: string | null;
  RequestId: string | null;
  /** Idle with its latest run completed. */
  Settled: boolean;
  CompletedAt: number | null;
  /** The latest run answers a background-work progress wake, like a Monitor line. */
  BackgroundWake: boolean;
}

const sameObservation = (left: INotifyObservation, right: INotifyObservation) =>
  left.Attention === right.Attention &&
  left.RequestId === right.RequestId &&
  left.Settled === right.Settled &&
  left.CompletedAt === right.CompletedAt &&
  left.BackgroundWake === right.BackgroundWake;

const ATTENTION = new Set<INotifyStatus>(["input", "request", "approval", "failed", "limited"]);

function observation(
  thread: IWireThreadShell,
  subagent: ISubagentRequest | undefined,
): INotifyObservation {
  const status = notifyStatus(thread, subagent);
  const needsAttention = ATTENTION.has(status);
  const id = needsAttention ? requestId(thread, status) : null;
  // Queued messages become the latest run while a request stays pending, so a request with an id
  // is keyed by that id alone and announces once.
  const attention = !needsAttention
    ? null
    : id !== null
      ? `${status}:${id}`
      : `${thread.latestRunId ?? ""}:${status}`;
  const settled =
    status === "ready" &&
    latestRunStatus(thread) === "completed" &&
    !monitorHoldsWakeCompletion(thread as never);
  const completedAt = Date.parse(runCompletedAt(thread) ?? "");
  return {
    Attention: attention,
    RequestId: id,
    Settled: settled,
    CompletedAt: settled && Number.isFinite(completedAt) ? completedAt : null,
    BackgroundWake: thread.latestRunBackgroundWake === true,
  };
}

/** Matches the push relay's completion confirmation: a final wake can start right after a progress wake. */
export const RELEASED_COMPLETION_GRACE_MS = 5_000;

/** What the gate remembers per thread id, as plain data. */
export interface INotifyGate {
  Previous: Record<string, INotifyObservation>;
  /** The newest completion already notified, or deliberately skipped. */
  Handled: Record<string, number>;
  /** Wake completions waiting out the grace; `Due` is null while paused. */
  Releases: Record<string, { At: number; Due: number | null }>;
  /** Attention keys with a request id seen since the thread last stopped needing attention. */
  Attended: Record<string, string[]>;
}

export const emptyNotifyGate = (): INotifyGate => ({
  Previous: {},
  Handled: {},
  Releases: {},
  Attended: {},
});

export interface IThreadNotification {
  ThreadId: string;
  Kind: INotificationKind;
}

// Follows isSnoozedForNotification in apps/web/src/components/ThreadNotificationCoordinator.logic.ts.
function snoozedForNotification(
  thread: IWireThreadShell,
  subagent: ISubagentRequest | undefined,
  completedAt: number | null,
  now: number,
): boolean {
  if (isSnoozed(thread, now, subagent)) return true;
  if (completedAt === null) return false;
  if (thread.snoozedAt != null && completedAt < Date.parse(thread.snoozedAt)) return false;
  return isSnoozed(thread, completedAt, subagent);
}

// Follows createThreadNotificationGate in ThreadNotificationCoordinator.logic.ts.
function observe(
  gate: INotifyGate,
  id: string,
  prior: INotifyObservation | undefined,
  next: INotifyObservation,
  options: { Archived: boolean; Quiet: boolean; Snoozed: boolean },
  now: number,
): INotificationKind | null {
  // The grace survives updates that keep the wake's completion; anything else cancels it.
  const pending = gate.Releases[id];
  const silenced = options.Archived || options.Quiet || options.Snoozed;
  if (pending?.At === next.CompletedAt && !silenced) {
    if (pending.Due === null) pending.Due = now + RELEASED_COMPLETION_GRACE_MS;
    return null;
  }
  delete gate.Releases[id];
  // The first sighting, archived or snoozed threads, and stopped or silent runs never notify completion.
  if (prior === undefined || silenced) {
    const at = next.CompletedAt;
    if (at !== null && at > (gate.Handled[id] ?? -Infinity)) gate.Handled[id] = at;
  }
  const fresh = attend(gate, id, prior, next);
  if (prior === undefined || options.Archived) return null;
  if (fresh) return "input";
  const at = next.CompletedAt;
  if (!next.Settled || at === null || at <= (gate.Handled[id] ?? -Infinity)) return null;
  if (next.BackgroundWake) {
    gate.Releases[id] = { At: at, Due: now + RELEASED_COMPLETION_GRACE_MS };
    return null;
  }
  gate.Handled[id] = at;
  return "completion";
}

function attend(
  gate: INotifyGate,
  id: string,
  prior: INotifyObservation | undefined,
  next: INotifyObservation,
): boolean {
  if (next.Attention === null) {
    delete gate.Attended[id];
    return false;
  }
  if (next.RequestId === null) return next.Attention !== prior?.Attention;
  const seen = gate.Attended[id];
  if (seen?.includes(next.Attention)) return false;
  if (seen === undefined) gate.Attended[id] = [next.Attention];
  else seen.push(next.Attention);
  return true;
}

/**
 * Turns the shell's thread rows into the notifications their changes call for. A thread shown
 * under its parent, such as a subagent, has no row of its own, so its parent speaks for it.
 */
export function observeNotifications(
  gate: INotifyGate,
  threads: readonly IWireThreadShell[],
  subagents: Readonly<Record<string, ISubagentRequest>>,
  now: number,
): IThreadNotification[] {
  const notes: IThreadNotification[] = [];
  const present = new Set<string>();
  for (const thread of threads) {
    if (!isListedThreadLineage(thread.lineage as never)) continue;
    present.add(thread.id);
    const subagent = subagents[thread.id];
    const next = observation(thread, subagent);
    const prior = gate.Previous[thread.id];
    if (prior === undefined || !sameObservation(prior, next)) gate.Previous[thread.id] = next;
    const kind = observe(
      gate,
      thread.id,
      prior,
      next,
      {
        Archived: thread.archivedAt != null,
        Quiet: thread.latestRunStopRequested === true,
        Snoozed: snoozedForNotification(thread, subagent, next.CompletedAt, now),
      },
      now,
    );
    if (kind !== null) notes.push({ ThreadId: thread.id, Kind: kind });
  }
  for (const record of [gate.Previous, gate.Handled, gate.Releases, gate.Attended]) {
    for (const id of Object.keys(record)) if (!present.has(id)) delete record[id];
  }
  return notes;
}

/** The wake completions whose grace ran out by `now`. */
export function releaseNotifications(gate: INotifyGate, now: number): IThreadNotification[] {
  const notes: IThreadNotification[] = [];
  for (const [id, release] of Object.entries(gate.Releases)) {
    if (release.Due === null || release.Due > now) continue;
    delete gate.Releases[id];
    gate.Handled[id] = release.At;
    notes.push({ ThreadId: id, Kind: "completion" });
  }
  return notes;
}

/** Holds the graces while the shell is stale; the next observation restarts or drops them. */
export function pauseNotifications(gate: INotifyGate): void {
  for (const release of Object.values(gate.Releases)) release.Due = null;
}

export function nextRelease(gate: INotifyGate): number | null {
  let next: number | null = null;
  for (const release of Object.values(gate.Releases)) {
    if (release.Due !== null && (next === null || release.Due < next)) next = release.Due;
  }
  return next;
}

// Follows the titles in `present` in apps/web/src/components/ThreadNotificationCoordinator.tsx.
export function notificationTitle(
  kind: INotificationKind,
  thread: IWireThreadShell,
  subagent: ISubagentRequest | undefined,
): string {
  if (kind === "completion") return "Thread completed";
  switch (notifyStatus(thread, subagent)) {
    case "approval":
      return "Approval needed";
    case "limited":
      return "Usage limit reached";
    case "failed":
      return "Thread failed";
    case "request":
      return "Guest request";
    default:
      return "Input needed";
  }
}
