// @effect-diagnostics globalTimers:off - the capture's deadlines are browser callbacks outside any Effect.
import {
  openSpeechStream,
  throwIfVoiceTranscriptionAborted,
  VoiceInputController,
  voiceInputBlocksSubmission,
  type VoiceInputPhase,
  type VoiceInputState,
  type VoiceRecorder,
  VoiceTranscriptionError,
  type VoiceTranscriber,
  type VoiceTranscriptionOptions,
  type PreparedVoiceTranscription,
  type VoiceStreamingSession,
} from "@t3tools/client-runtime/voice-input";
import {
  type EnvironmentSpeechModels,
  type EnvironmentSpeechStatus,
  SPEECH_STREAM_PATH,
  type SpeechStreamText,
  type SpeechTranscriptionOptions,
} from "@t3tools/contracts";
import { effectiveSpeechLanguage, encodeSpeechPcmRequest } from "@t3tools/shared/speech";
import * as Schema from "effect/Schema";
import { defineEffect, type IEffect, implementation, type IResourceImplementation } from "treflex";

import { ServerError, serverFetch } from "./serverError";
import type { Wire } from "./wire";
import workletUrl from "./speech/pcmWorklet.ts?worker&url";

export interface IDictationDraft {
  Text: string;
  Start: number;
  End: number;
}

export interface IDictationRequest {
  ThreadId: string;
  Draft: IDictationDraft;
  Options: SpeechTranscriptionOptions;
  Streaming: boolean;
}

export type IDictationMessage =
  | {
      Kind: "state";
      ThreadId: string | null;
      Phase: VoiceInputPhase;
      Error: string | null;
      ErrorAction: VoiceInputState["errorAction"];
    }
  /** The whole draft with the transcript inserted, made against `Before`. */
  | { Kind: "commit"; ThreadId: string; Before: string; Text: string };

/** What the recording composer reads many times a second, kept out of state. */
export interface IDictationLive {
  level(): number;
  preview(): SpeechStreamText | null;
  subscribe(listener: () => void): () => void;
}

declare module "treflex" {
  interface IResourceTypeRegistry {
    dictation: {
      Params: {};
      Message: IDictationMessage;
      Methods: {
        start(request: IDictationRequest): void;
        stop(): void;
        cancel(): void;
      };
      Value: IDictationLive;
    };
  }
}

interface IVoiceStatusEffect extends IEffect {
  Type: "voiceStatus";
}

export const voiceStatusEffect = defineEffect<IVoiceStatusEffect, EnvironmentSpeechStatus>(
  "voiceStatus",
);

export const voiceStatusImpl = implementation(voiceStatusEffect, (_effect, action) =>
  voiceJson<EnvironmentSpeechStatus>("/api/voice/status", { signal: action?.signal ?? null }),
);

async function voiceJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await serverFetch(path, { ...init, redirect: "error" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    throw new ServerError(
      typeof body?.message === "string" && body.message.trim() !== ""
        ? body.message
        : `Voice request failed with HTTP ${response.status}.`,
    );
  }
  return (await response.json()) as T;
}

export type IVoiceModel = Wire<EnvironmentSpeechModels["models"][number]>;

interface IVoiceModelsEffect extends IEffect {
  Type: "voiceModels";
}

/** The server's model catalog, for Voice settings. */
export const voiceModelsEffect = defineEffect<IVoiceModelsEffect, IVoiceModel[]>("voiceModels");

export const voiceModelsImpl = implementation(voiceModelsEffect, async (_effect, action) =>
  modelList(
    await voiceJson<EnvironmentSpeechModels>("/api/voice/models", {
      signal: action?.signal ?? null,
    }),
  ),
);

interface IVoiceModelCommandEffect extends IEffect {
  Type: "voiceModelCommand";
  Command: "download" | "select" | "cancel";
  ModelId: string;
}

/** Answers with the catalog after the command. A download answers once it has finished. */
export const voiceModelCommandEffect = defineEffect<IVoiceModelCommandEffect, IVoiceModel[]>(
  "voiceModelCommand",
);

export const voiceModelCommandImpl = implementation(voiceModelCommandEffect, async (effect) =>
  modelList(
    await voiceJson<EnvironmentSpeechModels>(`/api/voice/models/${effect.Command}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelId: effect.ModelId }),
    }),
  ),
);

const modelList = (catalog: EnvironmentSpeechModels) => catalog.models as IVoiceModel[];

export interface IDictationHooks {
  request(): IDictationRequest | null;
  onLevel(level: number): void;
  onText(text: SpeechStreamText): void;
  onError(message: string): void;
  onDurationLimit(): void;
}

export interface IDictationPlatform {
  recorder: VoiceRecorder;
  transcriber: VoiceTranscriber;
  cancelRecording(): void;
  deleteRecording(uri: string): void;
}

/**
 * One microphone for the whole client. The recording belongs to the thread that started it,
 * so it keeps going when another thread is selected and its transcript lands in that thread's draft.
 */
export function createDictation(
  makePlatform: (hooks: IDictationHooks) => IDictationPlatform,
  emit: (message: IDictationMessage) => void,
) {
  let request: IDictationRequest | null = null;
  let level = 0;
  let preview: SpeechStreamText | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();
  const publish = (next: { level?: number; preview?: SpeechStreamText | null }) => {
    if (next.level !== undefined) level = next.level;
    if (next.preview !== undefined) preview = next.preview;
    for (const listener of listeners) listener();
  };
  let controller!: VoiceInputController;
  const platform = makePlatform({
    request: () => request,
    onLevel: (next) => publish({ level: next }),
    onText: (text) => {
      if (!disposed) publish({ preview: text });
    },
    onError: (message) => {
      if (!disposed) void controller.interruptRecording(message);
    },
    onDurationLimit: () => void controller.stop(),
  });
  controller = new VoiceInputController({
    retryFailedRecording: true,
    recorder: platform.recorder,
    getTranscriber: () => platform.transcriber,
    requestPermission: async () => ({ granted: true, canAskAgain: true }),
    configureRecording: async () => undefined,
    releaseRecording: async () => platform.cancelRecording(),
    deleteRecording: platform.deleteRecording,
    // Recording freezes the composer, so the draft read at the end is the one read at the start.
    readDraft: () =>
      request === null
        ? null
        : {
            ownerKey: request.ThreadId,
            text: request.Draft.Text,
            selection: { start: request.Draft.Start, end: request.Draft.End },
          },
    commitDraft: (text) => {
      if (request !== null)
        emit({
          Kind: "commit",
          ThreadId: request.ThreadId,
          Before: request.Draft.Text,
          Text: text,
        });
    },
    onStateChange: (state) => {
      if (disposed) return;
      if (state.phase !== "recording" && state.phase !== "transcribing")
        publish({ level: 0, preview: null });
      emit({
        Kind: "state",
        ThreadId: state.phase === "idle" ? null : (request?.ThreadId ?? null),
        Phase: state.phase,
        Error: state.error,
        ErrorAction: state.errorAction,
      });
    },
  });
  return {
    live: {
      level: () => level,
      preview: () => preview,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } satisfies IDictationLive,
    start(next: IDictationRequest): Promise<void> {
      if (disposed) return Promise.resolve();
      const state = controller.currentState;
      if (voiceInputBlocksSubmission(state) && request?.ThreadId !== next.ThreadId)
        return Promise.resolve();
      request = next;
      publish({ level: 0, preview: null });
      return controller.start();
    },
    stop: () => controller.stop(),
    cancel: () => controller.cancel(),
    dispose() {
      controller.dispose();
      disposed = true;
      listeners.clear();
    },
  };
}

const isVoiceTranscriptionError = Schema.is(VoiceTranscriptionError);

// Follows requestMicrophone in apps/web/src/speech/requestMicrophone.ts, on the default input.
async function requestMicrophone(signal: AbortSignal): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  if (signal.aborted) {
    stream.getTracks().forEach((track) => track.stop());
    signal.throwIfAborted();
  }
  return stream;
}

// iOS can leave a context created outside a tap suspended; a capture that never starts says so.
async function resumeContext(context: AudioContext) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      context.resume(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("The microphone didn't start. Tap the mic again.")),
          5_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeRecording(
  uri: string,
  options: SpeechTranscriptionOptions,
  { signal }: VoiceTranscriptionOptions,
) {
  try {
    const pcm = new Uint8Array(await (await fetch(uri, { signal })).arrayBuffer());
    const result = await voiceJson<{ text: string }>("/api/voice/transcribe", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: encodeSpeechPcmRequest(pcm, options),
      signal,
    });
    throwIfVoiceTranscriptionAborted(signal);
    return result.text;
  } catch (cause) {
    throwIfVoiceTranscriptionAborted(signal);
    if (isVoiceTranscriptionError(cause)) throw cause;
    throw new VoiceTranscriptionError({
      code: "transcription-failed",
      message: "Voice transcription failed. Check Settings → Voice.",
      cause,
    });
  }
}

async function speechStreamUrl(signal: AbortSignal) {
  const { ticket } = await voiceJson<{ ticket: string }>("/api/auth/websocket-ticket/media", {
    method: "POST",
    signal,
  });
  const url = new URL(SPEECH_STREAM_PATH, location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("wsTicket", ticket);
  return url.toString();
}

// Follows createBrowserVoiceInputPlatform in apps/web/src/speech/browserVoiceInput.ts for an
// environment destination, with plain cookie-session fetches in place of the HTTP API client.
async function prepareTranscription(
  hooks: IDictationHooks,
  options: VoiceTranscriptionOptions,
): Promise<PreparedVoiceTranscription & { streaming?: IFeedingStream }> {
  const request = hooks.request();
  if (request === null)
    throw new VoiceTranscriptionError({
      code: "unavailable",
      message: "Voice input has no draft to record into.",
    });
  const recordingOptions = request.Options;
  const status = await voiceJson<EnvironmentSpeechStatus>("/api/voice/status", {
    signal: options.signal,
  }).catch((cause: unknown) => {
    throwIfVoiceTranscriptionAborted(options.signal);
    throw new VoiceTranscriptionError({
      code: "unavailable",
      message: cause instanceof Error ? cause.message : "Could not reach voice transcription.",
    });
  });
  throwIfVoiceTranscriptionAborted(options.signal);
  if (!status.supported)
    throw new VoiceTranscriptionError({ code: "unavailable", message: status.reason });
  const language = status.languages
    ? effectiveSpeechLanguage(
        {
          languages: status.languages,
          supportsLanguageDetection: status.supportsLanguageDetection ?? false,
        },
        recordingOptions.speechLanguage,
      )
    : "auto";
  const nativeStreaming = status.supportsStreaming && request.Streaming;
  const locale =
    !nativeStreaming && status.supportsTranslation && recordingOptions.speechTranslateToEnglish
      ? "en"
      : language;
  const transcribe = (uri: string, transcription: VoiceTranscriptionOptions) =>
    transcribeRecording(uri, recordingOptions, transcription);
  if (status.supportsStreaming ? !nativeStreaming : !status.supportsBufferedStreaming)
    return { locale, transcribe };
  const url = await speechStreamUrl(options.signal);
  throwIfVoiceTranscriptionAborted(options.signal);
  return {
    locale,
    transcribe,
    streaming: openSpeechStream({
      url,
      canSend: () => true,
      options: recordingOptions,
      signal: options.signal,
      onText: hooks.onText,
      onError: (error) => hooks.onError(error.message),
    }),
  };
}

type IFeedingStream = VoiceStreamingSession & { readonly feed: (pcm: Float32Array) => void };

// Follows createBrowserPcmCapture in apps/web/src/speech/browserPcmCapture.ts.
export function browserDictationPlatform(hooks: IDictationHooks): IDictationPlatform {
  let stream: MediaStream | undefined;
  let recordingUri: string | null = null;
  let chunks: Float32Array<ArrayBuffer>[] = [];
  let audioContext: AudioContext | undefined;
  let worklet: AudioWorkletNode | undefined;
  let durationTimer: ReturnType<typeof setTimeout> | undefined;
  let signal: AbortSignal | undefined;
  let feed: ((pcm: Float32Array) => void) | undefined;
  let stopped:
    | { readonly resolve: () => void; readonly reject: (error: Error) => void }
    | undefined;

  const cleanupCapture = () => {
    if (durationTimer) clearTimeout(durationTimer);
    durationTimer = undefined;
    worklet?.disconnect();
    worklet?.port.close();
    worklet = undefined;
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    void audioContext?.close();
    audioContext = undefined;
    stopped?.resolve();
    stopped = undefined;
    chunks = [];
    feed = undefined;
    hooks.onLevel(0);
  };

  const recorder: VoiceRecorder = {
    get uri() {
      return recordingUri;
    },
    prepareToRecordAsync: async () => {
      const captureSignal = signal;
      if (!captureSignal) throw new Error("Voice transcription is not prepared.");
      captureSignal.throwIfAborted();
      if (recordingUri) URL.revokeObjectURL(recordingUri);
      recordingUri = null;
      chunks = [];
      const captured = await new Promise<MediaStream>((resolve, reject) => {
        const onAbort = () => reject(captureSignal.reason);
        captureSignal.addEventListener("abort", onAbort, { once: true });
        requestMicrophone(captureSignal).then(
          (media) => {
            captureSignal.removeEventListener("abort", onAbort);
            if (captureSignal.aborted) media.getTracks().forEach((track) => track.stop());
            else resolve(media);
          },
          (error: unknown) => {
            captureSignal.removeEventListener("abort", onAbort);
            reject(error);
          },
        );
      });
      stream = captured;
      try {
        const context = new AudioContext();
        audioContext = context;
        await context.audioWorklet.addModule(workletUrl);
        captureSignal.throwIfAborted();
        const node = new AudioWorkletNode(context, "t3-pcm-capture", { channelCount: 1 });
        worklet = node;
        node.port.onmessage = ({
          data,
        }: MessageEvent<Float32Array<ArrayBuffer> | number | "stopped" | "limit">) => {
          if (captureSignal.aborted) return;
          if (data === "stopped") {
            stopped?.resolve();
            return;
          }
          if (data === "limit") {
            hooks.onDurationLimit();
            return;
          }
          if (typeof data === "number") {
            hooks.onLevel(data);
            return;
          }
          if (feed) feed(data);
          else chunks.push(data);
        };
        node.onprocessorerror = () => {
          stopped?.reject(new Error("Microphone processing failed."));
          hooks.onError("Microphone processing failed.");
        };
        for (const track of captured.getTracks())
          track.addEventListener("ended", () => hooks.onError("The microphone disconnected."), {
            once: true,
          });
        context.createMediaStreamSource(captured).connect(node);
        // The processor emits silence, keeping the graph active without microphone playback.
        node.connect(context.destination);
        await resumeContext(context);
        captureSignal.throwIfAborted();
      } catch (error) {
        cleanupCapture();
        throw error;
      }
    },
    record: ({ forDuration }) => {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- AudioWorklet MessagePorts do not accept a target origin
      worklet?.port.postMessage("start");
      durationTimer = setTimeout(hooks.onDurationLimit, forDuration * 1_000);
    },
    stop: async () => {
      if (!worklet) return;
      if (signal?.aborted) {
        cleanupCapture();
        return;
      }
      const pending = new Promise<void>((resolve, reject) => {
        stopped = { resolve, reject };
      });
      const timeout = setTimeout(
        () => stopped?.reject(new Error("Microphone capture did not stop.")),
        5_000,
      );
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- AudioWorklet MessagePorts do not accept a target origin
      worklet.port.postMessage("stop");
      try {
        await pending;
        if (!feed && chunks.length) {
          recordingUri = URL.createObjectURL(
            new Blob(chunks, { type: "application/octet-stream" }),
          );
        }
      } finally {
        clearTimeout(timeout);
        cleanupCapture();
      }
    },
  };

  return {
    recorder,
    cancelRecording: cleanupCapture,
    deleteRecording: (uri) => {
      URL.revokeObjectURL(uri);
      if (recordingUri === uri) recordingUri = null;
    },
    transcriber: {
      prepare: async (options) => {
        const prepared = await prepareTranscription(hooks, options);
        options.signal.throwIfAborted();
        signal = options.signal;
        feed = prepared.streaming?.feed;
        return prepared;
      },
    },
  };
}

/** Whether this browser can capture: a secure origin with the microphone and audio worklets. */
export function canCaptureVoice(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    navigator.mediaDevices?.getUserMedia !== undefined &&
    typeof AudioWorkletNode !== "undefined"
  );
}

export const dictation: IResourceImplementation<"dictation"> = (_params, r) => {
  const session = createDictation(browserDictationPlatform, (message) => void r.emit(message));
  r.methods({
    start: (_ctx, request) => void session.start(request),
    stop: () => void session.stop(),
    cancel: () => session.cancel(),
  });
  r.expose(session.live);
  r.signal.addEventListener("abort", () => session.dispose());
};
