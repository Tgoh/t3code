import type { VoiceInputPhase, VoiceInputState } from "@t3tools/client-runtime/voice-input";
import type { SpeechTranscriptionOptions } from "@t3tools/contracts";
import { resolveSpeechVocabulary } from "@t3tools/shared/speech";
import {
  type IActionGenerator,
  type IEntity,
  type ISelectorGenerator,
  isEnded,
  open,
  openResource,
  parallelSettled,
  publishToNearest,
  receiver,
  resource,
  start,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import type { IEnvironment } from "./Environment";
import type { IDispatchMode } from "./Infrastructure/commandEffects";
import {
  type IDictationDraft,
  type IDictationMessage,
  type IVoiceModel,
  voiceModelsEffect,
  voiceStatusEffect,
} from "./Infrastructure/dictation";
import { clockNowEffect, type IVoiceDestination } from "./Infrastructure/preferences";
import { setPreferences } from "./Preferences";
import { storedClientSettingsEffect } from "./Infrastructure/settings";
import { serverError } from "./Infrastructure/serverError";
import { openView } from "./Settings";
import { threadProjectId } from "./ThreadSession";
import { cancelDownload, downloadModel, follow, loadModels, selectModel } from "./VoiceModels";

declare module "treflex" {
  interface IResourceRegistry {
    "Voice/Dictation": { Type: "dictation" };
  }
  interface IMessageRegistry {
    /** A transcript for a thread's draft, which only the environment can reach. */
    "Dictation/Commit": {
      ThreadId: string;
      Before: string;
      Text: string;
      Mode: IDispatchMode | null;
    };
  }
}

export interface IDictation extends IEntity {
  Recording: IRecording;
  Models: IVoiceModel[] | null;
  ModelsError: string | null;
}

export function getDefaultDictation(): Omit<IDictation, "$Id"> {
  return { Recording: { ...IDLE }, Models: null, ModelsError: null };
}

export interface IRecording {
  /** The thread whose draft the recording goes into, whichever thread is on screen. */
  ThreadId: string | null;
  Phase: VoiceInputPhase;
  Error: string | null;
  ErrorAction: VoiceInputState["errorAction"];
  StartedAt: number | null;
  /** A send made while recording, run once the transcript is in the draft. */
  SubmitMode: IDispatchMode | null;
  /** The transcript was refused, so the idle that follows it keeps the error showing. */
  HoldError: boolean;
}

const IDLE: IRecording = {
  ThreadId: null,
  Phase: "idle",
  Error: null,
  ErrorAction: null,
  StartedAt: null,
  SubmitMode: null,
  HoldError: false,
};

export const STALE_DRAFT =
  "The draft changed while voice input was running. The transcript was not added.";
export const MISSING_MODEL =
  "No transcription model is installed. Download one in Settings → Voice.";

/** Follows voiceInputBlocksSubmission in packages/client-runtime/src/voice-input/controller.ts. */
export const dictationBusy = (phase: VoiceInputPhase) =>
  phase === "preparing" ||
  phase === "recording" ||
  phase === "transcribing" ||
  phase === "post-processing";

export function* openDictation(draft: IDictation): IActionGenerator {
  yield* openResource(draft, "Voice/Dictation", DictationReceiver, { Type: "dictation" });
}

function fail(
  draft: IDictation,
  threadId: string,
  error: string,
  action: VoiceInputState["errorAction"],
): void {
  Object.assign(draft.Recording, {
    ...IDLE,
    ThreadId: threadId,
    Phase: "error",
    Error: error,
    ErrorAction: action,
  });
}

function* recordingOptions(
  draft: IEnvironment,
  threadId: string,
): IActionGenerator<{ Options: SpeechTranscriptionOptions; Streaming: boolean }> {
  const settings = draft.Local.ClientSettings ?? (yield* storedClientSettingsEffect());
  const projectId = threadProjectId(
    draft.Replica,
    threadId,
    draft.Local.ThreadSessions[threadId]?.NewThreadProjectId,
  );
  const projectName =
    projectId === null ? "" : (draft.Replica.Shell.Projects[projectId]?.title ?? "");
  const { speechCustomWords, speechHints } = resolveSpeechVocabulary({
    personal: settings.speechCustomWords,
    project: [],
    hints: [projectName],
  });
  return {
    Options: {
      speechLanguage: settings.speechLanguage,
      speechTranslateToEnglish: settings.speechTranslateToEnglish,
      speechCustomWords,
      ...(speechHints.length > 0 ? { speechHints } : {}),
      speechRemoveFillerWords: settings.speechRemoveFillerWords,
      speechSilenceFiltering: settings.speechSilenceFiltering,
    },
    Streaming: settings.speechStreaming,
  };
}

// Follows start in apps/web/src/speech/useEnvironmentSpeechInput.ts: the destination's status is
// read fresh first, and a missing model points to Voice settings instead of recording.
export function* startDictation(draft: IEnvironment, threadId: string, text: IDictationDraft) {
  const state = draft.Local.Dictation.Recording;
  if (state.Phase !== "idle" && state.Phase !== "error") return;
  if (draft.Local.Preferences.VoiceDestination === null) {
    yield* openView(draft, { Kind: "settings", Page: "voice" });
    return;
  }
  if (draft.Local.Preferences.VoiceDestination !== "server") return;
  Object.assign(state, { ...IDLE, ThreadId: threadId, Phase: "preparing" });
  const [read, listed] = yield* open(parallelSettled(voiceStatusEffect(), voiceModelsEffect()));
  const dictation = draft.Local.Dictation;
  if (!read.ok) {
    const { message } = serverError(read.error);
    if (stillPreparing(dictation, threadId)) fail(dictation, threadId, message, "retry");
    return;
  }
  const status = read.value;
  let models: IVoiceModel[] | null = null;
  if (listed.ok) models = listed.value;
  else serverError(listed.error);
  if (models !== null) yield* follow(dictation, models);
  if (!stillPreparing(dictation, threadId)) return;
  if (!status.supported) {
    fail(dictation, threadId, status.reason, null);
    return;
  }
  const missing =
    models === null ? status.state === "missing-model" : !models.some((model) => model.active);
  if (missing) {
    fail(dictation, threadId, MISSING_MODEL, "settings");
    return;
  }
  const options = yield* recordingOptions(draft, threadId);
  yield* resource(dictation, "Voice/Dictation").start({
    ThreadId: threadId,
    Draft: text,
    ...options,
  });
}

function stillPreparing(draft: IDictation, threadId: string): boolean {
  const state = draft.Recording;
  return state.Phase === "preparing" && state.ThreadId === threadId;
}

export function* stopDictation(draft: IDictation): IActionGenerator {
  if (draft.Recording.Phase === "recording") yield* resource(draft, "Voice/Dictation").stop();
}

export function* cancelDictation(draft: IDictation): IActionGenerator {
  const state = draft.Recording;
  if (state.Phase === "idle") return;
  Object.assign(state, IDLE);
  yield* resource(draft, "Voice/Dictation").cancel();
}

/** Follows submitAfterDictation in apps/web/src/speech/useEnvironmentSpeechInput.ts. */
export function* sendAfterDictation(
  draft: IDictation,
  threadId: string,
  mode: IDispatchMode,
): IActionGenerator {
  const state = draft.Recording;
  if (state.ThreadId !== threadId || !dictationBusy(state.Phase) || state.Phase === "preparing")
    return;
  if (state.SubmitMode !== null) return;
  state.SubmitMode = mode;
  if (state.Phase === "recording") yield* resource(draft, "Voice/Dictation").stop();
}

/** Turning voice off stops audio leaving the device at once, as stock's revoked grant does. */
export function* setVoiceDestination(
  draft: IEnvironment,
  destination: IVoiceDestination,
): IActionGenerator {
  yield* setPreferences(draft, { VoiceDestination: destination });
  if (destination === "server") yield* start(loadModels, draft.Local.Dictation);
  else yield* cancelDictation(draft.Local.Dictation);
}

/** A deleted thread's recording has nowhere to go. */
export function* dropDictation(draft: IDictation, threadId: string): IActionGenerator {
  if (draft.Recording.ThreadId === threadId) yield* cancelDictation(draft);
}

/** The controller emits idle after a commit; until then, the refusal's error has to outlast it. */
export function* refuseTranscript(draft: IDictation, threadId: string): IActionGenerator {
  const { Phase } = draft.Recording;
  if (Phase === "preparing" || Phase === "recording") return;
  fail(draft, threadId, STALE_DRAFT, "retry");
  draft.Recording.HoldError = Phase !== "idle" && Phase !== "error";
}

export function* recording(draft: IDictation): ISelectorGenerator<IRecording> {
  return draft.Recording;
}

export const DictationReceiver = receiver<IDictation>("DictationReceiver")({
  *"Voice/Dictation"(draft, message) {
    if (isEnded(message)) {
      Object.assign(draft.Recording, IDLE);
      return;
    }
    yield* apply(draft, message);
  },
});

function* apply(draft: IDictation, message: IDictationMessage): IActionGenerator {
  const state = draft.Recording;
  if (message.Kind === "commit") {
    const mode = state.SubmitMode;
    state.SubmitMode = null;
    yield* publishToNearest(draft, "Dictation/Commit", {
      ThreadId: message.ThreadId,
      Before: message.Before,
      Text: message.Text,
      Mode: mode,
    });
    return;
  }
  if (message.Phase === "idle" && state.HoldError) {
    state.HoldError = false;
    return;
  }
  // A cancel resets this state itself, so an idle arriving while preparing is a dismissed run's.
  if (message.Phase === "idle" && state.Phase === "preparing") return;
  const startedAt =
    message.Phase !== "recording" ? null : (state.StartedAt ?? (yield* clockNowEffect()));
  Object.assign(state, {
    ThreadId: message.Phase === "idle" ? null : (message.ThreadId ?? state.ThreadId),
    Phase: message.Phase,
    Error: message.Error,
    ErrorAction: message.ErrorAction,
    StartedAt: startedAt,
    SubmitMode: message.Phase === "idle" || message.Phase === "error" ? null : state.SubmitMode,
  });
}

export default createEntityFeature<IDictation>("Dictation")(
  {
    stopDictation,
    cancelDictation,
    sendAfterDictation,
    loadModels,
    downloadModel,
    selectModel,
    cancelDownload,
  },
  { recording },
);
