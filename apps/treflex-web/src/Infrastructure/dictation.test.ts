import { VoiceTranscriptionError } from "@t3tools/client-runtime/voice-input";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createDictation,
  type IDictationHooks,
  type IDictationMessage,
  type IDictationRequest,
} from "./dictation";

function rig(transcribe: (uri: string) => Promise<string>) {
  const messages: IDictationMessage[] = [];
  let hooks!: IDictationHooks;
  let recordings = 0;
  let uri: string | null = null;
  const session = createDictation(
    (given) => {
      hooks = given;
      return {
        recorder: {
          get uri() {
            return uri;
          },
          prepareToRecordAsync: async () => {
            recordings += 1;
            uri = `blob:recording-${recordings}`;
          },
          record: () => undefined,
          stop: async () => undefined,
        },
        transcriber: {
          prepare: async () => ({ locale: "en", transcribe: (held) => transcribe(held) }),
        },
        cancelRecording: () => undefined,
        deleteRecording: () => undefined,
      };
    },
    (message) => messages.push(message),
  );
  const phases = () =>
    messages.flatMap((message) => (message.Kind === "state" ? [message.Phase] : []));
  const commits = () => messages.flatMap((message) => (message.Kind === "commit" ? [message] : []));
  return { session, messages, phases, commits, hooks: () => hooks, recordings: () => recordings };
}

const request = (text: string, start = text.length, end = start): IDictationRequest => ({
  ThreadId: "thread-1",
  Draft: { Text: text, Start: start, End: end },
  Options: {
    speechLanguage: "en",
    speechTranslateToEnglish: false,
    speechCustomWords: [],
    speechRemoveFillerWords: true,
    speechSilenceFiltering: true,
  },
  Streaming: true,
});

describe("dictation", () => {
  it("records, transcribes, and inserts the transcript at the caret with a space", async () => {
    const held = rig(async () => " the bug ");
    await held.session.start(request("Fix"));
    await held.session.stop();
    expect(held.phases()).toEqual(["preparing", "recording", "transcribing", "idle"]);
    expect(held.commits()).toEqual([
      { Kind: "commit", ThreadId: "thread-1", Before: "Fix", Text: "Fix the bug" },
    ]);
    const states = held.messages.filter((message) => message.Kind === "state");
    expect(states.at(-1)).toMatchObject({ ThreadId: null, Phase: "idle" });
    expect(states[1]).toMatchObject({ ThreadId: "thread-1", Phase: "recording" });
  });

  it("replaces a selection, and spaces before following text", async () => {
    const held = rig(async () => "quickly");
    await held.session.start(request("Fix it slowly now", 7, 13));
    await held.session.stop();
    expect(held.commits()[0]!.Text).toBe("Fix it quickly now");

    const before = rig(async () => "Please");
    await before.session.start(request("fix it", 0));
    await before.session.stop();
    expect(before.commits()[0]!.Text).toBe("Please fix it");
  });

  it("says when nothing was heard, and commits nothing", async () => {
    const held = rig(async () => "   ");
    await held.session.start(request(""));
    await held.session.stop();
    expect(held.commits()).toEqual([]);
    expect(held.messages.at(-1)).toMatchObject({
      Phase: "error",
      Error: "No speech was detected.",
      ErrorAction: "retry",
    });
  });

  it("retries a failed transcription from the same recording", async () => {
    const transcribe = vi
      .fn<(uri: string) => Promise<string>>()
      .mockRejectedValueOnce(
        new VoiceTranscriptionError({ code: "transcription-failed", message: "Server busy." }),
      )
      .mockResolvedValueOnce("hello");
    const held = rig(transcribe);
    await held.session.start(request(""));
    await held.session.stop();
    expect(held.messages.at(-1)).toMatchObject({ Phase: "error", Error: "Server busy." });

    await held.session.start(request(""));
    expect(held.recordings()).toBe(1);
    expect(transcribe.mock.calls.map(([uri]) => uri)).toEqual([
      "blob:recording-1",
      "blob:recording-1",
    ]);
    expect(held.commits()[0]!.Text).toBe("hello");
  });

  it("keeps the microphone for its thread, and a cancel drops the recording", async () => {
    const transcribe = vi.fn(async () => "never");
    const held = rig(transcribe);
    await held.session.start(request("one"));
    await held.session.start({ ...request("two"), ThreadId: "thread-2" });
    expect(held.phases()).toEqual(["preparing", "recording"]);
    held.session.cancel();
    expect(held.phases().at(-1)).toBe("idle");
    expect(transcribe).not.toHaveBeenCalled();
    expect(held.commits()).toEqual([]);
  });

  it("shows live text and level while recording, and clears them when it ends", async () => {
    const held = rig(async () => "done");
    const seen = vi.fn();
    held.session.live.subscribe(seen);
    await held.session.start(request(""));
    held.hooks().onLevel(0.5);
    held.hooks().onText({ committed: "hel", tentative: "lo" });
    expect(held.session.live.level()).toBe(0.5);
    expect(held.session.live.preview()).toEqual({ committed: "hel", tentative: "lo" });
    await held.session.stop();
    expect(held.session.live.level()).toBe(0);
    expect(held.session.live.preview()).toBeNull();
    expect(seen).toHaveBeenCalled();
  });

  it("an interrupted capture becomes an error the person can retry", async () => {
    const held = rig(async () => "unused");
    await held.session.start(request(""));
    held.hooks().onError("The microphone disconnected.");
    expect(held.messages.at(-1)).toMatchObject({
      Phase: "error",
      Error: "The microphone disconnected.",
      ErrorAction: "retry",
    });
  });
});
