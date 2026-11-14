import * as Effect from "effect/Effect";
import { defineEffect, type IEffect, implementation } from "treflex";

interface IDelayEffect extends IEffect {
  Type: "delay";
  Ms: number;
}

export const delayEffect = defineEffect<IDelayEffect, void>("delay");

export const delayImpl = implementation(delayEffect, (effect, action) =>
  Effect.runPromise(Effect.sleep(effect.Ms), { signal: action?.signal }),
);
