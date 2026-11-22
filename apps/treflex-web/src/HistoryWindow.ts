import { type IActionGenerator, type IEntity, leading, publishToNearest } from "treflex";
import { createEntityFeature } from "treflex-solid";

import { serverError, serverFailure } from "./Infrastructure/serverError";
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
      if (page.nextCursor === cursor) throw serverFailure("History did not advance.");
      cursor = page.nextCursor;
    }
  } catch (error) {
    draft.Error = serverError(error).message;
  }
}
leading(loadEarlier);

export default createEntityFeature<IHistoryWindow>("HistoryWindow")({ loadEarlier }, {});
