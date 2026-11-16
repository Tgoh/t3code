import {
  buildTraitsTriggerDisplay,
  getDescriptorStringValue,
  getTraitSelectChange,
  isReasoningControl,
  replaceDescriptorCurrentValue,
} from "@t3tools/client-runtime/model-traits";
import { rankModelPickerSearch } from "@t3tools/client-runtime/model-search";
import type {
  ModelCapabilities,
  ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
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
  IProviderOption,
  IWireModelSelection,
  IWireRuntimeMode,
} from "./Infrastructure/commandEffects";

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

// Opencode and Cursor run models outside their catalog; their saved options pass through as-is.
function isOffCatalog(provider: IProviderOption | undefined, model: string): boolean {
  const driver = driverOf(provider);
  if (driver !== "opencode" && driver !== "cursor") return false;
  const slug = normalizeModelSlug(model, driver);
  return !(provider?.Models ?? []).some((candidate) => candidate.Slug === slug);
}

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
  return "This thread does not support switching providers after it has started. Start a new thread to use this model.";
}

export interface IPickerModel {
  InstanceId: string;
  Driver: string | undefined;
  ProviderName: string;
  Slug: string;
  Name: string;
}

/** The provider's models, or a ranked search across every provider while a query is typed. */
export function pickerModels(
  providers: ReadonlyArray<IProviderOption>,
  instanceId: string | null,
  query: string,
): IPickerModel[] {
  const all = providers.flatMap((provider) =>
    provider.Models.map((model) => ({
      InstanceId: provider.InstanceId,
      Driver: provider.Driver,
      ProviderName: provider.Name,
      Slug: model.Slug,
      Name: model.Name,
      ShortName: model.ShortName,
      SubProvider: model.SubProvider,
    })),
  );
  const ranked =
    query.trim() === ""
      ? all.filter((model) => model.InstanceId === instanceId)
      : rankModelPickerSearch(all, query, (model) => ({
          driverKind: model.Driver ?? model.InstanceId,
          providerDisplayName: model.ProviderName,
          name: model.Name,
          ...(model.ShortName === undefined ? {} : { shortName: model.ShortName }),
          ...(model.SubProvider === undefined ? {} : { subProvider: model.SubProvider }),
        }));
  return ranked.map(({ ShortName: _short, SubProvider: _sub, ...model }) => model);
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
