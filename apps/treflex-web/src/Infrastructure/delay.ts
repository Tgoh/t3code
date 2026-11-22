// @effect-diagnostics globalTimers:off -- An action's wait, outside any Effect runtime.
import { defineEffect, type IEffect, implementation } from "treflex";

interface IDelayEffect extends IEffect {
  Type: "delay";
  Ms: number;
}

const delayEffect = defineEffect<IDelayEffect, void>("delay");

export const delay = (ms: number) => delayEffect({ Ms: ms });

export const delayImpl = implementation(
  delayEffect,
  (effect, action) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, effect.Ms);
      action?.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    }),
);
