import { createSignal, For, Show } from "solid-js";
import { useInFlight } from "treflex-solid";

import Dictation from "./Dictation";
import Environment from "./Environment";
import { canCaptureVoice, type IVoiceModel } from "./Infrastructure/dictation";
import type { IVoiceDestination } from "./Infrastructure/preferences";
import { SettingsRowFrame, SettingsSection } from "./SettingsView";
import { Button } from "./ui/Button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/Select";
import { downloadModel } from "./VoiceModels";

const rowSelect = "w-full md:w-auto md:min-w-44";

const megabytes = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;

const modelLabel = (model: IVoiceModel) =>
  `${model.name}${model.recommended ? " (recommended)" : ""}${
    model.state === "installed" ? "" : ` · ${megabytes(model.size)}`
  }`;

function modelState(model: IVoiceModel): string {
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
            value={destination()}
            onValueChange={(value) =>
              void environment.setVoiceDestination(value as IVoiceDestination)
            }
          >
            <SelectTrigger size="sm" class={rowSelect} aria-label="Transcribe with">
              <SelectValue placeholder="Choose…">
                {destination() === "server" ? environment.state.Label : "Off"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value="server" disabled={!supported()}>
                {environment.state.Label}
              </SelectItem>
              <SelectItem value="off">Off</SelectItem>
            </SelectPopup>
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
        <ModelRow />
      </Show>
    </SettingsSection>
  );
}

function ModelRow() {
  const voice = Dictation.use();
  const [picked, setPicked] = createSignal<string | null>(null);
  const downloading = useInFlight(downloadModel, () => voice.state);
  const models = () => voice.state.Models;
  const ordered = () =>
    [...(models() ?? [])].sort(
      (a, b) =>
        Number(b.state === "installed") - Number(a.state === "installed") ||
        Number(b.recommended) - Number(a.recommended),
    );
  const active = () => models()?.find((model) => model.active) ?? null;
  const chosen = () =>
    models()?.find((model) => model.id === (picked() ?? active()?.id)) ?? ordered()[0] ?? null;
  return (
    <SettingsRowFrame
      settingId="voiceModel"
      title="Model"
      description={
        <>
          {chosen() === null ? "Loading models…" : modelState(chosen()!)}
          <Show when={chosen()?.description}>
            {(text) => <span class="mt-1 block">{text()}</span>}
          </Show>
        </>
      }
      control={
        <>
          <Select
            value={chosen()?.id ?? null}
            disabled={models() === null || downloading()}
            onValueChange={setPicked}
          >
            <SelectTrigger
              size="sm"
              class={`${rowSelect} md:max-w-64`}
              aria-label="Transcription model"
            >
              <SelectValue>{chosen() === null ? "" : modelLabel(chosen()!)}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <For each={ordered()}>
                {(model) => <SelectItem value={model.id}>{modelLabel(model)}</SelectItem>}
              </For>
            </SelectPopup>
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
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void voice.selectModel(model().id)}
                        >
                          Use
                        </Button>
                      </Show>
                    }
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void voice.cancelDownload(model().id)}
                    >
                      Cancel
                    </Button>
                  </Show>
                }
              >
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void voice.downloadModel(model().id)}
                >
                  Download
                </Button>
              </Show>
            )}
          </Show>
        </>
      }
    />
  );
}
