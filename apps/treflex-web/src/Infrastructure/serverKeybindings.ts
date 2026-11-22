import { currentSession } from "@t3tools/client-runtime/rpc";
import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import type { IResourceImplementation } from "treflex";

import { followLive } from "./followItems";

declare module "treflex" {
  interface IResourceTypeRegistry {
    serverKeybindings: {
      Params: { EnvironmentId: string };
      Value: ResolvedKeybindingsConfig;
    };
  }
}

/** The user's keybindings, merged with the defaults by the server, from the session's config stream. */
export const serverKeybindings: IResourceImplementation<"serverKeybindings"> = (params, r) =>
  followLive(
    r,
    params.EnvironmentId,
    Stream.unwrap(
      currentSession().pipe(
        Effect.retry(Schedule.spaced("1 second")),
        Effect.map((session) => session.subscribeServerConfig()),
      ),
    ),
    (event) =>
      Effect.sync(() => {
        if (event.type === "snapshot") r.expose(event.config.keybindings);
        else if (event.type === "keybindingsUpdated") r.expose(event.payload.keybindings);
      }),
  );
