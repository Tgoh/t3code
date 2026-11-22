import { OrchestrationV2ThreadStreamItem } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { type IWireThreadItem, wireCodec } from "./wire";

const encodeItem = Schema.encodeEffect(wireCodec(OrchestrationV2ThreadStreamItem));

export const encodeThreadItem = (item: OrchestrationV2ThreadStreamItem) =>
  encodeItem(item).pipe(Effect.map((encoded) => encoded as unknown as IWireThreadItem));
