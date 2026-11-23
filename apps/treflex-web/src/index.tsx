import { createRuntime } from "treflex";
import { TreflexProvider } from "treflex-solid";
import { render } from "solid-js/web";

import "@fontsource-variable/inter";
import "./index.css";

import { App } from "./App";
import { openExternalLinksInSafari } from "./externalLinks";
import { addressHistory, addressImpl, writeAddressImpl } from "./Infrastructure/address";
import { chooseNotificationModeImpl, threadNotifier } from "./Infrastructure/notifications";
import {
  archivedShellImpl,
  refreshProvidersImpl,
  refreshUsageRatesImpl,
  storeClientSettingsImpl,
  storedClientSettingsImpl,
  updateServerSettingsImpl,
  usageSummaryImpl,
} from "./Infrastructure/settingsImpl";
import { provideMinute } from "./Infrastructure/clock";
import { commandOutput } from "./Infrastructure/commandOutput";
import {
  assetUrlImpl,
  browseFoldersImpl,
  cloneControlImpl,
  closeTerminalImpl,
  newProjectImpl,
  openInEditorImpl,
  openInFileManagerImpl,
  queueCommandImpl,
  forkThreadImpl,
  mergeBackImpl,
  threadTitlesImpl,
  respondRequestImpl,
  answerSecretImpl,
  answerLinkImpl,
  rewindImpl,
  searchEntriesImpl,
  searchThreadsImpl,
  startCloneImpl,
  startTurnImpl,
  stopThreadImpl,
  projectCommandImpl,
  threadCommandImpl,
  threadDiffImpl,
  turnItemImpl,
  mcpAppImpl,
} from "./Infrastructure/commandsImpl";
import { composerFiles } from "./Infrastructure/composerFiles";
import { delayImpl } from "./Infrastructure/delay";
import {
  dictation,
  voiceModelCommandImpl,
  voiceModelsImpl,
  voiceStatusImpl,
} from "./Infrastructure/dictation";
import { environmentInfoImpl } from "./Infrastructure/environmentInfoImpl";
import {
  storeDraftFilesImpl,
  storeDraftImpl,
  storedDraftFilesImpl,
  storedDraftImpl,
  storedNewThreadImpl,
} from "./Infrastructure/draftMemory";
import { rememberedModelsImpl, rememberModelImpl } from "./Infrastructure/modelMemory";
import { registerServiceWorker } from "./Infrastructure/serviceWorker";
import { pairFromUrl } from "./Infrastructure/pairing";
import { projectClones } from "./Infrastructure/projectClones";
import { projectFavicons } from "./Infrastructure/projectFavicons";
import { serverConfigStream } from "./Infrastructure/serverConfigStream";
import { shellStream } from "./Infrastructure/shellStream";
import { rememberedTerminalImpl, rememberTerminalImpl } from "./Infrastructure/terminalMemory";
import { sourceControlImplementations } from "./Infrastructure/sourceControlImpl";
import { terminalSession } from "./Infrastructure/terminalSession";
import { vcsStatus } from "./Infrastructure/vcsStatus";
import { threadHistoryPageImpl } from "./Infrastructure/threadHistory";
import { threadStream } from "./Infrastructure/threadStream";
import { toastImpl } from "./Infrastructure/toasts";
import { appearance } from "./Infrastructure/appearance";
import { deviceActivity, reportActivityImpl } from "./Infrastructure/clientActivityImpl";
import {
  clockNowImpl,
  storedAppearanceMode,
  storedEditorImpl,
  storedPreferencesImpl,
  storeEditorImpl,
  storePreferencesImpl,
} from "./Infrastructure/preferences";
import { resolveScheme, SYSTEM_DARK_QUERY } from "./colorScheme";
import { registerReceivers } from "./receivers";
import { getDefaultRoot, load } from "./Root";

await pairFromUrl();

const runtime = createRuntime(getDefaultRoot("Root"), {
  // Takes what nothing else does, so the browser doesn't report it again as an unhandled rejection.
  onError: () => {},
});
runtime.on("failure", (failure) =>
  console.error(`[treflex-web] ${failure.Label} failed:`, failure.Error),
);
provideMinute(runtime);
runtime.registerImplementation(environmentInfoImpl);
runtime.registerImplementation(threadHistoryPageImpl);
runtime.registerImplementation(startTurnImpl);
runtime.registerImplementation(stopThreadImpl);
runtime.registerImplementation(respondRequestImpl);
runtime.registerImplementation(answerSecretImpl);
runtime.registerImplementation(answerLinkImpl);
runtime.registerImplementation(rewindImpl);
runtime.registerImplementation(forkThreadImpl);
runtime.registerImplementation(mergeBackImpl);
runtime.registerImplementation(threadTitlesImpl);
runtime.registerImplementation(queueCommandImpl);
runtime.registerImplementation(projectCommandImpl);
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
runtime.registerImplementation(turnItemImpl);
runtime.registerImplementation(mcpAppImpl);
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
runtime.registerResourceType("serverConfigStream", serverConfigStream, {
  endOnReceiverFailure: true,
});
runtime.registerResourceType("terminalSession", terminalSession);
runtime.registerResourceType("dictation", dictation);
runtime.registerImplementation(voiceStatusImpl);
runtime.registerImplementation(voiceModelsImpl);
runtime.registerImplementation(voiceModelCommandImpl);
runtime.registerImplementation(delayImpl);
runtime.registerImplementation(addressImpl);
runtime.registerImplementation(writeAddressImpl);
runtime.registerResourceType("addressHistory", addressHistory);
runtime.registerImplementation(refreshProvidersImpl);
runtime.registerImplementation(updateServerSettingsImpl);
runtime.registerImplementation(storedClientSettingsImpl);
runtime.registerImplementation(storeClientSettingsImpl);
runtime.registerResourceType("threadNotifier", threadNotifier);
runtime.registerImplementation(chooseNotificationModeImpl);
runtime.registerImplementation(archivedShellImpl);
runtime.registerImplementation(usageSummaryImpl);
runtime.registerImplementation(refreshUsageRatesImpl);
runtime.registerImplementation(storedPreferencesImpl);
runtime.registerImplementation(storePreferencesImpl);
runtime.registerImplementation(storedEditorImpl);
runtime.registerImplementation(storeEditorImpl);
runtime.registerImplementation(clockNowImpl);
runtime.registerImplementation(toastImpl);
runtime.registerResourceType("appearance", appearance);
runtime.registerResourceType("deviceActivity", deviceActivity);
runtime.registerImplementation(reportActivityImpl);
runtime.registerResourceType("shellStream", shellStream, { endOnReceiverFailure: true });
runtime.registerResourceType("threadStream", threadStream, { endOnReceiverFailure: true });
registerReceivers(runtime);
// The Environment applies the scheme once it connects; this paints the loading screen in it.
document.documentElement.dataset.theme = resolveScheme(
  storedAppearanceMode(),
  matchMedia(SYSTEM_DARK_QUERY).matches,
);
void runtime.dispatch(load, "Root");
openExternalLinksInSafari();
registerServiceWorker();

render(
  () => (
    <TreflexProvider value={runtime}>
      <App state={runtime.state} />
    </TreflexProvider>
  ),
  document.getElementById("root") as HTMLElement,
);
