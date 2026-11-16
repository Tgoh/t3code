import {
  type IActionGenerator,
  type IEntity,
  type IReceiverId,
  type ISerializedThrow,
  receiver,
  start,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import { type IEnvironment, init, newEnvironment } from "./Environment";
import { environmentInfo } from "./Infrastructure/environmentInfo";

export interface IRoot extends IEntity {
  readonly $Receiver?: IReceiverId<IRoot>;
  Phase: "loading" | "unpaired" | "connected";
  Label: string;
  Environments: IEnvironment[];
  Failure?: string;
}

export function getDefaultRoot(id: string): IRoot {
  return {
    $Id: id,
    $Receiver: RootReceiver.Id,
    Phase: "loading",
    Label: "",
    Environments: [],
  };
}

export function* load(draft: IRoot): IActionGenerator {
  const info = yield* environmentInfo();
  draft.Label = info.Label;
  if (!info.Authenticated) {
    draft.Phase = "unpaired";
    return;
  }
  const environment = yield* newEnvironment(
    info.EnvironmentId,
    info.Label,
    info.FileAttachmentLimit,
  );
  draft.Phase = "connected";
  draft.Environments.push(environment);
  yield* start(init, environment.$Id);
}

export function* dismissFailure(draft: IRoot): IActionGenerator {
  delete draft.Failure;
}

const describe = (thrown: ISerializedThrow): string =>
  thrown.Thrown === "error" ? thrown.Message : JSON.stringify(thrown.Data ?? null);

export const RootReceiver = receiver<IRoot>("RootReceiver")({
  *"Action/Error"(draft, failure) {
    draft.Failure = describe(failure.Error);
  },
});

export default createEntityFeature<IRoot>(import.meta.url)({ load, dismissFailure });
