import { createRuntime } from "treflex";
import { TreflexProvider } from "treflex-solid";
import { render } from "solid-js/web";

import "@fontsource-variable/inter";
import "./styles.css";

import { App } from "./App";
import { EnvironmentReceiver } from "./Environment";
import { addressThreadImpl, setAddressThreadImpl } from "./Infrastructure/address";
import { commandOutput } from "./Infrastructure/commandOutput";
import {
  addProjectSettingsImpl,
  attachmentUrlImpl,
  browseFoldersImpl,
  cloneControlImpl,
  closeTerminalImpl,
  newProjectImpl,
  queueCommandImpl,
  respondRequestImpl,
  serverProvidersImpl,
  startCloneImpl,
  startTurnImpl,
  stopThreadImpl,
  projectCommandImpl,
  threadCommandImpl,
  threadDiffImpl,
} from "./Infrastructure/commandsImpl";
import { composerFiles } from "./Infrastructure/composerFiles";
import { environmentInfoImpl } from "./Infrastructure/environmentInfoImpl";
import { rememberedModelsImpl, rememberModelImpl } from "./Infrastructure/modelMemory";
import { pairFromUrl } from "./Infrastructure/pairing";
import { projectClones } from "./Infrastructure/projectClones";
import { shellStream } from "./Infrastructure/shellStream";
import { rememberedTerminalImpl, rememberTerminalImpl } from "./Infrastructure/terminalMemory";
import { terminalSession } from "./Infrastructure/terminalSession";
import { threadHistoryPageImpl } from "./Infrastructure/threadHistory";
import { threadStream } from "./Infrastructure/threadStream";
import { ThreadReceiver } from "./OpenThread";
import { getDefaultRoot, load, RootReceiver } from "./Root";
import { ShellReceiver } from "./Shell";
import { TerminalReceiver } from "./ThreadSession";

await pairFromUrl();

const runtime = createRuntime(getDefaultRoot("Root"), {
  // Takes what nothing else does, so the browser doesn't report it again as an unhandled rejection.
  onError: () => {},
});
runtime.on("failure", (failure) =>
  console.error(`[reflex-web] ${failure.ActionName} failed:`, failure.Error),
);
runtime.registerImplementation(environmentInfoImpl);
runtime.registerImplementation(threadHistoryPageImpl);
runtime.registerImplementation(startTurnImpl);
runtime.registerImplementation(stopThreadImpl);
runtime.registerImplementation(respondRequestImpl);
runtime.registerImplementation(serverProvidersImpl);
runtime.registerImplementation(queueCommandImpl);
runtime.registerImplementation(projectCommandImpl);
runtime.registerImplementation(addProjectSettingsImpl);
runtime.registerImplementation(browseFoldersImpl);
runtime.registerImplementation(startCloneImpl);
runtime.registerImplementation(cloneControlImpl);
runtime.registerImplementation(newProjectImpl);
runtime.registerImplementation(threadCommandImpl);
runtime.registerImplementation(threadDiffImpl);
runtime.registerImplementation(attachmentUrlImpl);
runtime.registerImplementation(closeTerminalImpl);
runtime.registerImplementation(rememberedTerminalImpl);
runtime.registerImplementation(rememberTerminalImpl);
runtime.registerImplementation(rememberedModelsImpl);
runtime.registerImplementation(rememberModelImpl);
runtime.registerResourceType("composerFiles", composerFiles);
runtime.registerResourceType("commandOutput", commandOutput);
runtime.registerResourceType("projectClones", projectClones);
runtime.registerResourceType("terminalSession", terminalSession);
runtime.registerImplementation(addressThreadImpl);
runtime.registerImplementation(setAddressThreadImpl);
runtime.registerResourceType("shellStream", shellStream, { endOnReceiverFailure: true });
runtime.registerResourceType("threadStream", threadStream, { endOnReceiverFailure: true });
runtime.registerReceiver(RootReceiver);
runtime.registerReceiver(EnvironmentReceiver);
runtime.registerReceiver(ShellReceiver);
runtime.registerReceiver(ThreadReceiver);
runtime.registerReceiver(TerminalReceiver);
void runtime.dispatch(load, "Root");

render(
  () => (
    <TreflexProvider value={runtime}>
      <App state={runtime.state} />
    </TreflexProvider>
  ),
  document.getElementById("root") as HTMLElement,
);
