import {
  type IActionGenerator,
  inFlight,
  type IOpenGenerator,
  latest,
  leading,
  open,
  receiver,
  startTimer,
  stopTimer,
} from "treflex";

import type { IDictation } from "./Dictation";
import {
  type IVoiceModel,
  voiceModelCommandEffect,
  voiceModelsEffect,
} from "./Infrastructure/dictation";
import { serverError } from "./Infrastructure/serverError";
import { toast } from "./Infrastructure/toasts";

declare module "treflex" {
  interface ITimerRegistry {
    "Voice/Poll": {};
  }
}

// Follows the progress poll in apps/web/src/components/settings/VoiceSettingsPanel.tsx.
export const POLL_MS = 1_000;

const busy = (model: IVoiceModel) => model.state === "downloading" || model.state === "verifying";

export function* follow(draft: IDictation, models: IVoiceModel[]): IActionGenerator {
  draft.Models = models;
  if (models.some(busy)) yield* startTimer(draft, "Voice/Poll", VoiceModelsReceiver, POLL_MS);
}

// Follows the failure toasts of the model list and its `run` actions in VoiceSettingsPanel.tsx.
const failed = (title: string, error: unknown) =>
  toast({ Kind: "error", Title: title, Description: serverError(error).message });

/** The progress poll passes `quiet`, as stock's progress refresh shows no failure. */
export function* loadModels(draft: IDictation, quiet = false): IOpenGenerator {
  try {
    yield* follow(draft, yield* open(voiceModelsEffect()));
  } catch (error) {
    if (quiet) serverError(error);
    else yield* failed("Could not load transcription models", error);
  }
}
latest(loadModels);

/** A model just downloaded is put in use unless it already is, as stock's setup does. */
export function* downloadModel(draft: IDictation, modelId: string): IOpenGenerator {
  yield* startTimer(draft, "Voice/Poll", VoiceModelsReceiver, POLL_MS);
  try {
    let result = yield* open(voiceModelCommandEffect({ Command: "download", ModelId: modelId }));
    // Follows getSpeechModelDownloadOutcome in packages/client-runtime/src/voice-input/environment.ts.
    const model = result.Models.find((held) => held.id === modelId);
    if (!result.Cancelled && model?.state === "installed" && !model.active) {
      result = yield* open(voiceModelCommandEffect({ Command: "select", ModelId: modelId }));
    }
    yield* follow(draft, result.Models);
  } catch (error) {
    yield* failed("Could not download the model", error);
  }
}
leading(downloadModel);

export function* selectModel(draft: IDictation, modelId: string): IOpenGenerator {
  yield* command(draft, "select", modelId);
}
leading(selectModel);

export function* cancelDownload(draft: IDictation, modelId: string): IOpenGenerator {
  yield* command(draft, "cancel", modelId);
}
leading(cancelDownload);

function* command(draft: IDictation, kind: "select" | "cancel", modelId: string): IOpenGenerator {
  try {
    yield* follow(
      draft,
      (yield* open(voiceModelCommandEffect({ Command: kind, ModelId: modelId }))).Models,
    );
  } catch (error) {
    yield* failed(
      kind === "select" ? "Could not select the model" : "Could not cancel the download",
      error,
    );
  }
}

export const VoiceModelsReceiver = receiver<IDictation>("VoiceModelsReceiver")({
  *"Voice/Poll"(draft) {
    yield* loadModels(draft, true);
    if (draft.Models?.some(busy) === true || (yield* inFlight(downloadModel, draft))) return;
    yield* stopTimer(draft, "Voice/Poll");
  },
});
