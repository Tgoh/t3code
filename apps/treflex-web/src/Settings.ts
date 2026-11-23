import {
  type IActionGenerator,
  type IOpenGenerator,
  type ISelectorGenerator,
  open,
  resource,
  start,
} from "treflex";

import type { IEnvironment } from "./Environment";
import { type IAddressView, writeAddressEffect } from "./Infrastructure/address";
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
import { followInbox, notifyChanges, visitShown } from "./Shell";
import { builtSettingsPage, type ISettingWrite } from "./settingsPages";
import {
  chooseNotificationModeEffect,
  type INotificationPermission,
} from "./Infrastructure/notifications";
import type { INotificationMode } from "./threadNotifications";
import { closeDetailsPopover, followCheckout } from "./ThreadSession";
import type { ITimestampFormat } from "./timestamps";
import { loadModels } from "./VoiceModels";

/**
 * Writes the selection and page to the address. A push adds a back-button entry, unless the
 * address already holds them, as it does after a back or forward.
 */
export function* syncAddress(draft: IEnvironment, push = true): IActionGenerator {
  const selected = draft.Local.SelectedThreadId;
  const newThreadIn =
    selected === null ? null : (draft.Local.ThreadSessions[selected]?.NewThreadProjectId ?? null);
  const view = draft.Local.View;
  yield* writeAddressEffect({
    Address: {
      Thread: newThreadIn === null ? selected : null,
      NewThreadIn: newThreadIn,
      View: view === null ? null : { ...view },
    },
    Push: push,
  });
}

export function* openView(draft: IEnvironment, view: IAddressView | null): IActionGenerator {
  const covered = draft.Local.View !== null;
  yield* showView(draft, view);
  yield* syncAddress(draft);
  const selected = draft.Local.ThreadSessions[draft.Local.SelectedThreadId ?? ""];
  if (selected !== undefined) yield* start(followCheckout, selected);
  if (covered && view === null) yield* start(visitShown, draft.Replica.Shell, { Again: true });
}

/** Opens or closes a page without the visit closing one makes, for a caller that shows a thread. */
export function* showView(draft: IEnvironment, view: IAddressView | null): IActionGenerator {
  const next: IAddressView | null =
    view?.Kind === "settings" ? { Kind: "settings", Page: builtSettingsPage(view.Page) } : view;
  draft.Local.View = next;
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
  yield* applyNotificationMode(draft);
  yield* start(notifyChanges, draft.Replica.Shell);
}

export function* applyNotificationMode(draft: IEnvironment): IActionGenerator {
  const settings = draft.Local.ClientSettings;
  yield* resource(draft, "Notify/Device").setMode(
    settings?.notificationMode ?? "off",
    settings?.inAppNotificationsEnabled === true,
  );
}

// Follows NotificationSettings in apps/web/src/components/settings/NotificationSettings.tsx.
const PERMISSION_MESSAGES: Record<Exclude<INotificationPermission, "granted">, string> = {
  unsupported:
    "Notifications need a supported browser over HTTPS, or the desktop app. Sound only is still available.",
  unavailable: "Notifications are unavailable in this browser. Sound only is still available.",
  denied:
    "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.",
};

/**
 * Sets Thread notifications once the browser allows what the mode needs. Returns why it didn't,
 * for the row to show in place of its description.
 */
export function* chooseNotificationMode(
  draft: IEnvironment,
  mode: INotificationMode,
): IOpenGenerator<string | null> {
  const permission = yield* open(chooseNotificationModeEffect({ Mode: mode }));
  if (permission !== "granted") return PERMISSION_MESSAGES[permission];
  yield* setClientSettings(draft, { notificationMode: mode });
  return null;
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
  if (patch.notificationMode !== undefined || patch.inAppNotificationsEnabled !== undefined) {
    yield* applyNotificationMode(draft);
    yield* start(notifyChanges, draft.Replica.Shell);
  }
  if (patch.sidebarWorkingShelfEnabled !== undefined)
    yield* start(followInbox, draft.Replica.Shell);
}

export function* timestampFormat(draft: IEnvironment): ISelectorGenerator<ITimestampFormat> {
  return draft.Local.ClientSettings?.timestampFormat ?? "locale";
}

export function* toolCallVisibility(
  draft: IEnvironment,
): ISelectorGenerator<IWireClientSettings["toolCallVisibility"]> {
  return draft.Local.ClientSettings?.toolCallVisibility ?? "showAll";
}

export function* sendShortcut(
  draft: IEnvironment,
): ISelectorGenerator<IWireClientSettings["sendShortcut"]> {
  return draft.Local.ClientSettings?.sendShortcut ?? "enter";
}

export function* confirmThreadUnpin(draft: IEnvironment): ISelectorGenerator<boolean> {
  return draft.Local.ClientSettings?.confirmThreadUnpin ?? false;
}

export function* confirmThreadDelete(draft: IEnvironment): ISelectorGenerator<boolean> {
  return draft.Local.ClientSettings?.confirmThreadDelete ?? true;
}

export function* wordWrap(draft: IEnvironment): ISelectorGenerator<boolean> {
  return draft.Local.ClientSettings?.wordWrap ?? true;
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
