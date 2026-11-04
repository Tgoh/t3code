import { OrchestrationV2ThreadStreamItem } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { IWireThreadItem } from "./wire";

const encodeItem = Schema.encodeEffect(Schema.toCodecJson(OrchestrationV2ThreadStreamItem));

// An unknown-event is decode-only: its schema refuses to encode, and it has no dates to convert.
export const encodeThreadItem = (item: OrchestrationV2ThreadStreamItem) =>
  item.kind === "unknown-event"
    ? Effect.succeed<IWireThreadItem>(item)
    : encodeItem(item).pipe(Effect.map((encoded) => encoded as unknown as IWireThreadItem));
