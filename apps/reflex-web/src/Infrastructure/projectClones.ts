import { subscribe } from "@t3tools/client-runtime/rpc";
import { type ProjectCloneSnapshot, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { IResourceImplementation } from "treflex";

import { followLive } from "./followItems";

declare module "treflex" {
  interface IResourceTypeRegistry {
    projectClones: {
      Params: { EnvironmentId: string };
      Value: ReadonlyArray<ProjectCloneSnapshot>;
    };
  }
}

export const projectClones: IResourceImplementation<"projectClones"> = (params, r) =>
  followLive(r, params.EnvironmentId, subscribe(WS_METHODS.subscribeProjectClones, {}), (clones) =>
    Effect.sync(() => r.expose(clones)),
  );
