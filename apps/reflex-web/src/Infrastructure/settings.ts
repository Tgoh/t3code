import type {
  ClientServerSettingsPatch,
  ClientSettings,
  OrchestrationV2ArchivedShellSnapshot,
  ProviderInstanceMutation,
  ServerConfig,
  ServerSettings,
  UsageSummary,
  UsageSummaryInput,
} from "@t3tools/contracts";
import { defineEffect, type IEffect } from "treflex";

import type { Wire } from "./wire";

export type IWireServerConfig = Wire<ServerConfig>;
export type IWireServerSettings = Wire<ServerSettings>;
export type IWireSettingsPatch = Wire<typeof ClientServerSettingsPatch.Type>;
export type IWireInstanceMutation = Wire<ProviderInstanceMutation>;
export type IWireClientSettings = Wire<ClientSettings>;
export type IWireArchivedShell = Wire<OrchestrationV2ArchivedShellSnapshot>;
export type IWireUsageSummary = Wire<UsageSummary>;
export type IWireUsageInput = Wire<UsageSummaryInput>;

interface IRefreshProvidersEffect extends IEffect {
  Type: "refreshProviders";
  EnvironmentId: string;
  /** Skipped when this environment was refreshed in the last five minutes, as stock does. */
  Automatic: boolean;
}

export const refreshProvidersEffect = defineEffect<IRefreshProvidersEffect, void>(
  "refreshProviders",
);

interface IUpdateServerSettingsEffect extends IEffect {
  Type: "updateServerSettings";
  EnvironmentId: string;
  Patch: IWireSettingsPatch;
  InstanceMutation: IWireInstanceMutation | null;
}

export const updateServerSettingsEffect = defineEffect<
  IUpdateServerSettingsEffect,
  IWireServerSettings
>("updateServerSettings");

interface IStoredClientSettingsEffect extends IEffect {
  Type: "storedClientSettings";
}

/** The whole object with stock's defaults filled in. */
export const storedClientSettingsEffect = defineEffect<
  IStoredClientSettingsEffect,
  IWireClientSettings
>("storedClientSettings");

interface IStoreClientSettingsEffect extends IEffect {
  Type: "storeClientSettings";
  Settings: IWireClientSettings;
}

export const storeClientSettingsEffect = defineEffect<IStoreClientSettingsEffect, void>(
  "storeClientSettings",
);

interface IArchivedShellEffect extends IEffect {
  Type: "archivedShell";
  EnvironmentId: string;
}

export const archivedShellEffect = defineEffect<IArchivedShellEffect, IWireArchivedShell>(
  "archivedShell",
);

interface IUsageSummaryEffect extends IEffect {
  Type: "usageSummary";
  EnvironmentId: string;
  Input: IWireUsageInput;
}

export const usageSummaryEffect = defineEffect<IUsageSummaryEffect, IWireUsageSummary>(
  "usageSummary",
);

interface IRefreshUsageRatesEffect extends IEffect {
  Type: "refreshUsageRates";
  EnvironmentId: string;
}

export const refreshUsageRatesEffect = defineEffect<IRefreshUsageRatesEffect, void>(
  "refreshUsageRates",
);
