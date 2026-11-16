import { subscribe } from "@t3tools/client-runtime/rpc";
import { type VcsStatusResult, WS_METHODS } from "@t3tools/contracts";
import { applyGitStatusStreamEvent } from "@t3tools/shared/git";
import * as Effect from "effect/Effect";
import type { IResourceImplementation } from "treflex";

import { failureText, followLive } from "./followItems";

export interface IVcsStatus {
  Status: VcsStatusResult | null;
  Error: string | null;
}

declare module "treflex" {
  interface IResourceTypeRegistry {
    vcsStatus: {
      Params: { EnvironmentId: string; Cwd: string };
      Value: IVcsStatus;
    };
  }
}

export const vcsStatus: IResourceImplementation<"vcsStatus"> = (params, r) => {
  let status: VcsStatusResult | null = null;
  const events = subscribe(
    WS_METHODS.subscribeVcsStatus,
    { cwd: params.Cwd },
    {
      onExpectedFailure: (cause) =>
        Effect.sync(() => r.expose({ Status: status, Error: failureText(cause) })),
    },
  );
  return followLive(r, params.EnvironmentId, events, (event) =>
    Effect.sync(() => {
      status = applyGitStatusStreamEvent(status, event);
      r.expose({ Status: status, Error: null });
    }),
  );
};
