import type { IRuntime } from "treflex";

import { ActivityReceiver } from "./Activity";
import { DictationReceiver } from "./Dictation";
import { EnvironmentReceiver } from "./Environment";
import { GitReceiver } from "./GitWork";
import { ThreadReceiver } from "./OpenThread";
import { PreferencesReceiver } from "./Preferences";
import { type IRoot, RootReceiver } from "./Root";
import { ShellReceiver } from "./Shell";
import { TerminalReceiver, TerminalShellReceiver } from "./Terminal";
import { RewindReceiver, StopReceiver } from "./ThreadSession";
import { VoiceModelsReceiver } from "./VoiceModels";

export function registerReceivers(runtime: IRuntime<IRoot>) {
  runtime.registerReceiver(RootReceiver);
  runtime.registerReceiver(EnvironmentReceiver);
  runtime.registerReceiver(ShellReceiver);
  runtime.registerReceiver(ThreadReceiver);
  runtime.registerReceiver(TerminalReceiver);
  runtime.registerReceiver(TerminalShellReceiver);
  runtime.registerReceiver(RewindReceiver);
  runtime.registerReceiver(StopReceiver);
  runtime.registerReceiver(GitReceiver);
  runtime.registerReceiver(PreferencesReceiver);
  runtime.registerReceiver(ActivityReceiver);
  runtime.registerReceiver(DictationReceiver);
  runtime.registerReceiver(VoiceModelsReceiver);
}
