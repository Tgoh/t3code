import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";

import type {
  IWireInstanceMutation,
  IWireServerConfig,
  IWireServerSettings,
  IWireSettingsPatch,
} from "./Infrastructure/settings";

type IWireProvider = IWireServerConfig["providers"][number];

export interface IProviderModelRow {
  Slug: string;
  Name: string;
  Hidden: boolean;
  Favorite: boolean;
  Custom: boolean;
}

export interface IProviderRow {
  InstanceId: string;
  Driver: string;
  Name: string;
  Enabled: boolean;
  Status: string;
  Version: string | null;
  Message: string | null;
  Models: IProviderModelRow[];
}

// Follows ProviderModelsSection.tsx: every model, hidden ones too, in the stored order.
export function providerRows(config: IWireServerConfig): IProviderRow[] {
  const settings = config.settings;
  const favorites = settings.favorites ?? [];
  return config.providers.map((provider: IWireProvider) => {
    const preferences = settings.providerModelPreferences?.[provider.instanceId];
    const hidden = new Set(preferences?.hiddenModels ?? []);
    const order = new Map((preferences?.modelOrder ?? []).map((slug, index) => [slug, index]));
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
      }));
    return {
      InstanceId: provider.instanceId,
      Driver: provider.driver,
      Name: provider.displayName ?? provider.instanceId,
      Enabled: provider.enabled,
      Status: provider.status,
      Version: provider.version,
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
