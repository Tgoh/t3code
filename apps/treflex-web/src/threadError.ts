import type { OrchestrationV2ProviderFailureClass } from "@t3tools/contracts";

import type { IWireTurnItem } from "./Infrastructure/wire";
import type { IOpenThread, IWireRun } from "./OpenThread";

type IErrorItem = Extract<IWireTurnItem, { type: "error" }>;
type IFailure = IErrorItem["failure"];
type ITurnItems = IOpenThread["TurnItems"];

export interface IThreadError {
  Error: string;
  Class: OrchestrationV2ProviderFailureClass | null;
  Code: string | null;
  /** The record the error came from, with its change time so a repeated failure differs. */
  Source: string | null;
}

const millis = (at: string) => Date.parse(at);

function latestRootFailureItem(run: IWireRun | null, items: ITurnItems): IErrorItem | null {
  if (run?.status !== "failed") return null;
  let latest: IErrorItem | null = null;
  for (const item of Object.values(items)) {
    if (
      item.type !== "error" ||
      item.status !== "failed" ||
      item.runId !== run.id ||
      item.nodeId !== run.rootNodeId
    )
      continue;
    const at = millis(item.updatedAt);
    const latestAt = latest === null ? 0 : millis(latest.updatedAt);
    if (
      latest === null ||
      at > latestAt ||
      (at === latestAt &&
        (item.ordinal > latest.ordinal || (item.ordinal === latest.ordinal && item.id > latest.id)))
    ) {
      latest = item;
    }
  }
  return latest;
}

function summary(failure: IFailure | null, sessionError: string | null) {
  const current = sessionError !== null && sessionError !== failure?.message ? null : failure;
  return {
    Error: sessionError ?? failure?.message ?? null,
    Class: current?.class ?? null,
    Code: current?.code ?? null,
  };
}

function runRanAfter(run: IWireRun, other: IWireRun): boolean {
  const end = (candidate: IWireRun) =>
    candidate.completedAt ? millis(candidate.completedAt) : Number.POSITIVE_INFINITY;
  return end(run) === end(other) ? run.ordinal > other.ordinal : end(run) > end(other);
}

function latestExecutedRun(runs: ReadonlyArray<IWireRun>): IWireRun | null {
  let latest: IWireRun | null = null;
  for (const run of runs) {
    if (run.status === "queued") continue;
    if (run.status === "cancelled" && run.startedAt === null) continue;
    if (latest === null || runRanAfter(run, latest)) latest = run;
  }
  return latest;
}

function usageLimitRunPresentedAsLatest(
  runs: ReadonlyArray<IWireRun>,
  items: ITurnItems,
  sessionError: string | null,
): IWireRun | null {
  const executed = latestExecutedRun(runs);
  if (executed?.status !== "failed") return null;
  const failure = latestRootFailureItem(executed, items)?.failure ?? null;
  if (summary(failure, sessionError).Class !== "usage_limit") return null;
  return runs.some((run) => run.ordinal > executed.ordinal) ? executed : null;
}

// Steering a queued message cancels its run before it starts and hands the message to the
// earlier run, which outlives the cancellation; that earlier run then presents as latest.
function outlivedBeforeStart(run: IWireRun, runs: ReadonlyArray<IWireRun>): boolean {
  if (run.status !== "cancelled" || run.startedAt !== null || !run.completedAt) return false;
  const cancelledAt = millis(run.completedAt);
  return runs.some(
    (earlier) =>
      earlier.ordinal < run.ordinal &&
      earlier.status !== "queued" &&
      (!earlier.completedAt || millis(earlier.completedAt) >= cancelledAt),
  );
}

function latestUnheldRun(runs: ReadonlyArray<IWireRun>): IWireRun | null {
  let latest: IWireRun | null = null;
  for (const run of runs) {
    if (run.status === "queued" && run.queueHeld === true) continue;
    if (outlivedBeforeStart(run, runs)) continue;
    if (latest === null || run.ordinal > latest.ordinal) latest = run;
  }
  return latest;
}

const itemSource = (item: IErrorItem) => `${item.id}@${item.completedAt ?? ""}`;

function errorSource(
  failureItem: IErrorItem | null,
  sessionError: string | null,
  runs: ReadonlyArray<IWireRun>,
  items: ITurnItems,
): string | null {
  if (
    failureItem !== null &&
    (sessionError === null || sessionError === failureItem.failure.message)
  )
    return itemSource(failureItem);
  if (sessionError === null) return null;
  let ended: IWireRun | null = null;
  for (const run of runs) {
    if (run.status !== "failed" && run.status !== "completed") continue;
    if (ended === null || run.ordinal > ended.ordinal) ended = run;
  }
  if (ended === null) return null;
  const endedFailure =
    failureItem?.runId === ended.id ? failureItem : latestRootFailureItem(ended, items);
  return endedFailure?.failure.message === sessionError
    ? itemSource(endedFailure)
    : `${ended.id}@${ended.completedAt ?? ""}`;
}

/**
 * The open thread's runtime error, as the stock thread view shows it.
 * Follows `deriveThreadStructureRuntime` in packages/client-runtime/src/state/threadExecution.ts
 * and packages/shared/src/orchestrationV2ThreadError.ts, over wire timestamps.
 */
export function threadRuntimeError(thread: IOpenThread): IThreadError | null {
  const runs = Object.values(thread.Runs);
  const items = thread.TurnItems;
  const sessionError =
    Object.values(thread.ProviderSessions).findLast(
      (session) => session.providerInstanceId === thread.Thread?.providerInstanceId,
    )?.lastError ?? null;
  const latest = usageLimitRunPresentedAsLatest(runs, items, sessionError) ?? latestUnheldRun(runs);
  if (latest === null) return null;
  const failureItem = latestRootFailureItem(latest, items);
  const { Error: error, Class, Code } = summary(failureItem?.failure ?? null, sessionError);
  if (error === null) return null;
  return { Error: error, Class, Code, Source: errorSource(failureItem, sessionError, runs, items) };
}

// Follows getThreadErrorBannerKey in apps/web/src/components/chat/ThreadErrorBanner.tsx; the
// session it sits on stands for stock's thread key.
export function threadErrorKey(error: IThreadError): string {
  return `${error.Source ?? ""}\u0000${error.Error}`;
}

export function shownThreadError(
  error: IThreadError | null,
  dismissed: ReadonlyArray<string>,
): IThreadError | null {
  return error === null || dismissed.includes(threadErrorKey(error)) ? null : error;
}

// Follows getThreadErrorBannerMessage in apps/web/src/components/chat/ThreadErrorBanner.tsx.
export function threadErrorBannerMessage(error: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(error);
  } catch {
    return error;
  }
  if (typeof payload !== "object" || payload === null || !("error" in payload)) return error;
  const nested = payload.error;
  if (typeof nested !== "object" || nested === null || !("message" in nested)) return error;
  return typeof nested.message === "string" && nested.message.trim().length > 0
    ? nested.message
    : error;
}
