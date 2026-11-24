import {
  type IActionGenerator,
  type IEntity,
  type IReceiverId,
  type IRuntime,
  type ISerializedThrow,
  receiver,
  start,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import { type IEnvironment, init, newEnvironment } from "./Environment";
import { environmentInfo } from "./Infrastructure/environmentInfo";
import { toast } from "./Infrastructure/toasts";
import { restoreFiles } from "./ThreadSession";

export interface IRoot extends IEntity {
  readonly $Receiver?: IReceiverId<IRoot>;
  Phase: "loading" | "unpaired" | "connected";
  Label: string;
  BootstrapMethods: string[];
  Environments: IEnvironment[];
}

export function getDefaultRoot(id: string): IRoot {
  return {
    $Id: id,
    $Receiver: RootReceiver.Id,
    Phase: "loading",
    Label: "",
    BootstrapMethods: [],
    Environments: [],
  };
}

/** Also runs again once the unpaired page has paired, since the session is then authenticated. */
export function* load(draft: IRoot): IActionGenerator {
  if (draft.Phase === "connected") return;
  const info = yield* environmentInfo();
  draft.Label = info.Label;
  draft.BootstrapMethods = info.BootstrapMethods;
  if (!info.Authenticated) {
    draft.Phase = "unpaired";
    return;
  }
  const environment = yield* newEnvironment(
    info.EnvironmentId,
    info.Label,
    info.FileAttachmentLimit,
    info.Hostname,
  );
  draft.Phase = "connected";
  draft.Environments.push(environment);
  yield* start(init, environment.$Id);
}

const describe = (thrown: ISerializedThrow): string =>
  thrown.Thrown === "error" ? thrown.Message : JSON.stringify(thrown.Data ?? null);

export const RootReceiver = receiver<IRoot>("RootReceiver")({
  *"Action/Error"(_draft, failure) {
    yield* toast({
      Kind: "error",
      Title: "That didn't work",
      Description: describe(failure.Error),
    });
  },
});

export default createEntityFeature<IRoot>("Root")({ load });

/** The `repair` a restore passes: each draft's files reopen holding only what its draft kept. */
export function repairDraftFiles(runtime: IRuntime<IRoot>) {
  const sessions = runtime.state.Environments.flatMap((environment) =>
    Object.values(environment.Local.ThreadSessions),
  );
  return Promise.all(sessions.map((session) => runtime.dispatch(restoreFiles, session.$Id)));
}
