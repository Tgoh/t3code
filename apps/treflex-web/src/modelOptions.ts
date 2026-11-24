import {
  buildTraitsTriggerDisplay,
  getDescriptorStringValue,
  getTraitSelectChange,
  isReasoningControl,
  replaceDescriptorCurrentValue,
} from "@t3tools/client-runtime/model-traits";
import { rankModelPickerSearch } from "@t3tools/client-runtime/model-search";
import {
  normalizeProviderAccentColor,
  providerInstanceInitials,
  resolveProviderInstanceDisplayName,
  shouldShowInstanceBadge,
} from "@t3tools/client-runtime/state/provider-instance-display";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  isProviderAvailable,
  type ModelCapabilities,
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
} from "@t3tools/contracts";
import {
  buildExplicitProviderOptionSelectionsFromDescriptors,
  buildProviderOptionSelectionsFromDescriptors,
  createModelSelection,
  getProviderOptionCurrentLabel,
  getProviderOptionDescriptors,
  normalizeModelSlug,
  resolveSelectableModel,
  withImplicitFastModeDefault,
} from "@t3tools/shared/model";

import type {
  IModelFavorite,
  IProviderOption,
  IWireModelSelection,
  IWireRuntimeMode,
} from "./Infrastructure/commandEffects";
import type { IWireServerConfig } from "./Infrastructure/settings";

export type ISelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;
export type IBooleanDescriptor = Extract<ProviderOptionDescriptor, { type: "boolean" }>;
export type IColumnControl =
  | { Kind: "select"; Descriptor: ISelectDescriptor }
  | { Kind: "boolean"; Descriptor: IBooleanDescriptor };

export interface ITraits {
  Descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  Effort: IColumnControl | null;
  Others: IColumnControl[];
  Speed: ISelectDescriptor | null;
  Fast: IBooleanDescriptor | null;
  Ultracode: IBooleanDescriptor | null;
}

const asSelection = (selection: IWireModelSelection) => selection as unknown as ModelSelection;
const toWire = (selection: ModelSelection) => selection as unknown as IWireModelSelection;
const driverOf = (provider: IProviderOption | undefined) =>
  (provider?.Driver ?? provider?.InstanceId ?? "codex") as ProviderDriverKind;

export const providerOf = (
  providers: ReadonlyArray<IProviderOption>,
  selection: IWireModelSelection,
) => providers.find((provider) => provider.InstanceId === selection.instanceId);

// Follows hasRuntimeModelCatalog and isRuntimeModelDefaultAlias in apps/web/src/providerModels.ts:
// these drivers discover models at runtime, so a refresh can drop the model a thread uses.
const RUNTIME_CATALOG_DRIVERS = new Set(["opencode", "antigravity", "cursor", "pi", "acpRegistry"]);

function missingFromCatalog(provider: IProviderOption | undefined, model: string): boolean {
  const driver = driverOf(provider);
  if (!RUNTIME_CATALOG_DRIVERS.has(driver)) return false;
  if (
    (driver === "antigravity" || driver === "acpRegistry") &&
    model === DEFAULT_MODEL_BY_PROVIDER[driver]
  ) {
    return false;
  }
  const slug = normalizeModelSlug(model, driver);
  return !(provider?.Models ?? []).some((candidate) => candidate.Slug === slug);
}

// Follows keepsUnavailableModelOptions: Antigravity lists its default only as an alias, which a
// slug lookup would call missing.
const isOffCatalog = (provider: IProviderOption | undefined, model: string) =>
  driverOf(provider) !== "antigravity" && missingFromCatalog(provider, model);

function withoutPlanAgent(caps: ModelCapabilities): ModelCapabilities {
  return {
    ...caps,
    optionDescriptors: (caps.optionDescriptors ?? []).flatMap((descriptor) => {
      if (descriptor.type !== "select" || descriptor.id !== "agent") return [descriptor];
      const options = descriptor.options.filter((option) => option.id !== "plan");
      if (options.length === 0) return [];
      const currentValue =
        descriptor.currentValue && options.some((option) => option.id === descriptor.currentValue)
          ? descriptor.currentValue
          : (options.find((option) => option.isDefault)?.id ?? options[0]?.id);
      return [{ ...descriptor, options, ...(currentValue ? { currentValue } : {}) }];
    }),
  };
}

function capabilities(provider: IProviderOption | undefined, model: string): ModelCapabilities {
  const models = (provider?.Models ?? []).map((held) => ({ slug: held.Slug, name: held.Name }));
  const slug = resolveSelectableModel(driverOf(provider), model, models);
  const held = provider?.Models.find((candidate) => candidate.Slug === slug);
  return withoutPlanAgent(held?.Capabilities ?? { optionDescriptors: [] });
}

function resolved(provider: IProviderOption | undefined, selection: IWireModelSelection) {
  const caps = capabilities(provider, selection.model);
  const selections = withImplicitFastModeDefault(caps, asSelection(selection).options);
  return { selections, descriptors: getProviderOptionDescriptors({ caps, selections }) };
}

/** The model's options as the picker shows them: reasoning in the column, speed in the footer. */
export function modelTraits(
  provider: IProviderOption | undefined,
  selection: IWireModelSelection,
): ITraits {
  const descriptors = isOffCatalog(provider, selection.model)
    ? []
    : resolved(provider, selection).descriptors;
  const selects = descriptors.filter((held): held is ISelectDescriptor => held.type === "select");
  const toggles = descriptors.filter((held): held is IBooleanDescriptor => held.type === "boolean");
  const speed = selects.find((held) => held.id === "serviceTier") ?? null;
  const fast = toggles.find((held) => held.id === "fastMode") ?? null;
  const ultracode = toggles.find((held) => held.id === "ultracode") ?? null;
  const controls: IColumnControl[] = [
    ...selects
      .filter((held) => held !== speed)
      .map((held) => ({ Kind: "select" as const, Descriptor: held })),
    ...toggles
      .filter((held) => held !== fast && held !== ultracode)
      .map((held) => ({ Kind: "boolean" as const, Descriptor: held })),
  ];
  const effort = controls.find((control) => isReasoningControl(control.Descriptor)) ?? null;
  return {
    Descriptors: descriptors,
    Effort: effort,
    Others: controls.filter((control) => control !== effort),
    Speed: speed,
    Fast: fast,
    Ultracode: ultracode,
  };
}

export const selectValue = (descriptor: ISelectDescriptor, selection: IWireModelSelection) =>
  getDescriptorStringValue(descriptor, asSelection(selection)) ?? "";

/** The selection after picking a select option, or null when the option can't be picked. */
export function withSelectValue(
  traits: ITraits,
  selection: IWireModelSelection,
  descriptor: ISelectDescriptor,
  value: string,
): IWireModelSelection | null {
  const change = getTraitSelectChange(
    {
      descriptors: traits.Descriptors,
      primarySelectDescriptor:
        traits.Descriptors.find((held): held is ISelectDescriptor => held.type === "select") ??
        null,
      ultrathinkPromptControlled: false,
      ultrathinkInBodyText: false,
    },
    descriptor,
    "",
    value,
  );
  if (change === null) return null;
  return toWire(
    createModelSelection(
      selection.instanceId as ProviderInstanceId,
      selection.model,
      change.modelOptions,
    ),
  );
}

export function withBooleanValue(
  traits: ITraits,
  selection: IWireModelSelection,
  descriptorId: string,
  value: boolean,
): IWireModelSelection {
  return toWire(
    createModelSelection(
      selection.instanceId as ProviderInstanceId,
      selection.model,
      buildProviderOptionSelectionsFromDescriptors(
        replaceDescriptorCurrentValue(traits.Descriptors, descriptorId, value),
      ),
    ),
  );
}

/** What a turn sends: the options the user stated, normalized against the model's catalog. */
export function dispatchSelection(
  provider: IProviderOption | undefined,
  selection: IWireModelSelection,
): IWireModelSelection {
  const instanceId = selection.instanceId as ProviderInstanceId;
  if (isOffCatalog(provider, selection.model)) {
    const options = asSelection(selection).options?.filter(
      (option) => option.id !== "agent" || option.value !== "plan",
    );
    return toWire(createModelSelection(instanceId, selection.model, options));
  }
  const { selections, descriptors } = resolved(provider, selection);
  return toWire(
    createModelSelection(
      instanceId,
      selection.model,
      buildExplicitProviderOptionSelectionsFromDescriptors(descriptors, selections),
    ),
  );
}

export interface ITriggerSuffix {
  Word: string | null;
  Speed: "Fast" | "Ultrafast" | null;
  Ultracode: boolean;
  ContextWindow: string | null;
  Detail: string | null;
}

/** What the model trigger shows after the name, with the effort shown as its word. */
export function triggerSuffix(traits: ITraits, selection: IWireModelSelection): ITriggerSuffix {
  const modelSelection = asSelection(selection);
  const primary =
    traits.Descriptors.find((held): held is ISelectDescriptor => held.type === "select") ?? null;
  const display = buildTraitsTriggerDisplay({
    descriptors: traits.Descriptors,
    primarySelectDescriptorId: primary?.id ?? null,
    ultrathinkPromptControlled: false,
    modelSelection,
  });
  const reasoning = traits.Effort?.Descriptor ?? null;
  const word =
    reasoning === null
      ? null
      : reasoning.type === "boolean"
        ? `${reasoning.label} ${reasoning.currentValue === true ? "On" : "Off"}`
        : (getProviderOptionCurrentLabel(reasoning, modelSelection) ??
          (reasoning.id === "thinking" ? reasoning.label : null));
  const contextWindowDescriptor =
    traits.Descriptors.find((held) => held.type === "select" && held.id === "contextWindow") ??
    null;
  const contextWindow =
    contextWindowDescriptor === null
      ? null
      : (getProviderOptionCurrentLabel(contextWindowDescriptor, modelSelection) ?? null);
  const speed =
    display.speedLabel === "Fast" || display.speedLabel === "Ultrafast" ? display.speedLabel : null;
  return {
    Word: word,
    Speed: speed,
    Ultracode: display.ultracode,
    ContextWindow: contextWindow,
    Detail: display.label === "" ? null : display.label,
  };
}

/** Options to carry onto a newly picked model: remembered ones, else the thread's for its own model. */
export function pickedSelection(
  instanceId: string,
  model: string,
  remembered: ReadonlyArray<ProviderOptionSelection> | undefined,
  thread: IWireModelSelection | null,
): IWireModelSelection {
  const options =
    remembered !== undefined && remembered.length > 0
      ? remembered
      : thread !== null && thread.instanceId === instanceId && thread.model === model
        ? asSelection(thread).options
        : undefined;
  return toWire(createModelSelection(instanceId as ProviderInstanceId, model, options));
}

/** Why a started thread can't move to this model, or null when it can. */
export function modelChangeBlock(input: {
  Started: boolean;
  SupportsHandoff: boolean;
  CurrentInstanceId: string | null;
  NextInstanceId: string;
}): string | null {
  if (!input.Started || input.CurrentInstanceId === null) return null;
  if (input.CurrentInstanceId === input.NextInstanceId || input.SupportsHandoff) return null;
  return "This thread does not support switching providers after it has started.";
}

export const FAVORITES_TAB = "favorites";

export interface IPickerModel {
  InstanceId: string;
  Driver: string | undefined;
  ProviderName: string;
  Slug: string;
  Name: string;
  IsFavorite: boolean;
  IsUnavailable?: true;
}

export interface IPickerList {
  Models: IPickerModel[];
  /** Older models behind Show more on a provider tab, or null when there are none. */
  Legacy: { Count: number; Expanded: boolean } | null;
}

const favoriteKey = (instanceId: string, slug: string) => `${instanceId}\n${slug}`;

/** Hides the models the user hid for this provider and applies their order, as stock's settings do. */
export function applyModelPreferences<T extends { slug: string; isCustom?: boolean | undefined }>(
  models: ReadonlyArray<T>,
  preferences:
    | { readonly hiddenModels: ReadonlyArray<string>; readonly modelOrder: ReadonlyArray<string> }
    | undefined,
): T[] {
  const hidden = new Set(preferences?.hiddenModels ?? []);
  const order = new Map((preferences?.modelOrder ?? []).map((slug, index) => [slug, index]));
  return models
    .map((model, index) => ({ model, index }))
    .filter(({ model }) => model.isCustom === true || !hidden.has(model.slug))
    .sort(
      (left, right) =>
        (order.get(left.model.slug) ?? Number.POSITIVE_INFINITY) -
          (order.get(right.model.slug) ?? Number.POSITIVE_INFINITY) || left.index - right.index,
    )
    .map(({ model }) => model);
}

/** The providers the composer offers: enabled and available, with the user's model preferences. */
export function providerOptions(config: IWireServerConfig): IProviderOption[] {
  const preferences = config.settings?.providerModelPreferences ?? {};
  return config.providers
    .filter(
      (provider) =>
        provider.enabled &&
        isProviderAvailable(provider as unknown as Parameters<typeof isProviderAvailable>[0]),
    )
    .map((provider): IProviderOption => {
      const preference = preferences[provider.instanceId];
      return {
        InstanceId: provider.instanceId,
        Driver: provider.driver,
        Name: provider.displayName ?? provider.instanceId,
        ...(provider.supportsConversationRollback === false ? { SupportsRollback: false } : {}),
        ...(provider.supportedRuntimeModes === undefined
          ? {}
          : { SupportedRuntimeModes: [...provider.supportedRuntimeModes] }),
        ...(provider.slashCommands.length === 0
          ? {}
          : { SlashCommands: [...provider.slashCommands] }),
        ...(provider.skills.length === 0 ? {} : { Skills: [...provider.skills] }),
        ...((preference?.hiddenModels.length ?? 0) === 0
          ? {}
          : { HiddenModels: [...preference!.hiddenModels] }),
        Models: applyModelPreferences(provider.models, preference).map((model) => ({
          Slug: model.slug,
          Name: model.name,
          ...(model.shortName === undefined ? {} : { ShortName: model.shortName }),
          ...(model.subProvider === undefined ? {} : { SubProvider: model.subProvider }),
          IsDefault: model.isDefault === true,
          ...(model.isLegacy === true ? { IsLegacy: true } : {}),
          ...(model.capabilities == null
            ? {}
            : { Capabilities: model.capabilities as ModelCapabilities }),
        })),
      };
    });
}

export interface IInstanceBadge {
  Name: string;
  Initials: string;
  Accent?: string;
}

// Follows deriveProviderInstanceEntries and applyProviderInstanceBranding in apps/web/src/providerInstances.ts.
export function instanceBadges(config: IWireServerConfig): Record<string, IInstanceBadge> {
  const instances = config.settings?.providerInstances ?? {};
  const entries = config.providers.map((provider) => {
    const raw = provider.driver === "acpRegistry" ? instances[provider.instanceId]?.config : null;
    const branding =
      raw !== null && typeof raw === "object" ? (raw as Readonly<Record<string, unknown>>) : null;
    const agentId =
      branding?.source === "local" || typeof branding?.agentId !== "string"
        ? ""
        : branding.agentId.trim();
    return {
      provider,
      driverKind: ProviderDriverKind.make(provider.driver),
      accentColor: normalizeProviderAccentColor(provider.accentColor),
      ...(agentId === "" ? {} : { acpRegistryAgentId: agentId }),
      enabled: provider.enabled,
    };
  });
  const badges: Record<string, IInstanceBadge> = {};
  for (const entry of entries) {
    if (!shouldShowInstanceBadge(entry, entries)) continue;
    const name = resolveProviderInstanceDisplayName({
      instanceId: ProviderInstanceId.make(entry.provider.instanceId),
      driver: entry.driverKind,
      displayName: entry.provider.displayName,
    });
    badges[entry.provider.instanceId] = {
      Name: name,
      Initials: providerInstanceInitials(name),
      ...(entry.accentColor === undefined ? {} : { Accent: entry.accentColor }),
    };
  }
  return badges;
}

export const modelFavoritesOf = (config: IWireServerConfig): IModelFavorite[] =>
  (config.settings?.favorites ?? []).map((favorite) => ({
    Provider: favorite.provider,
    Model: favorite.model,
  }));

/** Favorites first when any is offered, except on a started thread, which opens on its own provider. */
export function initialPickerTab(input: {
  Providers: ReadonlyArray<IProviderOption>;
  Favorites: ReadonlyArray<IModelFavorite>;
  ActiveInstanceId: string | null;
  Started: boolean;
}): string | null {
  const active = input.ActiveInstanceId ?? input.Providers[0]?.InstanceId ?? null;
  if (input.Started) return active;
  const offered = input.Favorites.some((favorite) =>
    input.Providers.some(
      (provider) =>
        provider.InstanceId === favorite.Provider &&
        provider.Models.some((model) => model.Slug === favorite.Model),
    ),
  );
  return offered ? FAVORITES_TAB : active;
}

/** Whether a provider tab opens with its older models shown: only when the active model is one of them. */
export function legacyStartsExpanded(
  providers: ReadonlyArray<IProviderOption>,
  favorites: ReadonlyArray<IModelFavorite>,
  selection: IWireModelSelection | null,
): boolean {
  if (selection === null) return false;
  const model = providerOf(providers, selection)?.Models.find(
    (held) => held.Slug === selection.model,
  );
  return (
    model?.IsLegacy === true &&
    !favorites.some(
      (favorite) => favorite.Provider === selection.instanceId && favorite.Model === model.Slug,
    )
  );
}

/**
 * A provider tab lists favorites first, then its current models, with older ones behind Show more.
 * The Favorites tab lists favorites in provider order, and a query ranks every provider's models.
 */
export function pickerList(input: {
  Providers: ReadonlyArray<IProviderOption>;
  Favorites: ReadonlyArray<IModelFavorite>;
  Tab: string | null;
  Query: string;
  LegacyExpanded: boolean;
  Active: IWireModelSelection | null;
}): IPickerList {
  const favorites = new Set(
    input.Favorites.map((favorite) => favoriteKey(favorite.Provider, favorite.Model)),
  );
  const active = input.Active;
  const all = input.Providers.flatMap((provider) => {
    const models: Array<IProviderOption["Models"][number] & { IsUnavailable?: true }> = [
      ...provider.Models,
    ];
    // Follows appendUnavailableDynamicModelSelection in apps/web/src/modelSelection.ts.
    const slug = active?.instanceId === provider.InstanceId ? active.model.trim() : "";
    if (
      slug !== "" &&
      !(provider.HiddenModels ?? []).includes(slug) &&
      missingFromCatalog(provider, slug)
    ) {
      models.push({ Slug: slug, Name: slug, IsDefault: false, IsUnavailable: true });
    }
    return models.map((model) => ({
      InstanceId: provider.InstanceId,
      Driver: provider.Driver,
      ProviderName: provider.Name,
      Slug: model.Slug,
      Name: model.Name,
      IsFavorite: favorites.has(favoriteKey(provider.InstanceId, model.Slug)),
      ...(model.IsUnavailable ? { IsUnavailable: true as const } : {}),
      IsLegacy: model.IsLegacy === true,
      ShortName: model.ShortName,
      SubProvider: model.SubProvider,
    }));
  });
  const shown = (models: typeof all): IPickerModel[] =>
    models.map(({ IsLegacy: _legacy, ShortName: _short, SubProvider: _sub, ...model }) => model);
  if (input.Query.trim() !== "") {
    const ranked = rankModelPickerSearch(all, input.Query, (model) => ({
      driverKind: model.Driver ?? model.InstanceId,
      providerDisplayName: model.ProviderName,
      name: model.Name,
      isFavorite: model.IsFavorite,
      ...(model.ShortName === undefined ? {} : { shortName: model.ShortName }),
      ...(model.SubProvider === undefined ? {} : { subProvider: model.SubProvider }),
    }));
    return { Models: shown(ranked), Legacy: null };
  }
  if (input.Tab === FAVORITES_TAB) {
    return { Models: shown(all.filter((model) => model.IsFavorite)), Legacy: null };
  }
  const tab = all.filter((model) => model.InstanceId === input.Tab);
  const ordered = [
    ...tab.filter((model) => model.IsFavorite),
    ...tab.filter((model) => !model.IsFavorite),
  ];
  const current = ordered.filter((model) => !model.IsLegacy || model.IsFavorite);
  const legacy = ordered.filter((model) => model.IsLegacy && !model.IsFavorite);
  if (legacy.length === 0) return { Models: shown(current), Legacy: null };
  return {
    Models: shown(input.LegacyExpanded ? [...current, ...legacy] : current),
    Legacy: { Count: legacy.length, Expanded: input.LegacyExpanded },
  };
}

export const RUNTIME_MODES: ReadonlyArray<IWireRuntimeMode> = [
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
];

/** The modes a provider supports (all when it reports none) and the mode a thread really runs in. */
export function compatibleRuntimeMode(
  mode: IWireRuntimeMode,
  supported: ReadonlyArray<IWireRuntimeMode> | undefined,
) {
  const modes =
    supported !== undefined && supported.length > 0
      ? RUNTIME_MODES.filter((held) => supported.includes(held))
      : RUNTIME_MODES;
  return { Modes: modes, Mode: modes.includes(mode) ? mode : (modes[0] ?? mode) };
}
