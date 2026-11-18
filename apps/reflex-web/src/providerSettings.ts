import { isReasoningControl } from "@t3tools/client-runtime/model-traits";
import {
  DEFAULT_SERVER_SETTINGS,
  IDLE_COMPACTION_MODES,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
} from "@t3tools/contracts";

import type {
  IWireInstanceMutation,
  IWireServerConfig,
  IWireServerSettings,
  IWireSettingsPatch,
} from "./Infrastructure/settings";

type IWireProvider = IWireServerConfig["providers"][number];
type IWireProviderModel = IWireProvider["models"][number];

export interface IProviderModelRow {
  Slug: string;
  Name: string;
  Hidden: boolean;
  Favorite: boolean;
  Custom: boolean;
  Tags: string[];
}

export interface IProviderRow {
  InstanceId: string;
  Driver: string;
  Name: string;
  Enabled: boolean;
  Status: string;
  Version: string | null;
  Headline: string;
  Message: string | null;
  Models: IProviderModelRow[];
}

const ALIAS_SLUGS = new Set(["default", "auto"]);

const hasReasoningControl = (model: IWireProviderModel) =>
  (model.capabilities?.optionDescriptors ?? []).some((descriptor) =>
    isReasoningControl(descriptor as ProviderOptionDescriptor),
  );

// Follows describeModelCapabilities in apps/web/src/components/settings/ProviderModelsSection.tsx.
function modelTags(model: IWireProviderModel, flagMissingReasoning: boolean): string[] {
  const descriptors = model.capabilities?.optionDescriptors ?? [];
  const tags: string[] = [];
  const fast = descriptors.some(
    (descriptor) =>
      descriptor.id === "fastMode" ||
      (descriptor.id === "serviceTier" &&
        descriptor.type === "select" &&
        descriptor.options.some((option) => option.id === "fast" || option.label === "Fast")),
  );
  if (fast) tags.push("Fast mode");
  if (
    flagMissingReasoning &&
    model.isCustom !== true &&
    model.capabilities != null &&
    !ALIAS_SLUGS.has(model.slug) &&
    !hasReasoningControl(model)
  ) {
    tags.push("No reasoning");
  }
  return tags;
}

// Follows getProviderSummary in apps/web/src/components/settings/providerStatus.ts.
export function providerHeadline(provider: IWireProvider): string {
  const authLabel = provider.auth.label ?? provider.auth.type;
  if (!provider.enabled || provider.status === "disabled") return "Disabled";
  if (!provider.installed) return "Not found";
  if (provider.auth.status === "unauthenticated") {
    return authLabel ? `Not authenticated · ${authLabel}` : "Not authenticated";
  }
  if (provider.status === "warning") return "Needs attention";
  if (provider.status === "error") return "Unavailable";
  if (provider.auth.status === "authenticated") {
    return authLabel ? `Authenticated · ${authLabel}` : "Authenticated";
  }
  return "Available";
}

// Follows ProviderModelsSection.tsx: every model, hidden ones too, in the stored order.
export function providerRows(config: IWireServerConfig): IProviderRow[] {
  const settings = config.settings;
  const favorites = settings.favorites ?? [];
  // Stock's other drivers wait behind Add provider until configured or enabled.
  const listed = (provider: IWireProvider) =>
    provider.driver === "codex" ||
    provider.driver === "claudeAgent" ||
    provider.enabled ||
    settings.providerInstances?.[provider.instanceId] !== undefined;
  return config.providers.filter(listed).map((provider: IWireProvider) => {
    const preferences = settings.providerModelPreferences?.[provider.instanceId];
    const hidden = new Set(preferences?.hiddenModels ?? []);
    const order = new Map((preferences?.modelOrder ?? []).map((slug, index) => [slug, index]));
    const flagMissingReasoning = provider.models.some(hasReasoningControl);
    const models = provider.models
      .map((model, index) => ({ model, index }))
      .sort(
        (left, right) =>
          (order.get(left.model.slug) ?? Number.POSITIVE_INFINITY) -
            (order.get(right.model.slug) ?? Number.POSITIVE_INFINITY) || left.index - right.index,
      )
      .map(({ model }) => ({
        Slug: model.slug,
        Name: model.name,
        Hidden: model.isCustom !== true && hidden.has(model.slug),
        Favorite: favorites.some(
          (favorite) => favorite.provider === provider.instanceId && favorite.model === model.slug,
        ),
        Custom: model.isCustom === true,
        Tags: modelTags(model, flagMissingReasoning),
      }));
    return {
      InstanceId: provider.instanceId,
      Driver: provider.driver,
      Name: provider.displayName ?? provider.instanceId,
      Enabled: provider.enabled,
      Status: provider.status,
      Version: provider.version,
      Headline: providerHeadline(provider),
      Message: provider.message ?? null,
      Models: models,
    };
  });
}

// Follows persistInstance and updateInstance in ProviderSettingsPanel.tsx.
export function providerEnabledWrite(
  settings: IWireServerSettings,
  row: Pick<IProviderRow, "InstanceId" | "Driver">,
  enabled: boolean,
): { Patch: IWireSettingsPatch; Mutation: IWireInstanceMutation } {
  const defaultTextGeneration = JSON.parse(
    JSON.stringify(DEFAULT_SERVER_SETTINGS.textGenerationModelSelection),
  ) as IWireServerSettings["textGenerationModelSelection"];
  const instanceId = ProviderInstanceId.make(row.InstanceId);
  const instance = settings.providerInstances?.[instanceId] ?? {
    driver: ProviderDriverKind.make(row.Driver),
  };
  const clearsTextGeneration =
    !enabled && settings.textGenerationModelSelection?.instanceId === row.InstanceId;
  return {
    Patch: clearsTextGeneration ? { textGenerationModelSelection: defaultTextGeneration } : {},
    Mutation: { operation: "upsert", instanceId, instance: { ...instance, enabled } },
  };
}

// Follows the Claude instance's `idleCompaction` field in ClaudeSettings (packages/contracts),
// as ProviderSettingsSelect in ProviderSettingsForm.tsx renders and writes it.
export const INSTANCE_IDLE_COMPACTION_OPTIONS = [
  { Value: "default", Label: "Use default" },
  ...IDLE_COMPACTION_MODES.map((mode) => ({ Value: mode.value, Label: mode.label })),
];
export const INSTANCE_IDLE_COMPACTION_DESCRIPTION =
  "When to compact an idle thread over 200,000 tokens: after you return, just before its prompt cache expires, or never. Overrides the default in Providers > Advanced.";

export const hasIdleCompactionOverride = (row: Pick<IProviderRow, "Driver">) =>
  row.Driver === "claudeAgent";

const instanceConfig = (settings: IWireServerSettings, instanceId: string) => {
  const config = settings.providerInstances?.[ProviderInstanceId.make(instanceId)]?.config;
  return config !== null && typeof config === "object" ? (config as Record<string, unknown>) : {};
};

export function instanceIdleCompaction(
  settings: IWireServerSettings,
  row: Pick<IProviderRow, "InstanceId">,
): string {
  const value = instanceConfig(settings, row.InstanceId).idleCompaction;
  return typeof value === "string" && value !== "" ? value : "default";
}

/** "Use default" drops the key, and a config left empty is dropped with it. */
export function instanceIdleCompactionWrite(
  settings: IWireServerSettings,
  row: Pick<IProviderRow, "InstanceId" | "Driver">,
  value: string,
): IWireInstanceMutation {
  const instanceId = ProviderInstanceId.make(row.InstanceId);
  const { config: _config, ...instance } = settings.providerInstances?.[instanceId] ?? {
    driver: ProviderDriverKind.make(row.Driver),
  };
  const config = { ...instanceConfig(settings, row.InstanceId) };
  if (value === "default") delete config.idleCompaction;
  else config.idleCompaction = value;
  return {
    operation: "upsert",
    instanceId,
    instance: Object.keys(config).length > 0 ? { ...instance, config } : instance,
  };
}

export const modelHiddenPatch = (
  instanceId: string,
  slug: string,
  hidden: boolean,
): IWireSettingsPatch => ({
  setModelsHidden: [{ provider: ProviderInstanceId.make(instanceId), model: slug, hidden }],
});

export const modelFavoritePatch = (
  instanceId: string,
  slug: string,
  favorite: boolean,
): IWireSettingsPatch => ({
  setModelFavorites: [{ provider: ProviderInstanceId.make(instanceId), model: slug, favorite }],
});

export const allBuiltInHidden = (row: Pick<IProviderRow, "Models">) => {
  const builtIn = row.Models.filter((model) => !model.Custom);
  return builtIn.length > 0 && builtIn.every((model) => model.Hidden);
};

// Follows nextHiddenModelsForBulkToggle in ProviderModelsSection.tsx: hides every built-in model,
// or shows them all once they're all hidden.
export function bulkHiddenPatch(
  row: Pick<IProviderRow, "InstanceId" | "Models">,
): IWireSettingsPatch | null {
  const builtIn = row.Models.filter((model) => !model.Custom);
  if (builtIn.length === 0) return null;
  const hidden = !allBuiltInHidden(row);
  return {
    setModelsHidden: builtIn.map((model) => ({
      provider: ProviderInstanceId.make(row.InstanceId),
      model: model.Slug,
      hidden,
    })),
  };
}

export const MODEL_FILTER_THRESHOLD = 8;

export const filterModels = (models: IProviderModelRow[], filter: string) => {
  const needle = filter.trim().toLowerCase();
  return needle === ""
    ? models
    : models.filter(
        (model) =>
          model.Name.toLowerCase().includes(needle) || model.Slug.toLowerCase().includes(needle),
      );
};

/** The whole order with `slug` moved one place; null at either end. */
export function modelMovePatch(
  row: Pick<IProviderRow, "InstanceId" | "Models">,
  slug: string,
  direction: -1 | 1,
): IWireSettingsPatch | null {
  const order = row.Models.map((model) => model.Slug);
  const from = order.indexOf(slug);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= order.length) return null;
  [order[from], order[to]] = [order[to]!, order[from]!];
  return {
    setProviderModelOrder: {
      provider: ProviderInstanceId.make(row.InstanceId),
      modelOrder: order,
    },
  };
}
