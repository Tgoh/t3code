// @effect-diagnostics globalTimers:off -- A browser clock, outside any Effect runtime.
import { external, type IRuntime, type ISelectorGenerator } from "treflex";

import { clockNow, MINUTE } from "../timestamps";

declare module "treflex" {
  interface IExternalRegistry {
    Minute: number;
  }
}

export function provideMinute(runtime: IRuntime<object>): void {
  runtime.provideExternal("Minute", {
    read: () => Math.floor(clockNow() / MINUTE) * MINUTE,
    subscribe: (changed) => {
      const id = setInterval(changed, 1_000);
      return () => clearInterval(id);
    },
  });
}

/** The device clock rounded down to the minute, for views and selectors. */
export function* minute(_draft?: object): ISelectorGenerator<number> {
  return (yield* external("Minute")) ?? 0;
}
