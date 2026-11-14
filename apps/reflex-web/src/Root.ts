import { type IActionGenerator, type IEntity, start } from "treflex";
import { createEntityFeature } from "treflex-solid";

import { type IEnvironment, init, newEnvironment } from "./Environment";
import { environmentInfo } from "./Infrastructure/environmentInfo";

export interface IRoot extends IEntity {
  Phase: "loading" | "unpaired" | "connected";
  Label: string;
  Environments: IEnvironment[];
}

export function getDefaultRoot(id: string): IRoot {
  return { $Id: id, Phase: "loading", Label: "", Environments: [] };
}

export function* load(draft: IRoot): IActionGenerator {
  const info = yield* environmentInfo();
  draft.Label = info.Label;
  if (!info.Authenticated) {
    draft.Phase = "unpaired";
    return;
  }
  const environment = yield* newEnvironment(info.EnvironmentId, info.Label);
  draft.Phase = "connected";
  draft.Environments.push(environment);
  yield* start(init, environment.$Id);
}

export default createEntityFeature<IRoot>(import.meta.url)({ load });
