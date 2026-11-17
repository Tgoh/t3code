import { createRuntime } from "treflex";
import { TreflexProvider } from "treflex-solid";
import { render } from "solid-js/web";

import "@fontsource-variable/inter";
import "./index.css";

import { App } from "./App";
import { EnvironmentReceiver } from "./Environment";
import { openExternalLinksInSafari } from "./externalLinks";
import {
  addressThreadImpl,
  addressViewImpl,
  setAddressThreadImpl,
  setAddressViewImpl,
} from "./Infrastructure/address";
import {
  archivedShellImpl,
  refreshUsageRatesImpl,
  serverConfigImpl,
  storeClientSettingsImpl,
  storedClientSettingsImpl,
  updateServerSettingsImpl,
  usageSummaryImpl,
} from "./Infrastructure/settingsImpl";
import { commandOutput } from "./Infrastructure/commandOutput";
import {
  addProjectSettingsImpl,
  assetUrlImpl,
  browseFoldersImpl,
  cloneControlImpl,
  closeTerminalImpl,
  newProjectImpl,
  openInEditorImpl,
  openInFileManagerImpl,
  queueCommandImpl,
  forkThreadImpl,
  respondRequestImpl,
  rewindImpl,
  searchEntriesImpl,
  searchThreadsImpl,
  modelFavoritesImpl,
  serverProvidersImpl,
  setModelFavoriteImpl,
  startCloneImpl,
  startTurnImpl,
  stopThreadImpl,
  projectCommandImpl,
  threadCommandImpl,
  threadDiffImpl,
} from "./Infrastructure/commandsImpl";
import { composerFiles } from "./Infrastructure/composerFiles";
import { delayImpl } from "./Infrastructure/delay";
import { environmentInfoImpl } from "./Infrastructure/environmentInfoImpl";
import {
  storeDraftFilesImpl,
  storeDraftImpl,
  storedDraftFilesImpl,
  storedDraftImpl,
  storedNewThreadImpl,
} from "./Infrastructure/draftMemory";
import { rememberedModelsImpl, rememberModelImpl } from "./Infrastructure/modelMemory";
import { pairFromUrl } from "./Infrastructure/pairing";
import { projectClones } from "./Infrastructure/projectClones";
import { projectFavicons } from "./Infrastructure/projectFavicons";
import { serverKeybindings } from "./Infrastructure/serverKeybindings";
import { shellStream } from "./Infrastructure/shellStream";
import { rememberedTerminalImpl, rememberTerminalImpl } from "./Infrastructure/terminalMemory";
import { sourceControlImplementations } from "./Infrastructure/sourceControlImpl";
import { terminalSession } from "./Infrastructure/terminalSession";
import { vcsStatus } from "./Infrastructure/vcsStatus";
import { threadHistoryPageImpl } from "./Infrastructure/threadHistory";
import { threadStream } from "./Infrastructure/threadStream";
import { appearance } from "./Infrastructure/appearance";
import {
  clockNowImpl,
  storedAppearanceMode,
  storedEditorImpl,
  storedPreferencesImpl,
  storeEditorImpl,
  storePreferencesImpl,
} from "./Infrastructure/preferences";
import { resolveScheme, SYSTEM_DARK_QUERY } from "./colorScheme";
import { PreferencesReceiver } from "./Preferences";
import { ThreadReceiver } from "./OpenThread";
import { getDefaultRoot, load, RootReceiver } from "./Root";
import { ShellReceiver } from "./Shell";
import { GitReceiver } from "./GitWork";
import { RewindReceiver, TerminalReceiver } from "./ThreadSession";

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
runtime.registerImplementation(rewindImpl);
runtime.registerImplementation(forkThreadImpl);
runtime.registerImplementation(serverProvidersImpl);
runtime.registerImplementation(modelFavoritesImpl);
runtime.registerImplementation(setModelFavoriteImpl);
runtime.registerImplementation(queueCommandImpl);
runtime.registerImplementation(projectCommandImpl);
runtime.registerImplementation(addProjectSettingsImpl);
runtime.registerImplementation(browseFoldersImpl);
runtime.registerImplementation(searchEntriesImpl);
runtime.registerImplementation(searchThreadsImpl);
runtime.registerImplementation(startCloneImpl);
runtime.registerImplementation(cloneControlImpl);
runtime.registerImplementation(newProjectImpl);
runtime.registerImplementation(openInFileManagerImpl);
runtime.registerImplementation(openInEditorImpl);
runtime.registerImplementation(threadCommandImpl);
runtime.registerImplementation(threadDiffImpl);
runtime.registerImplementation(assetUrlImpl);
runtime.registerImplementation(closeTerminalImpl);
runtime.registerImplementation(rememberedTerminalImpl);
runtime.registerImplementation(rememberTerminalImpl);
runtime.registerImplementation(rememberedModelsImpl);
runtime.registerImplementation(rememberModelImpl);
runtime.registerImplementation(storedDraftImpl);
runtime.registerImplementation(storedNewThreadImpl);
runtime.registerImplementation(storeDraftImpl);
runtime.registerImplementation(storedDraftFilesImpl);
runtime.registerImplementation(storeDraftFilesImpl);
for (const sourceControlImpl of sourceControlImplementations) {
  runtime.registerImplementation(sourceControlImpl);
}
runtime.registerResourceType("composerFiles", composerFiles);
runtime.registerResourceType("vcsStatus", vcsStatus);
runtime.registerResourceType("commandOutput", commandOutput);
runtime.registerResourceType("projectClones", projectClones);
runtime.registerResourceType("projectFavicons", projectFavicons);
runtime.registerResourceType("serverKeybindings", serverKeybindings);
runtime.registerResourceType("terminalSession", terminalSession);
runtime.registerImplementation(delayImpl);
runtime.registerImplementation(addressThreadImpl);
runtime.registerImplementation(setAddressThreadImpl);
runtime.registerImplementation(addressViewImpl);
runtime.registerImplementation(setAddressViewImpl);
runtime.registerImplementation(serverConfigImpl);
runtime.registerImplementation(updateServerSettingsImpl);
runtime.registerImplementation(storedClientSettingsImpl);
runtime.registerImplementation(storeClientSettingsImpl);
runtime.registerImplementation(archivedShellImpl);
runtime.registerImplementation(usageSummaryImpl);
runtime.registerImplementation(refreshUsageRatesImpl);
runtime.registerImplementation(storedPreferencesImpl);
runtime.registerImplementation(storePreferencesImpl);
runtime.registerImplementation(storedEditorImpl);
runtime.registerImplementation(storeEditorImpl);
runtime.registerImplementation(clockNowImpl);
runtime.registerResourceType("appearance", appearance);
runtime.registerResourceType("shellStream", shellStream, { endOnReceiverFailure: true });
runtime.registerResourceType("threadStream", threadStream, { endOnReceiverFailure: true });
runtime.registerReceiver(RootReceiver);
runtime.registerReceiver(EnvironmentReceiver);
runtime.registerReceiver(ShellReceiver);
runtime.registerReceiver(ThreadReceiver);
runtime.registerReceiver(TerminalReceiver);
runtime.registerReceiver(RewindReceiver);
runtime.registerReceiver(GitReceiver);
runtime.registerReceiver(PreferencesReceiver);
// The Environment applies the scheme once it connects; this paints the loading screen in it.
document.documentElement.dataset.theme = resolveScheme(
  storedAppearanceMode(),
  matchMedia(SYSTEM_DARK_QUERY).matches,
);
void runtime.dispatch(load, "Root");
openExternalLinksInSafari();

render(
  () => (
    <TreflexProvider value={runtime}>
      <App state={runtime.state} />
    </TreflexProvider>
  ),
  document.getElementById("root") as HTMLElement,
);
