import { subscribeDynamic } from "@t3tools/client-runtime/rpc";
import { ORCHESTRATION_V2_WS_METHODS, OrchestrationV2ShellStreamItem } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { IResourceImplementation } from "treflex";

import { followItems } from "./followItems";
import { type IWireShellItem, wireCodec } from "./wire";

declare module "treflex" {
  interface IResourceTypeRegistry {
    shellStream: {
      Params: { EnvironmentId: string };
      Message: { Item: IWireShellItem } | { Resubscribing: true };
    };
  }
}

const encodeItem = Schema.encodeEffect(wireCodec(OrchestrationV2ShellStreamItem));

export const shellStream: IResourceImplementation<"shellStream"> = (params, r) => {
  let cursor = typeof r.resumeFrom === "number" ? r.resumeFrom : 0;
  const items = subscribeDynamic(ORCHESTRATION_V2_WS_METHODS.subscribeShell, (session) =>
    Effect.promise(() => r.emit({ Resubscribing: true })).pipe(
      Effect.andThen(session.initialConfig),
      Effect.map((config) => ({
        omitIdleSubagents: config.shellThreadFamilies === true,
      })),
      Effect.orElseSucceed(() => ({})),
      Effect.map((options) => ({
        ...options,
        requestCompletionMarker: true,
        ...(cursor > 0 ? { afterSequence: cursor } : {}),
      })),
    ),
  );
  return followItems(
    r,
    params.EnvironmentId,
    items,
    (item) => encodeItem(item).pipe(Effect.map((encoded) => encoded as unknown as IWireShellItem)),
    (item) => {
      if ("sequence" in item) cursor = item.sequence;
      else if (item.kind === "snapshot" && item.resolvedRepositoryIdentityRoots === undefined)
        cursor = item.snapshot.snapshotSequence;
    },
  );
};
