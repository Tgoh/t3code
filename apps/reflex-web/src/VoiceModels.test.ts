import { createTestRuntime, settled } from "treflex";
import { describe, expect, it } from "vite-plus/test";

import type { IVoiceModel } from "./Infrastructure/dictation";
import { ServerError } from "./Infrastructure/serverError";
import { watchRuntime } from "./testing/watchRuntime";
import {
  downloadModel,
  getDefaultVoiceModels,
  type IVoiceModels,
  loadModels,
  POLL_MS,
  selectModel,
  VoiceModelsReceiver,
} from "./VoiceModels";

const ID = "Voice";

const model = (id: string, state: IVoiceModel["state"], active = false) =>
  ({ id, name: id, description: "", size: 100, state, active, recommended: false }) as IVoiceModel;

interface ICommand {
  Command: string;
  ModelId: string;
}

function rig(catalog: () => IVoiceModel[], command: (effect: ICommand) => unknown = () => []) {
  const commands: ICommand[] = [];
  const runtime = createTestRuntime<IVoiceModels>(
    { $Id: ID, ...getDefaultVoiceModels() },
    {
      voiceModels: catalog,
      voiceModelCommand: (effect: ICommand) => {
        commands.push({ Command: effect.Command, ModelId: effect.ModelId });
        return command(effect);
      },
    },
  );
  runtime.registerReceiver(VoiceModelsReceiver);
  const watch = watchRuntime(runtime);
  return {
    runtime,
    ...watch,
    commands,
    polling: () => runtime.timers(ID).some((row) => row.Key === "Voice/Poll"),
    tick: () =>
      runtime.dispatch(
        VoiceModelsReceiver.handle,
        ID,
        { Type: "Voice/Poll" },
        { publisher: { Id: ID } },
      ),
  };
}

describe("voice models", () => {
  it("polls while a model downloads, and stops in the tick that finds none", async () => {
    let catalog = [model("base", "downloading")];
    const voice = rig(() => catalog);
    await voice.runtime.dispatch(loadModels, ID);
    expect(voice.runtime.state.Models).toEqual(catalog);
    expect(voice.runtime.timers(ID)).toMatchObject([{ Key: "Voice/Poll", IntervalMs: POLL_MS }]);

    await voice.tick();
    expect(voice.polling()).toBe(true);
    catalog = [model("base", "installed", true)];
    await voice.tick();
    expect(voice.runtime.state.Models).toEqual(catalog);
    expect(voice.polling()).toBe(false);
  });

  it("refreshes progress during a download, then puts the downloaded model in use", async () => {
    let finish!: (models: IVoiceModel[]) => void;
    let catalog = [model("base", "downloadable")];
    const voice = rig(
      () => catalog,
      (effect) =>
        effect.Command === "download"
          ? new Promise<IVoiceModel[]>((resolve) => {
              finish = resolve;
            })
          : [model("base", "installed", true)],
    );
    const downloading = voice.runtime.dispatch(downloadModel, ID, "base");
    void voice.runtime.dispatch(downloadModel, ID, "base");
    await settled();
    expect(voice.commands).toEqual([{ Command: "download", ModelId: "base" }]);
    expect(voice.polling()).toBe(true);

    catalog = [model("base", "downloading")];
    await voice.tick();
    expect(voice.runtime.state.Models).toEqual(catalog);

    catalog = [model("base", "installed")];
    finish(catalog);
    await downloading;
    expect(voice.commands).toEqual([
      { Command: "download", ModelId: "base" },
      { Command: "select", ModelId: "base" },
    ]);
    expect(voice.runtime.state.Models).toEqual([model("base", "installed", true)]);
    catalog = [model("base", "installed", true)];
    await voice.tick();
    expect(voice.polling()).toBe(false);
  });

  it("shows a server's refusal, and sends a bug to the failure route", async () => {
    let fail: Error = new ServerError("Model not found.");
    const voice = rig(
      () => [],
      () => {
        throw fail;
      },
    );
    await voice.runtime.dispatch(selectModel, ID, "base");
    expect(voice.runtime.state.Error).toBe("Model not found.");

    fail = new TypeError("models is undefined");
    await expect(voice.runtime.dispatch(selectModel, ID, "base")).rejects.toThrow(TypeError);
    expect(voice.takeFailures()).toMatchObject([{ ActionName: "selectModel" }]);
  });
});
