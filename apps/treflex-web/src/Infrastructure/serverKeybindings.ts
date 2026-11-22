import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { IResourceImplementation } from "treflex";

import { followLive } from "./followItems";
import { serverConfigEvents } from "./serverConfigEvents";

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
  followLive(r, params.EnvironmentId, serverConfigEvents, (event) =>
    Effect.sync(() => {
      if (event.type === "snapshot") r.expose(event.config.keybindings);
      else if (event.type === "keybindingsUpdated") r.expose(event.payload.keybindings);
    }),
  );
