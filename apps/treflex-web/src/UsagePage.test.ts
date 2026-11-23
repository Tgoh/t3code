import * as Cause from "effect/Cause";
import { children, createComponent, createRenderEffect, createRoot, flush } from "solid-js";
import { createTestRuntime, type IActionContext, type IEntity, settled } from "treflex";
import { TreflexProvider } from "treflex-solid";
import { describe, expect, it } from "vite-plus/test";

import { thrownOf } from "./Infrastructure/serverError";
import UsagePage, {
  autoRefreshLimits,
  getDefaultUsagePage,
  type IUsagePage,
  loadUsage,
  refreshUsage,
  useUsagePage,
} from "./UsagePage";

const PAGE = "Usage";
const INPUT = { sinceDay: "2026-10-19", untilDay: "2026-11-17", timeZone: "UTC" } as never;

function usageServer(
  overrides: Record<string, (effect: never, action?: IActionContext) => unknown> = {},
) {
  const calls: Array<{ Type: string; [key: string]: unknown }> = [];
  let refreshing = true;
  const commands = {
    refreshProviders: (effect: { Automatic: boolean }) => {
      calls.push({ Type: "refreshProviders", Automatic: effect.Automatic });
    },
    refreshUsageRates: () => {
      calls.push({ Type: "refreshUsageRates" });
    },
    usageSummary: (effect: { Input: Record<string, unknown> }) => {
      calls.push({ Type: "usageSummary", Input: effect.Input });
      const sources = [{ refreshing: refreshing && effect.Input.provisional === true }];
      return { buckets: [], sources, contractVersion: 6 };
    },
    ...overrides,
  };
  return {
    calls,
    commands,
    stopRefreshing: () => {
      refreshing = false;
    },
  };
}

function page(fake = usageServer()) {
  const runtime = createTestRuntime<IUsagePage>(
    { $Id: PAGE, ...getDefaultUsagePage() },
    fake.commands,
  );
  return { runtime, ...fake };
}

function open(opening: { Days: number; Limits: boolean }, fake = usageServer()) {
  const runtime = createTestRuntime<IEntity>({ $Id: "Root" }, fake.commands);
  let held!: { state: IUsagePage };
  const Page = UsagePage.provider(() => {
    held = useUsagePage("env-1", opening).page;
    return null;
  }, getDefaultUsagePage);
  const close = createRoot((dispose) => {
    const view = children(() =>
      createComponent(TreflexProvider, {
        value: runtime,
        get children() {
          return createComponent(Page, {});
        },
      }),
    );
    createRenderEffect(view, () => {});
    return dispose;
  });
  flush();
  return { runtime, ...fake, state: () => held.state, close };
}

describe("the usage page", () => {
  it("reads its window as it opens, and drops the summary as it closes", async () => {
    const fake = usageServer();
    fake.stopRefreshing();
    const usage = open({ Days: 7, Limits: false }, fake);
    await settled();
    expect(usage.calls.map((call) => call.Type)).toEqual(["usageSummary"]);
    const held = usage.state();
    expect(held.Usage?.Key).toBe("7");
    usage.close();
    expect(usage.runtime.locate(held)).toBeUndefined();
  });

  it("refreshes the limits as it opens on them", async () => {
    const usage = open({ Days: 30, Limits: true });
    await settled();
    expect(usage.calls.filter((call) => call.Type === "refreshProviders")).toEqual([
      { Type: "refreshProviders", Automatic: true },
    ]);
    usage.close();
  });

  it("refresh limits by asking the server to re-probe its providers, and leave the result to the stream", async () => {
    const usage = page();
    await usage.runtime.dispatch(autoRefreshLimits, PAGE, "env-1");
    await usage.runtime.dispatch(refreshUsage, PAGE, "env-1", null);
    expect(usage.calls.filter((call) => call.Type === "refreshProviders")).toEqual([
      { Type: "refreshProviders", Automatic: true },
      { Type: "refreshProviders", Automatic: false },
    ]);
    expect(usage.calls.some((call) => call.Type === "serverConfig")).toBe(false);
  });

  it("show a provisional usage summary, then wait for the refresh it reports", async () => {
    const usage = page();
    await usage.runtime.dispatch(loadUsage, PAGE, "env-1", "30", INPUT);
    expect(
      usage.calls.filter((call) => call.Type === "usageSummary").map((call) => call.Input),
    ).toEqual([
      { ...(INPUT as object), provisional: true },
      { ...(INPUT as object), awaitRefresh: true },
    ]);
    expect(usage.runtime.state.Usage?.Key).toBe("30");
    usage.stopRefreshing();
    await usage.runtime.dispatch(loadUsage, PAGE, "env-1", "7", INPUT);
    expect(usage.calls.filter((call) => call.Type === "usageSummary")).toHaveLength(3);
  });

  it("drop a usage read a newer one replaced, silently, though its request ends interrupted", async () => {
    const usage = page(
      usageServer({
        usageSummary: (effect: { Input: { sinceDay: string } }, action?: IActionContext) =>
          effect.Input.sinceDay === "replaced"
            ? new Promise((_resolve, reject) =>
                action?.signal.addEventListener("abort", () => reject(thrownOf(Cause.interrupt()))),
              )
            : { buckets: [], sources: [], contractVersion: 6 },
      }),
    );
    const failures: unknown[] = [];
    usage.runtime.on("failure", (failure) => failures.push(failure));
    const replaced = usage.runtime.dispatch(loadUsage, PAGE, "env-1", "30", {
      ...(INPUT as object),
      sinceDay: "replaced",
    } as never);
    await settled();
    await usage.runtime.dispatch(loadUsage, PAGE, "env-1", "7", INPUT);
    await replaced;
    await settled();
    expect(usage.runtime.state.Usage?.Key).toBe("7");
    expect(failures).toEqual([]);
  });
});
