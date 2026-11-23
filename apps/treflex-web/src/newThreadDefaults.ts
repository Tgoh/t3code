import {
  DEFAULT_MODEL_BY_PROVIDER,
  defaultInstanceIdForDriver,
  type ModelSelection,
  type ProjectId,
  resolveProjectProviderInstanceEnabled,
  type RuntimeMode,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import {
  type LegacyProjectSettingsFields,
  resolveProjectSettings,
} from "@t3tools/shared/projectSettings";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";

import type { IWireModelSelection } from "./Infrastructure/commandEffects";
import type { IWireServerConfig } from "./Infrastructure/settings";

interface IEntry {
  Provider: ServerProvider;
  Enabled: boolean;
}

// Follows isProviderInstanceHealthy in apps/web/src/providerInstances.ts.
function healthy({ Provider, Enabled }: IEntry): boolean {
  if (!Enabled || Provider.availability === "unavailable") return false;
  if (Provider.status === "ready") return true;
  if (Provider.status !== "warning") return false;
  const usable = new Set(
    Provider.subProviders?.flatMap((sub) =>
      sub.unavailableReason === undefined ? [sub.name] : [],
    ),
  );
  return Provider.models.some(
    (model) => model.subProvider !== undefined && usable.has(model.subProvider),
  );
}

// Follows resolveSelectableProviderInstanceEntry in apps/web/src/providerInstances.ts.
const selectable = (entries: IEntry[]) =>
  entries.find(healthy) ??
  entries.find(
    (entry) =>
      entry.Enabled &&
      entry.Provider.availability !== "unavailable" &&
      entry.Provider.status !== "error",
  );

// Follows resolveProjectDefaultProviderModelSelection, providerInstanceEntriesFor and
// getDefaultProviderInstanceModel in apps/web/src/providerInstances.ts.
function projectProviderDefault(
  providers: readonly ServerProvider[],
  settings: ServerSettings,
  projectId: ProjectId,
): ModelSelection | null {
  const byDriver = new Map<string, IEntry[]>();
  for (const provider of providers) {
    const entry = {
      Provider: provider,
      Enabled: resolveProjectProviderInstanceEnabled(settings, projectId, provider.instanceId),
    };
    const bucket = byDriver.get(provider.driver);
    if (bucket === undefined) byDriver.set(provider.driver, [entry]);
    else bucket.push(entry);
  }
  const isDefault = (entry: IEntry) =>
    entry.Provider.instanceId === defaultInstanceIdForDriver(entry.Provider.driver);
  const groups = [...byDriver.values()].map((bucket) => [
    ...bucket.filter(isDefault),
    ...bucket.filter((entry) => !isDefault(entry)),
  ]);
  const entry = selectable(groups[0] ?? []) ?? selectable(groups.flat());
  if (entry === undefined) return null;
  const { models, driver, instanceId } = entry.Provider;
  const model =
    models.find((held) => held.isDefault && !held.isCustom)?.slug ??
    models.find((held) => !held.isCustom)?.slug ??
    models[0]?.slug ??
    DEFAULT_MODEL_BY_PROVIDER[driver as keyof typeof DEFAULT_MODEL_BY_PROVIDER];
  return model === undefined ? null : { instanceId, model };
}

export interface INewThreadContext {
  Config: IWireServerConfig;
  ProjectId: string;
  Project: LegacyProjectSettingsFields | undefined;
  Now: number;
}

// Only plain fields are read here; the encoded ones (durations) never reach these helpers.
const serverSettings = (config: IWireServerConfig) => config.settings as unknown as ServerSettings;

function resolution(context: INewThreadContext, defaultSelection: ModelSelection | null) {
  const settings = serverSettings(context.Config);
  return resolveNewThreadModelSelection({
    defaultSelection,
    fallbackSelection: settings.fallbackModelSelection,
    providers: context.Config.providers as readonly ServerProvider[],
    settings,
    projectId: context.ProjectId as ProjectId,
    now: context.Now,
  });
}

const configuredModel = (context: INewThreadContext) =>
  resolveProjectSettings(
    serverSettings(context.Config),
    context.ProjectId as ProjectId,
    context.Project,
  ).settings.defaultModelSelection ?? null;

const providerDefault = (context: INewThreadContext) =>
  projectProviderDefault(
    context.Config.providers as readonly ServerProvider[],
    serverSettings(context.Config),
    context.ProjectId as ProjectId,
  );

// Follows draftModelResolution in apps/web/src/components/ChatView.tsx.
/** The model a new thread shows and sends when nothing was picked for it. */
export function draftModel(context: INewThreadContext): IWireModelSelection | null {
  const chosen = resolution(context, configuredModel(context) ?? providerDefault(context));
  return chosen.selection as IWireModelSelection | null;
}

// Follows resolveNewThreadModelSelectionOverride in apps/web/src/lib/chatThreadActions.ts and its
// caller in apps/web/src/hooks/useHandleNewThread.ts.
/**
 * The model a new thread starts on in place of the last pick: the project's default, or its
 * fallback when the default's usage is spent, else the model of the thread it was started from.
 */
export function newThreadModelOverride(
  context: INewThreadContext,
  carry: IWireModelSelection | null,
  hasLastPick: boolean,
): IWireModelSelection | null {
  const configured = configuredModel(context);
  const chosen = resolution(
    context,
    configured ?? (carry !== null || hasLastPick ? null : providerDefault(context)),
  );
  const projectDefault = chosen.fallback ? chosen.selection : configured;
  return (projectDefault as IWireModelSelection | null) ?? carry;
}

// Follows defaultRuntimeMode in apps/web/src/components/ChatView.tsx.
export const projectRuntimeMode = (
  config: IWireServerConfig,
  projectId: string | null,
): RuntimeMode =>
  resolveProjectSettings(serverSettings(config), projectId as ProjectId | null).settings
    .defaultRuntimeMode;
