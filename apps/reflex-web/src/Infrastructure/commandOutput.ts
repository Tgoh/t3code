import { subscribe } from "@t3tools/client-runtime/rpc";
import {
  applyCommandOutputFrame,
  EMPTY_COMMAND_OUTPUT,
} from "@t3tools/client-runtime/state/command-output";
import { ORCHESTRATION_V2_WS_METHODS, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { IResourceImplementation } from "treflex";

import { failureText, followLive } from "./followItems";

export interface ICommandOutput {
  Text: string;
  Truncated: boolean;
  Running: boolean;
  Error: string | null;
}

declare module "treflex" {
  interface IResourceTypeRegistry {
    commandOutput: {
      Params: { EnvironmentId: string; ThreadId: string; ItemId: string };
      Value: ICommandOutput;
    };
  }
}

export const commandOutput: IResourceImplementation<"commandOutput"> = (params, r) => {
  let view = EMPTY_COMMAND_OUTPUT;
  const show = (error: string | null) =>
    r.expose({
      Text: view.output.text,
      Truncated: view.output.truncated,
      Running: error === null && view.running,
      Error: error,
    });
  const frames = subscribe(
    ORCHESTRATION_V2_WS_METHODS.subscribeCommandOutput,
    { threadId: ThreadId.make(params.ThreadId), itemId: TurnItemId.make(params.ItemId) },
    { onExpectedFailure: (cause) => Effect.sync(() => show(failureText(cause))) },
  );
  return followLive(r, params.EnvironmentId, frames, (frame) =>
    Effect.sync(() => {
      view = applyCommandOutputFrame(view, frame);
      show(null);
    }),
  );
};
