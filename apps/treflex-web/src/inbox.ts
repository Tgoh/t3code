// Follows createInboxReturnTracker in packages/client-runtime/src/state/threadInbox.ts, held as
// plain data so it can live in state and expire on a timer.

/** How long a thread that stopped working keeps reading as working. */
const WORKING_EXIT_GRACE_MS = 2_000;

/** A run that ended this long ago has no continuation about to start, so its thread gets no grace. */
const STALE_EXIT_MS = 60_000;

export interface IInboxEntry {
  Working: boolean;
  Deadline: number | null;
  /** The sections that would move the thread, while it works or is held. */
  Placement: string | null;
}

export interface IInbox {
  Entries: Record<string, IInboxEntry>;
  /** When each thread last stopped reading as working, by id. */
  Returns: Record<string, number>;
}

/** One thread as the tracker sees it. */
export interface IInboxFacts {
  Id: string;
  /** `isThreadWorking`. */
  Working: boolean;
  /** It asks for the user: a request, a failure, a guest message or a plan to act on. */
  Actionable: boolean;
  /** Archived, deleted, pinned, settled or snoozed. */
  Excluded: boolean;
  Placement: string;
  /** When its latest run ended, if it did. */
  EndedAt: number | null;
}

export function observeInbox(inbox: IInbox, threads: readonly IInboxFacts[], now: number): void {
  const present = new Set<string>();
  for (const thread of threads) {
    present.add(thread.Id);
    const previous = inbox.Entries[thread.Id];
    const placement = thread.Working || previous?.Working ? thread.Placement : null;
    const moved = previous !== undefined && previous.Placement !== placement;
    const endedLongAgo = thread.EndedAt !== null && thread.EndedAt <= now - STALE_EXIT_MS;
    const deadline =
      !thread.Working &&
      previous?.Working === true &&
      !thread.Actionable &&
      !moved &&
      !thread.Excluded &&
      !endedLongAgo
        ? (previous.Deadline ?? now + WORKING_EXIT_GRACE_MS)
        : null;
    const working = thread.Working || (deadline !== null && deadline > now);
    if (previous?.Working === true && !working) inbox.Returns[thread.Id] = now;
    if (
      previous === undefined ||
      working !== previous.Working ||
      placement !== previous.Placement
    ) {
      inbox.Entries[thread.Id] = {
        Working: working,
        Deadline: working ? deadline : null,
        Placement: placement,
      };
    } else if (previous.Deadline !== (working ? deadline : null)) {
      previous.Deadline = working ? deadline : null;
    }
  }
  for (const id of Object.keys(inbox.Entries)) {
    if (present.has(id)) continue;
    delete inbox.Entries[id];
    delete inbox.Returns[id];
  }
}

export function expireInbox(inbox: IInbox, now: number): void {
  for (const [id, entry] of Object.entries(inbox.Entries)) {
    if (entry.Deadline === null || entry.Deadline > now) continue;
    entry.Working = false;
    entry.Deadline = null;
    inbox.Returns[id] = now;
  }
}

export function inboxDeadline(inbox: IInbox): number | null {
  let next: number | null = null;
  for (const entry of Object.values(inbox.Entries)) {
    if (entry.Deadline !== null && (next === null || entry.Deadline < next)) next = entry.Deadline;
  }
  return next;
}

/** A thread the tracker hasn't seen yet reads by its own state. */
export const isWorkingIn = (inbox: IInbox, id: string, working: boolean): boolean =>
  inbox.Entries[id]?.Working ?? working;
