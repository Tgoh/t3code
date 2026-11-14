import { subscribeDynamic } from "@t3tools/client-runtime/rpc";
import { ORCHESTRATION_V2_WS_METHODS, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { IResourceImplementation } from "treflex";

import { followItems } from "./followItems";
import { encodeThreadItem } from "./threadItemCodec";
import type { IWireThreadItem } from "./wire";

declare module "treflex" {
  interface IResourceTypeRegistry {
    threadStream: {
      Params: { EnvironmentId: string; ThreadId: string };
      Message: { Item: IWireThreadItem } | { Resubscribing: true };
    };
  }
}

export const threadStream: IResourceImplementation<"threadStream"> = (params, r) => {
  let cursor = typeof r.resumeFrom === "number" ? r.resumeFrom : 0;
  let retrying = false;
  const items = subscribeDynamic(
    ORCHESTRATION_V2_WS_METHODS.subscribeThread,
    () =>
      Effect.promise(() => r.emit({ Resubscribing: true })).pipe(
        Effect.map(() => ({
          threadId: ThreadId.make(params.ThreadId),
          requestCompletionMarker: true,
          acceptBoundedSnapshot: true,
          acceptCompactTurnItems: true,
          acceptCompactIds: true,
          acceptDedupedBodies: true,
          ...(cursor > 0 ? { afterSequence: cursor } : {}),
        })),
      ),
    {
      onExpectedFailure: () =>
        Effect.sync(() => {
          retrying = true;
          r.status("retrying");
        }),
      retryExpectedFailureAfter: "1 second",
    },
  );
  return followItems(r, params.EnvironmentId, items, encodeThreadItem, (item) => {
    if (retrying) {
      retrying = false;
      r.status();
    }
    if (item.kind === "snapshot") cursor = item.snapshotSequence;
    else if (item.kind !== "synchronized") cursor = item.sequence;
  });
};
