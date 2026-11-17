import { currentSession } from "@t3tools/client-runtime/rpc";
import { ServerConfigStreamEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { IResourceImplementation } from "treflex";

import { followItems } from "./followItems";
import type { Wire } from "./wire";

export type IWireServerConfigEvent = Wire<ServerConfigStreamEvent>;

declare module "treflex" {
  interface IResourceTypeRegistry {
    serverConfigStream: {
      Params: { EnvironmentId: string };
      Message: { Item: IWireServerConfigEvent };
    };
  }
}

const encodeEvent = Schema.encodeEffect(Schema.toCodecJson(ServerConfigStreamEvent));

/** The session's config stream, which opens with a snapshot of the current config. */
export const serverConfigStream: IResourceImplementation<"serverConfigStream"> = (params, r) =>
  followItems(
    r,
    params.EnvironmentId,
    Stream.unwrap(
      currentSession().pipe(
        Effect.retry(Schedule.spaced("1 second")),
        Effect.map((session) => session.subscribeServerConfig()),
      ),
    ),
    (event) =>
      encodeEvent(event).pipe(
        Effect.map((encoded) => encoded as unknown as IWireServerConfigEvent),
      ),
    () => {},
  );
