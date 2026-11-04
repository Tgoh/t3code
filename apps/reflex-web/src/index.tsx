import { createRuntime } from "reflex";
import { ReflexProvider } from "reflex-solid";
import { render } from "solid-js/web";

import "@fontsource-variable/inter";
import "./styles.css";

import { App } from "./App";
import { EnvironmentReceiver } from "./Environment";
import { addressThreadImpl, setAddressThreadImpl } from "./Infrastructure/address";
import { commandOutput } from "./Infrastructure/commandOutput";
import {
  attachmentUrlImpl,
  closeTerminalImpl,
  queueCommandImpl,
  respondRequestImpl,
  serverProvidersImpl,
  startTurnImpl,
  stopThreadImpl,
  threadDiffImpl,
} from "./Infrastructure/commandsImpl";
import { composerFiles } from "./Infrastructure/composerFiles";
import { delayImpl } from "./Infrastructure/delay";
import { environmentInfoImpl } from "./Infrastructure/environmentInfoImpl";
import { pairFromUrl } from "./Infrastructure/pairing";
import { shellStream } from "./Infrastructure/shellStream";
import { rememberedTerminalImpl, rememberTerminalImpl } from "./Infrastructure/terminalMemory";
import { terminalSession } from "./Infrastructure/terminalSession";
import { threadHistoryPageImpl } from "./Infrastructure/threadHistory";
import { threadStream } from "./Infrastructure/threadStream";
import { ThreadReceiver } from "./OpenThread";
import { getDefaultRoot, load } from "./Root";
import { ShellReceiver } from "./Shell";
import { TerminalReceiver } from "./ThreadSession";

await pairFromUrl();

const runtime = createRuntime(getDefaultRoot("Root"), {
  onError: (error: unknown) => console.error("[reflex-web] action failed:", error),
});
runtime.registerImplementation(delayImpl);
runtime.registerImplementation(environmentInfoImpl);
runtime.registerImplementation(threadHistoryPageImpl);
runtime.registerImplementation(startTurnImpl);
runtime.registerImplementation(stopThreadImpl);
runtime.registerImplementation(respondRequestImpl);
runtime.registerImplementation(serverProvidersImpl);
runtime.registerImplementation(queueCommandImpl);
runtime.registerImplementation(threadDiffImpl);
runtime.registerImplementation(attachmentUrlImpl);
runtime.registerImplementation(closeTerminalImpl);
runtime.registerImplementation(rememberedTerminalImpl);
runtime.registerImplementation(rememberTerminalImpl);
runtime.registerResourceType("composerFiles", composerFiles);
runtime.registerResourceType("commandOutput", commandOutput);
runtime.registerResourceType("terminalSession", terminalSession);
runtime.registerImplementation(addressThreadImpl);
runtime.registerImplementation(setAddressThreadImpl);
runtime.registerResourceType("shellStream", shellStream);
runtime.registerResourceType("threadStream", threadStream);
runtime.registerReceiver(EnvironmentReceiver.Id, EnvironmentReceiver.handle);
runtime.registerReceiver(ShellReceiver.Id, ShellReceiver.handle);
runtime.registerReceiver(ThreadReceiver.Id, ThreadReceiver.handle);
runtime.registerReceiver(TerminalReceiver.Id, TerminalReceiver.handle);
void runtime.dispatch(load, "Root");

render(
  () => (
    <ReflexProvider value={runtime}>
      <App state={runtime.state} />
    </ReflexProvider>
  ),
  document.getElementById("root") as HTMLElement,
);
