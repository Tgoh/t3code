import type { IToastRequest } from "./Infrastructure/toasts";

type ITitleStatus = "renamed" | "unchanged" | "failed";

/** The shell row's title regeneration fields. */
export interface ITitleRow {
  titleRegeneration?: { requestId: string } | null | undefined;
  lastTitleRegeneration?:
    | { requestId: string; status: ITitleStatus; message?: string | undefined }
    | null
    | undefined;
}

export type ITitleOutcome = { Status: ITitleStatus; Message?: string } | null;

export interface ITitleRequest {
  ThreadId: string;
  RequestId: string;
  /** Whether the row has shown this request running. */
  Armed: boolean;
  Done: boolean;
  Outcome: ITitleOutcome;
}

/** The threads one Regenerate asked for, answered by one toast. */
export interface ITitleBatch {
  Requests: ITitleRequest[];
}

export const titleRequest = (threadId: string, requestId: string): ITitleRequest => ({
  ThreadId: threadId,
  RequestId: requestId,
  Armed: false,
  Done: false,
  Outcome: null,
});

// Follows settledOutcome in packages/client-runtime/src/state/threadTitleRegeneration.ts.
function settle(request: ITitleRequest, row: ITitleRow | undefined): void {
  const last = row?.lastTitleRegeneration;
  if (row !== undefined && last?.requestId !== request.RequestId) {
    const running = row.titleRegeneration?.requestId;
    if (running === request.RequestId) request.Armed = true;
    // A newer request replaces this one on the server, which never reports it.
    else if (request.Armed || running != null) request.Done = true;
    return;
  }
  request.Done = true;
  if (last != null)
    request.Outcome =
      last.message === undefined
        ? { Status: last.status }
        : { Status: last.status, Message: last.message };
}

/** Reads each pending request's outcome off the rows, and removes and returns finished batches. */
export function settleTitleBatches(
  batches: ITitleBatch[],
  rows: Record<string, ITitleRow | undefined>,
): ITitleOutcome[][] {
  const finished: ITitleOutcome[][] = [];
  for (let index = batches.length - 1; index >= 0; index--) {
    const held = batches[index]!;
    for (const request of held.Requests) {
      if (!request.Done) settle(request, rows[request.ThreadId]);
    }
    if (held.Requests.every((request) => request.Done)) {
      batches.splice(index, 1);
      finished.unshift(held.Requests.map((request) => request.Outcome));
    }
  }
  return finished;
}

// Follows titleRegenerationToast in apps/web/src/components/threadTitleRegenerationToast.ts.
export function titleRegenerationToast(outcomes: readonly ITitleOutcome[]): IToastRequest | null {
  const failures = outcomes.flatMap((outcome) =>
    outcome?.Status === "failed" ? [outcome.Message ?? "Title generation failed."] : [],
  );
  const total = outcomes.length;
  if (failures.length > 0)
    return {
      Kind: "error",
      Title:
        total === 1
          ? "Failed to regenerate thread title"
          : `Failed to regenerate ${failures.length} of ${total} thread titles`,
      Description: failures[0]!,
    };
  const kept = outcomes.filter((outcome) => outcome?.Status === "unchanged").length;
  if (kept === 0) return null;
  if (total === 1)
    return {
      Kind: "info",
      Title: "Title kept",
      Description: "The current title already fits this thread.",
    };
  return kept === total
    ? {
        Kind: "info",
        Title: "Titles kept",
        Description: "The current titles already fit these threads.",
      }
    : {
        Kind: "info",
        Title: `Kept ${kept} of ${total} titles`,
        Description: "Those titles already fit their threads.",
      };
}
