// @effect-diagnostics globalTimers:off -- A view-only poll of a model download's progress, as stock's setup dialog polls.
import type { EnvironmentSpeechModel } from "@t3tools/contracts";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";

import Environment from "./Environment";
import { errorText } from "./errorText";
import { canCaptureVoice, voiceModelCommand, voiceModels } from "./Infrastructure/dictation";
import type { IVoiceDestination } from "./Infrastructure/preferences";
import { SettingsRowFrame, SettingsSection } from "./SettingsView";
import { Button } from "./ui/Button";
import { Select } from "./ui/Field";

const megabytes = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;

function modelState(model: EnvironmentSpeechModel): string {
  switch (model.state) {
    case "installed":
      return model.active ? "Installed and in use." : "Installed.";
    case "downloading":
      return `Downloading… ${Math.round(((model.downloaded ?? 0) / Math.max(1, model.size)) * 100)}%`;
    case "verifying":
      return "Verifying the download…";
    case "downloadable":
      return `Not downloaded. Downloads ${megabytes(model.size)} to this server.`;
  }
}

// Follows the transcription destination and models sections of
// apps/web/src/components/settings/VoiceSettingsPanel.tsx, for this client's one environment.
export function VoiceSetup() {
  const environment = Environment.use();
  const destination = () => environment.state.Local.Preferences.VoiceDestination;
  const supported = () =>
    environment.state.Replica.Config?.environment.capabilities.voiceTranscription === true;
  const [models, setModels] = createSignal<readonly EnvironmentSpeechModel[] | null>(null);
  const [picked, setPicked] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [downloading, setDownloading] = createSignal(false);
  const refresh = async () => {
    try {
      setModels((await voiceModels()).models);
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  createEffect(() => {
    if (destination() === "server" && supported()) void refresh();
  });
  createEffect(() => {
    if (!downloading()) return;
    const timer = setInterval(() => void refresh(), 1_000);
    onCleanup(() => clearInterval(timer));
  });
  const active = () => models()?.find((model) => model.active) ?? null;
  const chosen = () =>
    models()?.find((model) => model.id === (picked() ?? active()?.id)) ?? ordered()[0] ?? null;
  const ordered = () =>
    [...(models() ?? [])].sort(
      (a, b) =>
        Number(b.state === "installed") - Number(a.state === "installed") ||
        Number(b.recommended) - Number(a.recommended),
    );
  const download = async (model: EnvironmentSpeechModel) => {
    setError(null);
    setDownloading(true);
    try {
      const after = await voiceModelCommand("download", model.id);
      const installed = after.models.some(
        (held) => held.id === model.id && held.state === "installed",
      );
      setModels(
        installed && !model.active
          ? (await voiceModelCommand("select", model.id)).models
          : after.models,
      );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setDownloading(false);
    }
  };
  const use = async (model: EnvironmentSpeechModel) => {
    setError(null);
    try {
      setModels((await voiceModelCommand("select", model.id)).models);
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  const cancel = async (model: EnvironmentSpeechModel) => {
    try {
      setModels((await voiceModelCommand("cancel", model.id)).models);
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  return (
    <SettingsSection title="Voice input">
      <SettingsRowFrame
        settingId="voiceDestination"
        title="Transcribe with"
        description={
          supported()
            ? `Where your speech is turned into text. ${environment.state.Label} transcribes it with a model on that machine; audio goes nowhere else.`
            : `${environment.state.Label} can't transcribe audio on this platform.`
        }
        control={
          <Select
            class="min-w-44"
            aria-label="Transcribe with"
            value={destination() ?? ""}
            onChange={(event) =>
              void environment.setVoiceDestination(event.currentTarget.value as IVoiceDestination)
            }
          >
            <Show when={destination() === null}>
              <option value="" disabled>
                Choose…
              </option>
            </Show>
            <option value="server" disabled={!supported()}>
              {environment.state.Label}
            </option>
            <option value="off">Off</option>
          </Select>
        }
      />
      <Show when={!canCaptureVoice()}>
        <SettingsRowFrame
          title="This browser can't record here"
          description="Dictation needs a secure page (HTTPS or localhost) and a browser with microphone access."
        />
      </Show>
      <Show when={destination() === "server" && supported()}>
        <SettingsRowFrame
          settingId="voiceModel"
          title="Model"
          description={
            <>
              {error() ?? (chosen() === null ? "Loading models…" : modelState(chosen()!))}
              <Show when={chosen()?.description}>
                {(text) => <span class="mt-1 block">{text()}</span>}
              </Show>
            </>
          }
          control={
            <>
              <Select
                class="max-w-64 min-w-44"
                aria-label="Transcription model"
                disabled={models() === null || downloading()}
                value={chosen()?.id ?? ""}
                onChange={(event) => setPicked(event.currentTarget.value)}
              >
                <For each={ordered()}>
                  {(model) => (
                    <option value={model.id}>
                      {model.name}
                      {model.recommended ? " (recommended)" : ""}
                      {model.state === "installed" ? "" : ` · ${megabytes(model.size)}`}
                    </option>
                  )}
                </For>
              </Select>
              <Show when={chosen()}>
                {(model) => (
                  <Show
                    when={model().state === "downloadable"}
                    fallback={
                      <Show
                        when={model().state === "downloading"}
                        fallback={
                          <Show when={model().state === "installed" && !model().active}>
                            <Button onClick={() => void use(model())}>Use</Button>
                          </Show>
                        }
                      >
                        <Button onClick={() => void cancel(model())}>Cancel</Button>
                      </Show>
                    }
                  >
                    <Button variant="primary" onClick={() => void download(model())}>
                      Download
                    </Button>
                  </Show>
                )}
              </Show>
            </>
          }
        />
      </Show>
    </SettingsSection>
  );
}
