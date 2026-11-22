import { type IActionGenerator, type IOpenGenerator, open, start } from "treflex";

import type { IEnvironment } from "./Environment";
import { type IAddressView, setAddressView } from "./Infrastructure/address";
import {
  type IWireClientSettings,
  type IWireInstanceMutation,
  type IWireSettingsPatch,
  refreshProvidersEffect,
  storeClientSettingsEffect,
  storedClientSettingsEffect,
  updateServerSettingsEffect,
} from "./Infrastructure/settings";
import type { IWireServerConfigEvent } from "./Infrastructure/serverConfigStream";
import { modelFavoritesOf, providerOptions } from "./modelOptions";
import { modelFavoritePatch } from "./providerSettings";
import { reconcile } from "./rows";
import { visitShown } from "./Shell";
import { builtSettingsPage, type ISettingWrite } from "./settingsPages";
import { closeDetailsPopover } from "./ThreadSession";
import { loadModels } from "./VoiceModels";

export function* openView(draft: IEnvironment, view: IAddressView | null): IActionGenerator {
  const covered = draft.Local.View !== null;
  yield* showView(draft, view);
  if (covered && view === null) yield* start(visitShown, draft.Replica.Shell, { Again: true });
}

/** Opens or closes a page without the visit closing one makes, for a caller that shows a thread. */
export function* showView(draft: IEnvironment, view: IAddressView | null): IActionGenerator {
  const next: IAddressView | null =
    view?.Kind === "settings" ? { Kind: "settings", Page: builtSettingsPage(view.Page) } : view;
  draft.Local.View = next;
  yield* setAddressView(next);
  if (next === null) return;
  const covered = draft.Local.ThreadSessions[draft.Local.SelectedThreadId ?? ""];
  if (covered !== undefined) yield* start(closeDetailsPopover, covered);
  yield* start(loadSettings, draft);
  if (
    next.Kind === "settings" &&
    next.Page === "voice" &&
    draft.Local.Preferences.VoiceDestination === "server"
  )
    yield* start(loadModels, draft.Local.Dictation);
}

export function* loadSettings(draft: IEnvironment): IActionGenerator {
  draft.Local.ClientSettings = yield* storedClientSettingsEffect();
}

// Follows applyServerConfigProjection in packages/client-runtime/src/state/serverConfigProjection.ts,
// for the events a session subscribed without opt-ins receives.
export function applyConfigEvent(draft: IEnvironment, event: IWireServerConfigEvent): void {
  if (event.type === "snapshot") {
    if (draft.Replica.Config === null) draft.Replica.Config = event.config;
    else reconcile(draft.Replica.Config, event.config);
    syncProviders(draft);
    return;
  }
  const config = draft.Replica.Config;
  if (config === null) return;
  switch (event.type) {
    case "keybindingsUpdated":
      config.keybindings = event.payload.keybindings;
      config.issues = event.payload.issues;
      return;
    case "providerStatuses":
      config.providers = event.payload.providers;
      syncProviders(draft);
      return;
    case "settingsUpdated":
      reconcile(config.settings, event.payload.settings);
      syncProviders(draft);
      return;
  }
}

/** Rewrites the composer's provider list and favorites only when the config changed what they hold. */
function syncProviders(draft: IEnvironment): void {
  const config = draft.Replica.Config;
  if (config === null) return;
  const providers = JSON.stringify(providerOptions(config));
  if (providers !== JSON.stringify(draft.Replica.Providers)) {
    draft.Replica.Providers = JSON.parse(providers);
  }
  const favorites = JSON.stringify(modelFavoritesOf(config));
  if (favorites !== JSON.stringify(draft.Replica.ModelFavorites)) {
    draft.Replica.ModelFavorites = JSON.parse(favorites);
  }
}

export function* updateServerSettings(
  draft: IEnvironment,
  patch: IWireSettingsPatch,
  mutation: IWireInstanceMutation | null = null,
): IOpenGenerator {
  const environmentId = draft.EnvironmentId;
  const settings = yield* open(
    updateServerSettingsEffect({
      EnvironmentId: environmentId,
      Patch: patch,
      InstanceMutation: mutation,
    }),
  );
  if (draft.Replica.Config !== null) draft.Replica.Config.settings = settings;
  syncProviders(draft);
}

export function* toggleModelFavorite(
  draft: IEnvironment,
  provider: string,
  model: string,
): IOpenGenerator {
  const favorite = !draft.Replica.ModelFavorites.some(
    (held) => held.Provider === provider && held.Model === model,
  );
  yield* updateServerSettings(draft, modelFavoritePatch(provider, model, favorite));
}

export function* setClientSettings(
  draft: IEnvironment,
  patch: Partial<IWireClientSettings>,
): IActionGenerator {
  const held = draft.Local.ClientSettings ?? (yield* storedClientSettingsEffect());
  const next = { ...held, ...patch };
  draft.Local.ClientSettings = next;
  yield* storeClientSettingsEffect({ Settings: next });
}

export function* writeSetting(draft: IEnvironment, write: ISettingWrite): IOpenGenerator {
  if (write.Store === "client") yield* setClientSettings(draft, write.Patch);
  else yield* updateServerSettings(draft, write.Patch);
}

/** The header's limits popover asks the server to re-probe, as the Usage page's limits tab does. */
export function* autoRefreshLimits(draft: IEnvironment): IOpenGenerator {
  const environmentId = draft.EnvironmentId;
  yield* open(refreshProvidersEffect({ EnvironmentId: environmentId, Automatic: true }));
}
