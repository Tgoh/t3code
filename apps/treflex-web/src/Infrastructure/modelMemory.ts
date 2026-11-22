import type { ProviderOptionSelection } from "@t3tools/contracts";
import { defineEffect, type IEffect, implementation } from "treflex";

import type { IWireModelSelection } from "./commandEffects";

export interface IRememberedModels {
  Last: IWireModelSelection | null;
  OptionsByModel: Record<string, ProviderOptionSelection[]>;
}

interface IRememberedModelsEffect extends IEffect {
  Type: "rememberedModels";
}

interface IRememberModelEffect extends IEffect {
  Type: "rememberModel";
  Selection: IWireModelSelection;
}

// Named before the client became treflex; renaming it would drop the stored models.
const KEY = "reflex-web:models";

export const rememberedModelKey = (instanceId: string, model: string) => `${instanceId}\n${model}`;

export const rememberedModelsEffect = defineEffect<IRememberedModelsEffect, IRememberedModels>(
  "rememberedModels",
  { settles: "sync" },
);

export const rememberModelEffect = defineEffect<IRememberModelEffect, void>("rememberModel");

function read(): IRememberedModels {
  const held = localStorage.getItem(KEY);
  return held === null
    ? { Last: null, OptionsByModel: {} }
    : (JSON.parse(held) as IRememberedModels);
}

export const rememberedModelsImpl = implementation(rememberedModelsEffect, read);

export const rememberModelImpl = implementation(rememberModelEffect, (effect) => {
  const held = read();
  const selection = effect.Selection;
  const options = (selection as { options?: ProviderOptionSelection[] }).options ?? [];
  held.Last = selection;
  held.OptionsByModel[rememberedModelKey(selection.instanceId, selection.model)] = options;
  localStorage.setItem(KEY, JSON.stringify(held));
});
