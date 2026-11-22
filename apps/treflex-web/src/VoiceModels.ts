import {
  type IActionGenerator,
  type IEntity,
  inFlight,
  type IOpenGenerator,
  latest,
  leading,
  open,
  receiver,
  startTimer,
  stopTimer,
} from "treflex";
import { createComponentFeature } from "treflex-solid";

import {
  type IVoiceModel,
  voiceModelCommandEffect,
  voiceModelsEffect,
} from "./Infrastructure/dictation";
import { serverError } from "./Infrastructure/serverError";

declare module "treflex" {
  interface ITimerRegistry {
    "Voice/Poll": {};
  }
}

// Follows the progress poll in apps/web/src/components/settings/VoiceSettingsPanel.tsx.
export const POLL_MS = 1_000;

/** Voice settings' model list, for this client's one environment. */
export interface IVoiceModels extends IEntity {
  Models: IVoiceModel[] | null;
  Picked: string | null;
  Error: string | null;
}

export function getDefaultVoiceModels(): Omit<IVoiceModels, "$Id"> {
  return { Models: null, Picked: null, Error: null };
}

const busy = (model: IVoiceModel) => model.state === "downloading" || model.state === "verifying";

function* follow(draft: IVoiceModels, models: IVoiceModel[]): IActionGenerator {
  draft.Models = models;
  if (models.some(busy)) yield* startTimer(draft, "Voice/Poll", VoiceModelsReceiver, POLL_MS);
}

export function* loadModels(draft: IVoiceModels): IOpenGenerator {
  try {
    yield* follow(draft, yield* open(voiceModelsEffect()));
  } catch (error) {
    draft.Error = serverError(error).message;
  }
}
latest(loadModels);

export function* pickModel(draft: IVoiceModels, modelId: string): IActionGenerator {
  draft.Picked = modelId;
}

/** A model just downloaded is put in use unless it already is, as stock's setup does. */
export function* downloadModel(draft: IVoiceModels, modelId: string): IOpenGenerator {
  draft.Error = null;
  yield* startTimer(draft, "Voice/Poll", VoiceModelsReceiver, POLL_MS);
  try {
    let models = yield* open(voiceModelCommandEffect({ Command: "download", ModelId: modelId }));
    const model = models.find((held) => held.id === modelId);
    if (model?.state === "installed" && !model.active) {
      models = yield* open(voiceModelCommandEffect({ Command: "select", ModelId: modelId }));
    }
    yield* follow(draft, models);
  } catch (error) {
    draft.Error = serverError(error).message;
  }
}
leading(downloadModel);

export function* selectModel(draft: IVoiceModels, modelId: string): IOpenGenerator {
  yield* command(draft, "select", modelId);
}
leading(selectModel);

export function* cancelDownload(draft: IVoiceModels, modelId: string): IOpenGenerator {
  yield* command(draft, "cancel", modelId);
}
leading(cancelDownload);

function* command(draft: IVoiceModels, kind: "select" | "cancel", modelId: string): IOpenGenerator {
  draft.Error = null;
  try {
    yield* follow(draft, yield* open(voiceModelCommandEffect({ Command: kind, ModelId: modelId })));
  } catch (error) {
    draft.Error = serverError(error).message;
  }
}

export const VoiceModelsReceiver = receiver<IVoiceModels>("VoiceModelsReceiver")({
  *"Voice/Poll"(draft) {
    yield* loadModels(draft);
    if (draft.Models?.some(busy) === true || (yield* inFlight(downloadModel, draft))) return;
    yield* stopTimer(draft, "Voice/Poll");
  },
});

export default createComponentFeature<IVoiceModels>(import.meta.url)(
  { loadModels, pickModel, downloadModel, selectModel, cancelDownload },
  {},
);
