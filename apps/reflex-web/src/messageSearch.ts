// @effect-diagnostics globalTimers:off -- A view-only debounce, outside any Effect runtime.
import { visibleThreadSearch } from "@t3tools/client-runtime/state/thread-search";
import { THREAD_SEARCH_QUERY_MAX_LENGTH } from "@t3tools/contracts";
import { messageSearchTokens } from "@t3tools/shared/paletteSearch";
import { type IActionGenerator, type IEntity, latest } from "treflex";
import { useComponentState } from "treflex-solid";
import { type Accessor, createEffect, createMemo, onCleanup } from "solid-js";

import Environment from "./Environment";
import { searchThreadsEffect } from "./Infrastructure/commandEffects";
import type { IThreadSearchMatch } from "./threadSearch";

const DEBOUNCE_MS = 120;

interface IMessageSearch extends IEntity {
  Query: string;
  Matches: IThreadSearchMatch[];
}

function* search(draft: IMessageSearch, environmentId: string, query: string): IActionGenerator {
  try {
    draft.Matches = (yield* searchThreadsEffect({
      EnvironmentId: environmentId,
      Query: query,
    })).Matches;
  } catch {
    draft.Matches = [];
  }
  draft.Query = query;
}
latest(search);

// Follows normalizedQuery in useThreadSearch, apps/web/src/state/queries.ts: a pasted wall of text
// searches by its start rather than failing the request.
export const normalizeMessageQuery = (query: string) =>
  query.trim().slice(0, THREAD_SEARCH_QUERY_MAX_LENGTH).trim();

/** The server needs a word of three or more letters to match messages. */
export const searchesMessages = (query: string) =>
  messageSearchTokens(normalizeMessageQuery(query)).long.length > 0;

/**
 * Server message matches for `query`, debounced as stock's `useThreadSearch`. While a refined query
 * runs, the previous results stay, so rows don't blink out and back on every keystroke.
 */
export function useMessageSearch(query: Accessor<string>) {
  const environment = Environment.use();
  const held = useComponentState<IMessageSearch>(() => ({ Query: "", Matches: [] }));
  const normalized = createMemo(() => normalizeMessageQuery(query()));
  const active = createMemo(() => searchesMessages(normalized()));
  createEffect(() => {
    const next = normalized();
    if (!active() || next === held.state.Query) return;
    const timer = setTimeout(
      () => held.dispatch(search, environment.state.EnvironmentId, next),
      DEBOUNCE_MS,
    );
    onCleanup(() => clearTimeout(timer));
  });
  const visible = createMemo(() => {
    if (!active()) return { query: "", matches: [] as readonly IThreadSearchMatch[] };
    const last = { query: held.state.Query, matches: held.state.Matches };
    return visibleThreadSearch(
      normalized(),
      last.query === normalized() ? last : null,
      last.query === "" ? null : last,
    );
  });
  return {
    matches: () => visible().matches,
    /** The query the shown matches were found for, which lags `query` while a search runs. */
    query: () => visible().query,
    pending: () => active() && held.state.Query !== normalized(),
  };
}
