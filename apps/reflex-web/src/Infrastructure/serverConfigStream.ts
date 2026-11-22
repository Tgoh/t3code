import { ServerConfigStreamEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { IResourceImplementation } from "treflex";

import { followItems } from "./followItems";
import { serverConfigEvents } from "./serverConfigEvents";
import { type Wire, wireCodec } from "./wire";

export type IWireServerConfigEvent = Wire<ServerConfigStreamEvent>;

declare module "treflex" {
  interface IResourceTypeRegistry {
    serverConfigStream: {
      Params: { EnvironmentId: string };
      Message: { Item: IWireServerConfigEvent };
    };
  }
}

const encodeEvent = Schema.encodeEffect(wireCodec(ServerConfigStreamEvent));

export const serverConfigStream: IResourceImplementation<"serverConfigStream"> = (params, r) =>
  followItems(
    r,
    params.EnvironmentId,
    serverConfigEvents,
    (event) =>
      encodeEvent(event).pipe(
        Effect.map((encoded) => encoded as unknown as IWireServerConfigEvent),
      ),
    () => {},
  );
