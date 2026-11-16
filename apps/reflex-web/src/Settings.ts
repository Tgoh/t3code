import {
  type IActionGenerator,
  inFlight,
  type IOpenGenerator,
  type ISelectorGenerator,
  latest,
  open,
  start,
} from "treflex";

import type { IEnvironment } from "./Environment";
import { loadProviders, threadCommand } from "./Environment";
import { type IAddressView, setAddressView } from "./Infrastructure/address";
import {
  archivedShellEffect,
  type IWireClientSettings,
  type IWireInstanceMutation,
  type IWireSettingsPatch,
  type IWireUsageInput,
  refreshUsageRatesEffect,
  serverConfigEffect,
  storeClientSettingsEffect,
  storedClientSettingsEffect,
  updateServerSettingsEffect,
  usageSummaryEffect,
} from "./Infrastructure/settings";
import { builtSettingsPage, type ISettingWrite } from "./settingsPages";

/** Where a settings write changes what the composer offers, so its provider list reloads. */
const touchesProviders = (patch: IWireSettingsPatch, mutation: IWireInstanceMutation | null) =>
  mutation !== null ||
  "setModelsHidden" in patch ||
  "setProviderModelOrder" in patch ||
  "setModelFavorites" in patch;

export function* openView(draft: IEnvironment, view: IAddressView | null): IActionGenerator {
  const next: IAddressView | null =
    view?.Kind === "settings" ? { Kind: "settings", Page: builtSettingsPage(view.Page) } : view;
  draft.Local.View = next;
  yield* setAddressView(next);
  if (next === null) return;
  yield* start(loadSettings, draft);
  if (next.Kind === "settings" && next.Page === "archived") yield* start(loadArchived, draft);
}

export function* loadSettings(draft: IEnvironment): IOpenGenerator {
  draft.Local.ClientSettings = yield* storedClientSettingsEffect();
  const environmentId = draft.EnvironmentId;
  draft.Replica.Config = yield* open(serverConfigEffect({ EnvironmentId: environmentId }));
}
latest(loadSettings);

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
  if (!touchesProviders(patch, mutation)) return;
  // The providers a mutation changes are re-probed by the server, so the config is read again.
  if (mutation !== null) {
    draft.Replica.Config = yield* open(serverConfigEffect({ EnvironmentId: environmentId }));
  }
  yield* loadProviders(draft, true);
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

export function* savingSettings(draft: IEnvironment): ISelectorGenerator<boolean> {
  return yield* inFlight([updateServerSettings, writeSetting], draft);
}

export function* loadArchived(draft: IEnvironment): IOpenGenerator {
  const environmentId = draft.EnvironmentId;
  draft.Replica.Archived = yield* open(archivedShellEffect({ EnvironmentId: environmentId }));
}
latest(loadArchived);

// Follows ArchivedThreadsPanel in apps/web/src/components/settings/ArchivedThreadsPanel.tsx.
export function* archivedThreadCommand(
  draft: IEnvironment,
  threadId: string,
  kind: "unarchive" | "delete",
): IOpenGenerator {
  yield* threadCommand(draft, threadId, { Kind: kind });
  yield* loadArchived(draft);
}

// Follows the provisional read in packages/client-runtime/src/state/server.ts (usage summary query).
export function* loadUsage(
  draft: IEnvironment,
  key: string,
  input: IWireUsageInput,
): IOpenGenerator {
  const environmentId = draft.EnvironmentId;
  const read = (extra: Partial<IWireUsageInput>) =>
    open(usageSummaryEffect({ EnvironmentId: environmentId, Input: { ...input, ...extra } }));
  let summary = yield* read({ provisional: true });
  draft.Replica.Usage = { Key: key, Summary: summary };
  if (!summary.sources.some((source) => source.refreshing === true)) return;
  summary = yield* read({ awaitRefresh: true });
  draft.Replica.Usage = { Key: key, Summary: summary };
}
latest(loadUsage);

/** Limits are read from the config; anything else refreshes prices and reads the window again. */
export function* refreshUsage(
  draft: IEnvironment,
  usage: { Key: string; Input: IWireUsageInput } | null,
): IOpenGenerator {
  const environmentId = draft.EnvironmentId;
  if (usage === null) {
    draft.Replica.Config = yield* open(serverConfigEffect({ EnvironmentId: environmentId }));
    return;
  }
  yield* open(refreshUsageRatesEffect({ EnvironmentId: environmentId }));
  yield* loadUsage(draft, usage.Key, usage.Input);
}

export function* refreshingUsage(draft: IEnvironment): ISelectorGenerator<boolean> {
  return yield* inFlight([refreshUsage, loadUsage], draft);
}
