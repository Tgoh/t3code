import type { IActionGenerator, IEntity } from "treflex";

import { turnItemEffect } from "./Infrastructure/commandEffects";
import { serverError } from "./Infrastructure/serverError";
import type { IWireTurnItem } from "./Infrastructure/wire";

/** An expanded tool row's whole item, which the wire sends without its output. */
export interface IToolDetail extends IEntity {
  /** The thread that ran the tool, which differs from the session's for an inherited row. */
  ThreadId: string;
  ItemId: string;
  Item: IWireTurnItem | null;
  /** The server no longer has the item. */
  Missing: boolean;
  Error: string | null;
}

export function* loadToolDetail(draft: IToolDetail, environmentId: string): IActionGenerator {
  try {
    const item = yield* turnItemEffect({
      EnvironmentId: environmentId,
      ThreadId: draft.ThreadId,
      ItemId: draft.ItemId,
    });
    draft.Item = item;
    draft.Missing = item === null;
  } catch (error) {
    draft.Error = serverError(error).message;
  }
}
