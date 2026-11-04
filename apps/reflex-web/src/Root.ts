import { fork, type IActionGenerator, type IEntity } from "reflex";
import { createFeatureContext } from "reflex-solid";

import { getDefaultEnvironment, type IEnvironment, init } from "./Environment";
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
  draft.Phase = "connected";
  const environment = getDefaultEnvironment(info.EnvironmentId, info.Label);
  draft.Environments.push(environment);
  yield* fork(init, environment.$Id);
}

export default createFeatureContext<IRoot>(import.meta.url)({ load });
