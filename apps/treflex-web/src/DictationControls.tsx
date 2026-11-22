// @effect-diagnostics globalTimers:off -- A view-only elapsed-time tick while recording, outside any Effect runtime.
import { MICROPHONE_PERMISSION_ERROR } from "@t3tools/client-runtime/voice-input";
import type { SpeechStreamText } from "@t3tools/contracts";
import { useResource } from "treflex-solid";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";

import { type IDictation, MISSING_MODEL, STALE_DRAFT } from "./Dictation";
import Environment from "./Environment";
import { canCaptureVoice } from "./Infrastructure/dictation";
import { Check, CircleAlert, LoaderCircle, Mic, X } from "./icons";
import { clockNow } from "./timestamps";
import { IconButton } from "./ui/IconButton";
import { createMediaQuery } from "./viewport";

// iOS can fire mousedown after a prevented pointerdown, and its default blurs the prompt.
const keepFocus = (event: MouseEvent) => event.preventDefault();

const PILL =
  "flex h-8 min-w-0 max-w-fit flex-[1.5_1_0] items-center gap-1.5 rounded-full p-0.5 ring-1 ring-inset";
const PILL_IDLE = `${PILL} bg-muted/48 ring-border`;
const PILL_ERROR = `${PILL} bg-destructive/6 text-error-foreground ring-destructive/24`;
const PILL_BUTTON = "rounded-full";

// Follows VOICE_ERROR_LABELS in apps/web/src/components/chat/VoiceInputErrorPill.tsx.
const ERROR_LABELS: Record<string, string> = {
  [MICROPHONE_PERMISSION_ERROR]: "Mic blocked",
  "Microphone access is required for voice input.": "Mic blocked",
  "This draft is no longer available.": "Draft unavailable",
  "Another voice recording is already active.": "Already recording",
  "Voice transcription is not available.": "Voice input unavailable",
  "Voice transcription is still finishing. Try again shortly.": "Still transcribing",
  "Voice transcription is not available for this language.": "Language unsupported",
  "Could not prepare voice transcription.": "Couldn’t start",
  "Could not start voice recording.": "Couldn’t start",
  "Voice recording was interrupted.": "Recording interrupted",
  "Could not finish voice recording.": "Couldn’t finish",
  "Could not transcribe this recording.": "Transcription failed",
  "Voice transcription on this environment failed.": "Transcription failed",
  [STALE_DRAFT]: "Draft changed",
  "No speech was detected.": "No speech heard",
  "Microphone processing failed.": "Mic failed",
  "The microphone disconnected.": "Mic disconnected",
  [MISSING_MODEL]: "No model installed",
};

const RETRYABLE_TRANSCRIPTIONS = new Set([
  "Could not transcribe this recording.",
  "Voice transcription on this environment failed.",
]);

/** Whether this client offers dictation: not turned off, a server that transcribes, a browser that captures. */
export function useVoiceOffered() {
  const environment = Environment.use();
  return () =>
    environment.state.Local.Preferences.VoiceDestination !== "off" &&
    environment.state.Replica.Config?.environment.capabilities.voiceTranscription === true &&
    canCaptureVoice();
}

export function MicButton(props: {
  shortcut: string | null;
  disabled: boolean;
  onStart: () => void;
}) {
  const label = () => `Start voice input${props.shortcut ? ` (${props.shortcut})` : ""}`;
  return (
    <IconButton
      aria-label="Start voice input"
      data-tip={label()}
      disabled={props.disabled}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={() => props.onStart()}
    >
      <Mic />
    </IconButton>
  );
}

function useLive() {
  const environment = Environment.use();
  return useResource(() => environment.state, "Voice/Dictation");
}

const BARS = Array.from({ length: 24 }, (_, index) => index);

// The bars are written directly, so a level many times a second never reaches Solid.
function Waveform() {
  const live = useLive();
  const still = createMediaQuery("(prefers-reduced-motion: reduce)");
  const bars: HTMLSpanElement[] = [];
  const levels = BARS.map(() => 0);
  createEffect(() => {
    const value = live.value();
    if (value === undefined) return;
    const reduced = still();
    const draw = () => {
      levels.copyWithin(0, 1);
      levels[levels.length - 1] = value.level();
      bars.forEach((bar, index) => {
        const level = levels[index] ?? 0;
        bar.style.opacity = String(0.3 + level * 0.55);
        bar.style.transform = `scaleY(${reduced ? 0.4 : Math.max(0.2, level)})`;
      });
    };
    onCleanup(value.subscribe(draw));
  });
  return (
    <div
      aria-hidden="true"
      class="flex h-4 min-w-0 flex-1 items-center justify-end gap-0.5 overflow-hidden"
    >
      <For each={BARS}>
        {(index) => (
          <span
            ref={(bar) => (bars[index] = bar)}
            class="h-full w-0.5 shrink-0 origin-center scale-y-20 rounded-full bg-foreground opacity-35 transition-[transform,opacity] duration-100 ease-out motion-reduce:transition-none"
          />
        )}
      </For>
    </div>
  );
}

const elapsedLabel = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function Elapsed(props: { startedAt: number | null }) {
  const [now, setNow] = createSignal(clockNow());
  const timer = setInterval(() => setNow(clockNow()), 500);
  onCleanup(() => clearInterval(timer));
  const seconds = () => Math.max(0, Math.floor((now() - (props.startedAt ?? now())) / 1_000));
  return (
    <span class="shrink-0 text-[12px] text-muted-foreground tabular-nums">
      {elapsedLabel(seconds())}
    </span>
  );
}

// Follows ComposerSpeechRecordingPill and VoiceInputErrorPill in apps/web/src/components/chat.
export function DictationPill(props: { dictation: IDictation; onRetry: () => void }) {
  const environment = Environment.use();
  const phase = () => props.dictation.Phase;
  const cancel = () => void environment.cancelDictation();
  return (
    <Show
      when={phase() !== "error"}
      fallback={
        <div class={PILL_ERROR}>
          <IconButton
            class={PILL_BUTTON}
            aria-label="Dismiss voice input error"
            data-tip="Dismiss"
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={cancel}
          >
            <X />
          </IconButton>
          <span
            role="status"
            aria-label={props.dictation.Error ?? "Voice input failed"}
            data-tip={props.dictation.Error ?? undefined}
            class="flex min-w-0 items-center gap-1.5 text-[13px] font-medium [&_svg]:size-3.5 [&_svg]:shrink-0"
          >
            <CircleAlert />
            <span class="truncate">
              {ERROR_LABELS[props.dictation.Error ?? ""] ?? "Voice input failed"}
            </span>
          </span>
          <Show when={props.dictation.ErrorAction} fallback={<span class="w-1.5 shrink-0" />}>
            <button
              type="button"
              class="ms-auto h-7 shrink-0 cursor-pointer rounded-full border border-input bg-popover px-2.5 text-[13px] font-medium text-foreground hover:bg-accent"
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={() => {
                if (props.dictation.ErrorAction === "settings") {
                  cancel();
                  void environment.openView({ Kind: "settings", Page: "voice" });
                } else props.onRetry();
              }}
            >
              {props.dictation.ErrorAction === "settings"
                ? "Settings"
                : RETRYABLE_TRANSCRIPTIONS.has(props.dictation.Error ?? "")
                  ? "Retry"
                  : "Record again"}
            </button>
          </Show>
        </div>
      }
    >
      <div class={PILL_IDLE}>
        <IconButton
          class={PILL_BUTTON}
          aria-label="Cancel voice input"
          data-tip="Cancel voice input (Esc)"
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={cancel}
        >
          <X />
        </IconButton>
        <div
          class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden data-[trailing=false]:pe-2.5"
          data-trailing={phase() === "recording" ? "true" : "false"}
          role="status"
          aria-live={phase() === "recording" ? "off" : "polite"}
          aria-label={
            phase() === "recording"
              ? "Recording"
              : phase() === "transcribing"
                ? "Transcribing…"
                : "Starting…"
          }
        >
          <Show
            when={phase() === "recording"}
            fallback={
              <>
                <LoaderCircle class="size-4 shrink-0 animate-spin text-muted-foreground" />
                <span class="min-w-0 truncate text-[14px] text-muted-foreground">
                  {phase() === "transcribing" ? "Transcribing…" : "Starting…"}
                </span>
              </>
            }
          >
            <span aria-hidden="true" class="size-2 shrink-0 rounded-full bg-destructive" />
            <Elapsed startedAt={props.dictation.StartedAt} />
            <div class="me-1.5 flex w-16 min-w-0 shrink grow">
              <Waveform />
            </div>
          </Show>
        </div>
        <Show when={phase() === "recording"}>
          <button
            type="button"
            class="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-primary p-0 text-primary-foreground hover:bg-[color-mix(in_srgb,var(--primary)_90%,var(--background))] [&_svg]:size-4"
            aria-label="Finish voice input"
            data-tip="Finish voice input"
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => void environment.stopDictation()}
          >
            <Check />
          </button>
        </Show>
      </div>
    </Show>
  );
}

/** The live transcript while a streaming model listens. */
export function DictationPreview() {
  const live = useLive();
  const [preview, setPreview] = createSignal<SpeechStreamText | null>(null);
  createEffect(() => {
    const value = live.value();
    if (value === undefined) return;
    setPreview(value.preview());
    onCleanup(value.subscribe(() => setPreview(value.preview())));
  });
  return (
    <Show when={preview()}>
      {(text) => (
        <div
          aria-label="Live transcription"
          class="mx-3 mb-2 flex max-h-32 flex-col-reverse overflow-y-auto rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[14px] leading-relaxed break-words whitespace-pre-wrap"
        >
          <div>
            <span>{text().committed}</span>
            <span class="text-muted-foreground">{text().tentative}</span>
          </div>
        </div>
      )}
    </Show>
  );
}

/** Shows a recording whose thread isn't on screen, so it can be finished or returned to. */
export function DictationIndicator() {
  const environment = Environment.use();
  const held = () => environment.dictation();
  const threadId = () => held().ThreadId;
  const offScreen = () =>
    threadId() !== null &&
    held().Phase !== "idle" &&
    (environment.state.Local.SelectedThreadId !== threadId() ||
      environment.state.Local.View !== null);
  const title = () => {
    const id = threadId();
    return id === null ? "" : (environment.state.Replica.Shell.Threads[id]?.title ?? "New thread");
  };
  const retry = () => {
    const id = threadId();
    const text = id === null ? undefined : environment.state.Local.ThreadSessions[id]?.Draft;
    if (id !== null && text !== undefined)
      void environment.startDictation(id, { Text: text, Start: text.length, End: text.length });
  };
  return (
    <Show when={offScreen()}>
      <div class="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+12px)] z-100 flex justify-center px-4">
        <div class="pointer-events-auto flex max-w-full items-center gap-1 rounded-full bg-popover p-0.5 shadow-lg/5 ring-1 ring-border">
          <button
            type="button"
            class="h-8 min-w-0 shrink cursor-pointer truncate rounded-full border-0 bg-transparent px-3 text-[14px] font-medium hover:bg-accent"
            onClick={() => void environment.selectThread(threadId()!)}
          >
            {title()}
          </button>
          <DictationPill dictation={held()} onRetry={retry} />
        </div>
      </div>
    </Show>
  );
}
