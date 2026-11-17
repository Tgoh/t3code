import type { IFailureEvent, IRuntime, IRuntimeEventOf } from "treflex";
import { expect, onTestFinished } from "vite-plus/test";

/**
 * Fails the test on any diag or caught failure it didn't take with `takeFailures` or
 * `takeDiags`. A failure an error boundary or `onError` took still counts.
 */
export function watchRuntime(runtime: IRuntime<object>) {
  let diags: IRuntimeEventOf<"diag">[] = [];
  let failures: IFailureEvent[] = [];
  runtime.on("diag", (event) => diags.push(event));
  runtime.on("failure", (event) => failures.push(event));
  onTestFinished(() => {
    expect(
      diags.map(({ code, message }) => `${code}: ${message}`),
      "diags",
    ).toEqual([]);
    expect(
      failures.map(({ ActionName, Error: error }) => `${ActionName}: ${String(error)}`),
      "failures",
    ).toEqual([]);
  });
  return {
    takeFailures: () => {
      const taken = failures;
      failures = [];
      return taken;
    },
    takeDiags: () => {
      const taken = diags;
      diags = [];
      return taken;
    },
  };
}
