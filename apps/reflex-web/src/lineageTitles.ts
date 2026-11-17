import { type IActionGenerator, type IEntity, latest } from "treflex";
import { useComponentState } from "treflex-solid";
import { type Accessor, createEffect } from "solid-js";

import Environment from "./Environment";
import { threadTitlesEffect } from "./Infrastructure/commandEffects";

interface ILineageTitles extends IEntity {
  Key: string;
  /** Null until the lookup for `Key` settles, and after it fails. */
  Titles: Record<string, string> | null;
}

export function* lookUpTitles(
  draft: ILineageTitles,
  environmentId: string,
  threadIds: string[],
): IActionGenerator {
  const key = threadIds.join(",");
  if (key === draft.Key) return;
  draft.Key = key;
  draft.Titles = null;
  try {
    draft.Titles = (yield* threadTitlesEffect({
      EnvironmentId: environmentId,
      ThreadIds: threadIds,
    })).Titles;
  } catch {
    draft.Titles = null;
  }
}
latest(lookUpTitles);

/**
 * The server's titles for related threads the shell doesn't carry, as stock's `threadTitles` query
 * finds them. Null until a lookup of exactly these ids has settled.
 */
export function useLineageTitles(threadIds: Accessor<string[]>) {
  const environment = Environment.use();
  const held = useComponentState<ILineageTitles>(() => ({ Key: "", Titles: null }));
  createEffect(() => {
    const ids = threadIds();
    if (ids.length > 0) void held.dispatch(lookUpTitles, environment.state.EnvironmentId, ids);
  });
  return () => (held.state.Key === threadIds().join(",") ? held.state.Titles : null);
}
