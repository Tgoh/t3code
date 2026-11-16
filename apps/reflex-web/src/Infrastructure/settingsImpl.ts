import { request } from "@t3tools/client-runtime/rpc";
import {
  ClientServerSettingsPatch,
  type ClientSettings,
  ClientSettingsSchema,
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationV2ArchivedShellSnapshot,
  ProviderInstanceMutation,
  ServerConfig,
  ServerSettings,
  UsageSummary,
  UsageSummaryInput,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { implementation } from "treflex";

import { inEnvironment, onceRegistered } from "./commandsImpl";
import {
  archivedShellEffect,
  type IWireArchivedShell,
  type IWireClientSettings,
  type IWireServerConfig,
  type IWireServerSettings,
  type IWireUsageSummary,
  refreshUsageRatesEffect,
  serverConfigEffect,
  storeClientSettingsEffect,
  storedClientSettingsEffect,
  updateServerSettingsEffect,
  usageSummaryEffect,
} from "./settings";

// Stock's key (CLIENT_SETTINGS_STORAGE_KEY in apps/web/src/clientPersistenceStorage.ts).
const CLIENT_SETTINGS_KEY = "t3code:client-settings:v1";

// The wire types keep brands that the JSON codecs' encoded types drop, hence the casts.
const encodeConfigJson = Schema.encodeSync(Schema.toCodecJson(ServerConfig));
const encodeConfig = (value: ServerConfig) => encodeConfigJson(value) as IWireServerConfig;
const encodeSettingsJson = Schema.encodeSync(Schema.toCodecJson(ServerSettings));
const encodeSettings = (value: ServerSettings) => encodeSettingsJson(value) as IWireServerSettings;
const decodePatch = Schema.decodeUnknownSync(Schema.toCodecJson(ClientServerSettingsPatch));
const decodeMutation = Schema.decodeUnknownSync(Schema.toCodecJson(ProviderInstanceMutation));
const decodeClient = Schema.decodeUnknownSync(Schema.toCodecJson(ClientSettingsSchema));
const encodeClientJson = Schema.encodeSync(Schema.toCodecJson(ClientSettingsSchema));
const encodeClient = (value: ClientSettings) => encodeClientJson(value) as IWireClientSettings;
const encodeArchivedJson = Schema.encodeSync(
  Schema.toCodecJson(OrchestrationV2ArchivedShellSnapshot),
);
const encodeArchived = (value: OrchestrationV2ArchivedShellSnapshot) =>
  encodeArchivedJson(value) as IWireArchivedShell;
const decodeUsageInput = Schema.decodeUnknownSync(Schema.toCodecJson(UsageSummaryInput));
const encodeUsageJson = Schema.encodeSync(Schema.toCodecJson(UsageSummary));
const encodeUsage = (value: UsageSummary) => encodeUsageJson(value) as IWireUsageSummary;

export const serverConfigImpl = implementation(serverConfigEffect, async (input) =>
  encodeConfig(await onceRegistered(input.EnvironmentId, request(WS_METHODS.serverGetConfig, {}))),
);

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

function readClientSettings(): unknown {
  try {
    const held = localStorage.getItem(CLIENT_SETTINGS_KEY);
    return held === null ? {} : JSON.parse(held);
  } catch {
    return {};
  }
}

export const storedClientSettingsImpl = implementation(storedClientSettingsEffect, () => {
  try {
    return encodeClient(decodeClient(readClientSettings()));
  } catch {
    return encodeClient(decodeClient({}));
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
