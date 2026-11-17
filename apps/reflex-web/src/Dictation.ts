import type { VoiceInputPhase, VoiceInputState } from "@t3tools/client-runtime/voice-input";
import type { SpeechTranscriptionOptions } from "@t3tools/contracts";
import { resolveSpeechVocabulary } from "@t3tools/shared/speech";
import {
  type IActionGenerator,
  type ISelectorGenerator,
  isEnded,
  open,
  openResource,
  receiver,
  resource,
  start,
  transient,
} from "treflex";

import type { IEnvironment } from "./Environment";
import type { IDispatchMode } from "./Infrastructure/commandEffects";
import {
  type IDictationDraft,
  type IDictationMessage,
  voiceStatusEffect,
} from "./Infrastructure/dictation";
import { clockNowEffect, type IVoiceDestination } from "./Infrastructure/preferences";
import { setPreferences } from "./Preferences";
import { storedClientSettingsEffect } from "./Infrastructure/settings";
import { serverError } from "./Infrastructure/serverError";
import { openView } from "./Settings";
import { send, setDraft } from "./ThreadSession";

declare module "treflex" {
  interface IResourceRegistry {
    "Voice/Dictation": { Type: "dictation" };
  }
}

export interface IDictation {
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

const IDLE: IDictation = {
  ThreadId: null,
  Phase: "idle",
  Error: null,
  ErrorAction: null,
  StartedAt: null,
  SubmitMode: null,
  HoldError: false,
};

const held = (draft: IEnvironment) => transient(draft, "Voice/Dictation", { ...IDLE });

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

export function* openDictation(draft: IEnvironment): IActionGenerator {
  yield* openResource(draft, "Voice/Dictation", DictationReceiver, { Type: "dictation" });
}

function* fail(
  draft: IEnvironment,
  threadId: string,
  error: string,
  action: VoiceInputState["errorAction"],
): IActionGenerator {
  Object.assign(yield* held(draft), {
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
  const projectId =
    draft.Local.ThreadSessions[threadId]?.NewThreadProjectId ??
    draft.Replica.Shell.Threads[threadId]?.projectId ??
    null;
  const projectName =
    projectId === null ? "" : (draft.Replica.Shell.Projects[projectId]?.title ?? "");
  return {
    Options: {
      speechLanguage: settings.speechLanguage,
      speechTranslateToEnglish: settings.speechTranslateToEnglish,
      speechCustomWords: resolveSpeechVocabulary({
        personal: settings.speechCustomWords,
        project: [],
        hints: [projectName],
      }),
      speechRemoveFillerWords: settings.speechRemoveFillerWords,
      speechSilenceFiltering: settings.speechSilenceFiltering,
    },
    Streaming: settings.speechStreaming,
  };
}

// Follows start in apps/web/src/speech/useEnvironmentSpeechInput.ts: the destination's status is
// read fresh first, and a missing model points to Voice settings instead of recording.
export function* startDictation(draft: IEnvironment, threadId: string, text: IDictationDraft) {
  const state = yield* held(draft);
  if (state.Phase !== "idle" && state.Phase !== "error") return;
  if (draft.Local.Preferences.VoiceDestination === null) {
    yield* openView(draft, { Kind: "settings", Page: "voice" });
    return;
  }
  if (draft.Local.Preferences.VoiceDestination !== "server") return;
  Object.assign(state, { ...IDLE, ThreadId: threadId, Phase: "preparing" });
  let status;
  try {
    status = yield* open(voiceStatusEffect());
  } catch (error) {
    const { message } = serverError(error);
    if (yield* stillPreparing(draft, threadId)) yield* fail(draft, threadId, message, "retry");
    return;
  }
  if (!(yield* stillPreparing(draft, threadId))) return;
  if (!status.supported) {
    yield* fail(draft, threadId, status.reason, null);
    return;
  }
  if (status.state === "missing-model") {
    yield* fail(draft, threadId, MISSING_MODEL, "settings");
    return;
  }
  const options = yield* recordingOptions(draft, threadId);
  yield* resource(draft, "Voice/Dictation").start({ ThreadId: threadId, Draft: text, ...options });
}

function* stillPreparing(draft: IEnvironment, threadId: string): IActionGenerator<boolean> {
  const state = yield* held(draft);
  return state.Phase === "preparing" && state.ThreadId === threadId;
}

export function* stopDictation(draft: IEnvironment): IActionGenerator {
  if ((yield* held(draft)).Phase === "recording") yield* resource(draft, "Voice/Dictation").stop();
}

export function* cancelDictation(draft: IEnvironment): IActionGenerator {
  const state = yield* held(draft);
  if (state.Phase === "idle") return;
  Object.assign(state, IDLE);
  yield* resource(draft, "Voice/Dictation").cancel();
}

/** Follows submitAfterDictation in apps/web/src/speech/useEnvironmentSpeechInput.ts. */
export function* sendAfterDictation(
  draft: IEnvironment,
  threadId: string,
  mode: IDispatchMode,
): IActionGenerator {
  const state = yield* held(draft);
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
  if (destination !== "server") yield* cancelDictation(draft);
}

/** A deleted thread's recording has nowhere to go. */
export function* dropDictation(draft: IEnvironment, threadId: string): IActionGenerator {
  if ((yield* held(draft)).ThreadId === threadId) yield* cancelDictation(draft);
}

export function* dictation(draft: IEnvironment): ISelectorGenerator<IDictation> {
  return yield* held(draft);
}

export const DictationReceiver = receiver<IEnvironment>("DictationReceiver")({
  *"Voice/Dictation"(draft, message) {
    const state = yield* held(draft);
    if (isEnded(message)) {
      Object.assign(state, IDLE);
      return;
    }
    yield* apply(draft, message);
  },
});

function* apply(draft: IEnvironment, message: IDictationMessage): IActionGenerator {
  const state = yield* held(draft);
  if (message.Kind === "commit") {
    const session = draft.Local.ThreadSessions[message.ThreadId];
    if (session === undefined || session.Draft !== message.Before) {
      yield* fail(draft, message.ThreadId, STALE_DRAFT, "retry");
      (yield* held(draft)).HoldError = true;
      return;
    }
    yield* start(setDraft, session, message.Text);
    if (state.SubmitMode !== null) yield* start(send, session, state.SubmitMode);
    state.SubmitMode = null;
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
