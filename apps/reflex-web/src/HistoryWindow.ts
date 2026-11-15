import {
  type IActionGenerator,
  type IEntity,
  type ISelectorGenerator,
  inFlight,
  leading,
  publishToNearest,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import { threadHistoryPage } from "./Infrastructure/threadHistory";
import type { IWireHistoryPage } from "./Infrastructure/wire";

declare module "treflex" {
  interface IMessageRegistry {
    "History/Page": { WindowId: string; Items: IWireHistoryPage["items"] };
  }
}

export interface IHistoryWindow extends IEntity {
  ThreadId: string;
  Cursor: string | null;
  HasMore: boolean;
  Error?: string;
}

export function* loadEarlier(draft: IHistoryWindow): IActionGenerator {
  if (draft.Cursor === null || !draft.HasMore) return;
  delete draft.Error;
  let cursor = draft.Cursor;
  try {
    for (;;) {
      const page: IWireHistoryPage = yield* threadHistoryPage(draft.ThreadId, cursor);
      yield* publishToNearest(draft, "History/Page", { WindowId: draft.$Id, Items: page.items });
      draft.Cursor = page.nextCursor;
      draft.HasMore = page.hasMoreHistory;
      const reachedUser = page.items.some(
        ({ item }) => item.type === "user_message" && item.createdBy === "user",
      );
      if (!page.hasMoreHistory || reachedUser || page.nextCursor === null) break;
      if (page.nextCursor === cursor) throw new Error("History did not advance.");
      cursor = page.nextCursor;
    }
  } catch (error) {
    draft.Error = error instanceof Error ? error.message : String(error);
  }
}
leading(loadEarlier);

export function* loadingEarlier(draft: IHistoryWindow): ISelectorGenerator<boolean> {
  return yield* inFlight(loadEarlier, draft);
}

export default createEntityFeature<IHistoryWindow>(import.meta.url)(
  { loadEarlier },
  { loadingEarlier },
);
