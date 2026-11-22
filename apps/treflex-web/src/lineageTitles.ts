import {
  getData,
  type IOpenGenerator,
  type ISelectorGenerator,
  latest,
  open,
  select,
} from "treflex";

import { threadTitlesEffect } from "./Infrastructure/commandEffects";
import { serverError } from "./Infrastructure/serverError";
import { threadLineage } from "./lineage";
import type { IOpenThread } from "./OpenThread";

export interface ILineageTitles {
  /** The related thread ids, joined, that `Titles` was looked up for. */
  Key: string;
  /** Null until the lookup for `Key` settles, and after it fails. */
  Titles: Record<string, string> | null;
}

/** Related threads the shell doesn't carry, whose titles the server has to look up. */
export function* lineageLookup(draft: IOpenThread): ISelectorGenerator<string[]> {
  const replica = yield* getData(draft, "Replica");
  if (draft.Thread === null || replica === undefined) return [];
  return threadLineage({
    thread: draft.Thread,
    subagents: Object.values(draft.Subagents),
    contextTransfers: Object.values(draft.ContextTransfers),
    shells: Object.values(replica.Shell.Threads),
    titles: null,
  }).Lookup;
}

/** The server's titles for related threads the shell doesn't carry, as stock's `threadTitles` query finds them. */
export function* lookUpLineageTitles(draft: IOpenThread): IOpenGenerator {
  const threadIds = yield* select(lineageLookup);
  const key = threadIds.join(",");
  if (key === draft.LineageTitles.Key) return;
  draft.LineageTitles = { Key: key, Titles: null };
  if (threadIds.length === 0) return;
  let titles: Record<string, string> | null = null;
  try {
    titles = (yield* open(
      threadTitlesEffect({ EnvironmentId: draft.EnvironmentId, ThreadIds: threadIds }),
    )).Titles;
  } catch (error) {
    serverError(error);
  }
  draft.LineageTitles.Titles = titles;
}
latest(lookUpLineageTitles);

/**
 * The looked-up titles when the lookup covered every one of `threadIds`, else null: `threadLineage`
 * hides a looked-up thread that has no title, as deleted.
 */
export function lineageTitles(thread: IOpenThread, threadIds: readonly string[]) {
  const covered = new Set(thread.LineageTitles.Key.split(","));
  return threadIds.every((id) => covered.has(id)) ? thread.LineageTitles.Titles : null;
}
