// oxlint-disable-next-line t3code/no-rpc-permission-bypass -- this client has no atom command boundary (issues.md, "the command path assumes atoms"); the server authorizes the refresh
import { request, requestGuarded, RpcPermissionGuard } from "@t3tools/client-runtime/rpc";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import {
  ClientServerSettingsPatch,
  type ClientSettings,
  ClientSettingsSchema,
  EnvironmentId,
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationV2ArchivedShellSnapshot,
  ProviderInstanceMutation,
  ServerSettings,
  UsageSummary,
  UsageSummaryInput,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { implementation } from "treflex";

import { isProjectSort } from "../projectOrder";
import { inEnvironment, onceRegistered } from "./commandsImpl";
import {
  archivedShellEffect,
  type IWireArchivedShell,
  type IWireClientSettings,
  type IWireServerSettings,
  type IWireUsageSummary,
  refreshProvidersEffect,
  refreshUsageRatesEffect,
  storeClientSettingsEffect,
  storedClientSettingsEffect,
  updateServerSettingsEffect,
  usageSummaryEffect,
} from "./settings";
import { wireCodec } from "./wire";

// Stock's key (CLIENT_SETTINGS_STORAGE_KEY in apps/web/src/clientPersistenceStorage.ts).
const CLIENT_SETTINGS_KEY = "t3code:client-settings:v1";

// The wire types keep brands that the JSON codecs' encoded types drop, hence the casts.
const encodeSettingsJson = Schema.encodeSync(wireCodec(ServerSettings));
const encodeSettings = (value: ServerSettings) => encodeSettingsJson(value) as IWireServerSettings;
const decodePatch = Schema.decodeUnknownSync(wireCodec(ClientServerSettingsPatch));
const decodeMutation = Schema.decodeUnknownSync(wireCodec(ProviderInstanceMutation));
const decodeClient = Schema.decodeUnknownSync(wireCodec(ClientSettingsSchema));
// Fills the defaults a stored value lacks, such as a key added since it was saved.
const decodeStoredClient = Schema.decodeUnknownSync(Schema.toCodecJson(ClientSettingsSchema));
const encodeClientJson = Schema.encodeSync(wireCodec(ClientSettingsSchema));
const encodeClient = (value: ClientSettings) => encodeClientJson(value) as IWireClientSettings;
const encodeArchivedJson = Schema.encodeSync(wireCodec(OrchestrationV2ArchivedShellSnapshot));
const encodeArchived = (value: OrchestrationV2ArchivedShellSnapshot) =>
  encodeArchivedJson(value) as IWireArchivedShell;
const decodeUsageInput = Schema.decodeUnknownSync(wireCodec(UsageSummaryInput));
const encodeUsageJson = Schema.encodeSync(wireCodec(UsageSummary));
const encodeUsage = (value: UsageSummary) => encodeUsageJson(value) as IWireUsageSummary;

const allowAll = { authorize: () => Effect.void };

export const refreshProvidersImpl = implementation(refreshProvidersEffect, async (input) => {
  const environmentId = EnvironmentId.make(input.EnvironmentId);
  await refreshUsageLimits(
    environmentId,
    () =>
      onceRegistered(
        input.EnvironmentId,
        requestGuarded(WS_METHODS.serverRefreshProviders, {
          workspaceSnapshotsOnDemand: true,
          omitProviders: true,
        }).pipe(Effect.provideService(RpcPermissionGuard, allowAll)),
      ),
    input.Automatic,
  );
});

export const updateServerSettingsImpl = implementation(updateServerSettingsEffect, async (input) =>
  encodeSettings(
    await inEnvironment(
      input.EnvironmentId,
      request(WS_METHODS.serverUpdateSettings, {
        patch: decodePatch(input.Patch),
        ...(input.InstanceMutation === null
          ? {}
          : { providerInstanceMutation: decodeMutation(input.InstanceMutation) }),
      }),
    ),
  ),
);

// Treflex queues follow-ups by default where stock steers. Saved settings always carry stock's
// "steer", so each browser is switched to "queue" once, and a later choice of "steer" holds.
// The key predates the rename; a new one would switch every browser again.
const QUEUE_DEFAULT_KEY = "reflex:follow-up-queue-default:v1";
const TREFLEX_DEFAULTS = { followUpBehavior: "queue" };

// Earlier builds kept the project sort under their own key, "manual" when unset. Its presence
// marks a browser not yet moved over, so the move happens once and then the key goes.
const LEGACY_PROJECT_SORT_KEY = "reflex-web:project-sort";
const LEGACY_PROJECT_SORT_DEFAULT = "manual";

function readClientSettings(): unknown {
  try {
    const held = localStorage.getItem(CLIENT_SETTINGS_KEY);
    const parsed: unknown = held === null ? {} : JSON.parse(held);
    let settings = typeof parsed === "object" && parsed !== null ? parsed : {};
    let changed = false;
    if (localStorage.getItem(QUEUE_DEFAULT_KEY) === null) {
      settings = { ...settings, ...TREFLEX_DEFAULTS };
      localStorage.setItem(QUEUE_DEFAULT_KEY, "1");
      changed = true;
    }
    const legacySort = localStorage.getItem(LEGACY_PROJECT_SORT_KEY);
    if (legacySort !== null) {
      const sort = parseJson(legacySort);
      settings = {
        ...settings,
        sidebarProjectSortOrder: isProjectSort(sort) ? sort : LEGACY_PROJECT_SORT_DEFAULT,
      };
      localStorage.removeItem(LEGACY_PROJECT_SORT_KEY);
      changed = true;
    }
    if (changed) localStorage.setItem(CLIENT_SETTINGS_KEY, JSON.stringify(settings));
    return settings;
  } catch {
    return TREFLEX_DEFAULTS;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function decodeStored(held: unknown): ClientSettings {
  try {
    return decodeClient(held);
  } catch {
    return decodeStoredClient(held);
  }
}

export const storedClientSettingsImpl = implementation(storedClientSettingsEffect, () => {
  try {
    return encodeClient(decodeStored(readClientSettings()));
  } catch {
    return encodeClient(decodeStoredClient(TREFLEX_DEFAULTS));
  }
});

export const storeClientSettingsImpl = implementation(storeClientSettingsEffect, (effect) => {
  localStorage.setItem(
    CLIENT_SETTINGS_KEY,
    JSON.stringify(encodeClient(decodeClient(effect.Settings))),
  );
});

export const archivedShellImpl = implementation(archivedShellEffect, async (input) =>
  encodeArchived(
    await onceRegistered(
      input.EnvironmentId,
      request(ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot, {}),
    ),
  ),
);

export const usageSummaryImpl = implementation(usageSummaryEffect, async (input) =>
  encodeUsage(
    await onceRegistered(
      input.EnvironmentId,
      request(WS_METHODS.serverGetUsageSummary, decodeUsageInput(input.Input)),
    ),
  ),
);

export const refreshUsageRatesImpl = implementation(refreshUsageRatesEffect, async (input) => {
  await inEnvironment(input.EnvironmentId, request(WS_METHODS.serverRefreshUsageRates, {}));
});
