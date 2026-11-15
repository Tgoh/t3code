import { defineEffect, type IEffect, implementation, type ISerializedThrow } from "treflex";

interface ILogFailureEffect extends IEffect {
  Type: "logFailure";
  ActionName: string;
  Error: ISerializedThrow;
}

export const logFailureEffect = defineEffect<ILogFailureEffect, void>("logFailure");

export const logFailureImpl = implementation(logFailureEffect, (effect) => {
  console.error(`[reflex-web] ${effect.ActionName} failed:`, effect.Error);
});
