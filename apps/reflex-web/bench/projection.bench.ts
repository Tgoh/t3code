import { applyOrchestrationV2ProjectionEvent } from "@t3tools/client-runtime/state/orchestration-v2-projection";
import {
  OrchestrationV2ThreadStreamItem,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { createEffect, createRoot } from "solid-js";
import { createTestRuntime, guids, settled } from "treflex";
import { expect, it } from "vite-plus/test";

import { EnvironmentReceiver, openThread } from "../src/Environment";
import type {
  IWireProjection,
  IWireThreadEvent,
  IWireThreadItem,
} from "../src/Infrastructure/wire";
import { type IOpenThread, ThreadReceiver, timelineEntries } from "../src/OpenThread";
import { getDefaultRoot, type IRoot, load, RootReceiver } from "../src/Root";
import {
  assistantItem,
  event,
  longThread,
  message,
  snapshotOf,
  THREAD_ID,
} from "../src/testing/threadFixture";

const SIZES = [100, 1_000, 5_000, 20_000];
const DELTAS = 300;
const ENV = "env";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function summary(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
  return { p50: +at(0.5).toFixed(3), p99: +at(0.99).toFixed(3), max: +at(1).toFixed(3) };
}

async function timed(run: () => unknown | Promise<unknown>): Promise<number> {
  const start = performance.now();
  await run();
  return performance.now() - start;
}

function streamingDeltas(projection: IWireProjection, count: number): IWireThreadEvent[] {
  const ordinal = projection.turnItems.length;
  const out: IWireThreadEvent[] = [];
  let text = "";
  for (let index = 0; index < count; index += 1) {
    text += "streamed words ";
    out.push(
      index % 2 === 0
        ? event("message.updated", message("live-message", "run-0", text, true))
        : event(
            "turn-item.updated",
            assistantItem("live-item", "run-0", ordinal, text, "live-message", true),
          ),
    );
  }
  return out;
}

async function connected(projection: IWireProjection) {
  const runtime = createTestRuntime<IRoot>(
    getDefaultRoot("Root"),
    {
      environmentInfo: () => ({ Authenticated: true, EnvironmentId: ENV, Label: "Bench" }),
      addressThread: () => null,
      serverProviders: () => [],
      generateGuid: guids("bench"),
      rememberedTerminal: () => null,
      logFailure: (effect: object) => console.error("action failed:", effect),
    },
    { onError: (error) => console.error("action failed:", error) },
  );
  runtime.registerReceiver(RootReceiver);
  runtime.registerReceiver(EnvironmentReceiver);
  runtime.registerReceiver(ThreadReceiver);
  await runtime.dispatch(load, "Root");
  await settled();
  expect(runtime.resources().some((row) => row.Key === "Shell/Stream")).toBe(true);
  const environment = runtime.state.Environments[0]!;
  await runtime.dispatch(openThread, environment.$Id, THREAD_ID);
  const thread = () => environment.Replica.OpenThreads[THREAD_ID] as IOpenThread;
  const openId = thread().$Id;
  const send = (Item: IWireThreadItem) =>
    runtime.dispatch(
      ThreadReceiver.handle,
      openId,
      { Type: "Thread/Stream", Item },
      { publisher: { Id: openId } },
    );
  await send(snapshotOf(copy(projection), 1));
  return { runtime, send, thread };
}

it("per-delta cost", async () => {
  const rows = [];
  for (const size of SIZES) {
    const projection = longThread(size);
    const deltas = streamingDeltas(projection, DELTAS);

    const { send, thread } = await connected(projection);
    const reruns = { selector: 0, otherItem: 0 };
    const dispose = createRoot((disposeRoot) => {
      createEffect(() => {
        reruns.selector += 1;
        timelineEntries(thread());
      });
      createEffect(() => {
        reruns.otherItem += 1;
        void (thread().TurnItems[projection.turnItems[0]!.id] as { text?: string }).text;
      });
      return disposeRoot;
    });
    await Promise.resolve();
    const before = { ...reruns };
    const treflexSamples: number[] = [];
    let sequence = 2;
    for (const next of deltas) {
      const item = { kind: "event", sequence: (sequence += 1), event: next } as IWireThreadItem;
      treflexSamples.push(await timed(() => send(item)));
    }
    dispose();

    let held = copy(projection) as unknown as OrchestrationV2ThreadProjection;
    const reducerSamples: number[] = [];
    for (const next of deltas) {
      reducerSamples.push(
        await timed(() => {
          held = applyOrchestrationV2ProjectionEvent(held, next as never)!;
        }),
      );
    }
    rows.push({
      items: projection.turnItems.length,
      treflex: summary(treflexSamples),
      reducer: summary(reducerSamples),
      selectorReruns: reruns.selector - before.selector,
      otherItemReruns: reruns.otherItem - before.otherItem,
    });
  }
  console.log("(a) time per live delta, ms\n" + JSON.stringify(rows, null, 1));
});

it("a delta that adds a row", async () => {
  const measure = async (size: number, wholeListSelector: boolean) => {
    const { send, thread } = await connected(longThread(size));
    const dispose = createRoot((disposeRoot) => {
      createEffect(() => {
        if (wholeListSelector) timelineEntries(thread());
        else void thread().Timeline.length;
      });
      return disposeRoot;
    });
    await Promise.resolve();
    const samples: number[] = [];
    for (let index = 0; index < 50; index += 1) {
      const item = assistantItem(`new-${index}`, "run-0", size + index, "new");
      const next = {
        kind: "event",
        sequence: index + 2,
        event: event("turn-item.updated", item),
      } as IWireThreadItem;
      samples.push(await timed(() => send(next)));
    }
    dispose();
    return summary(samples);
  };
  const rows = [];
  for (const size of SIZES) {
    rows.push({
      items: size,
      perRowView: await measure(size, false),
      wholeListSelector: await measure(size, true),
    });
  }
  console.log("(a2) time per row-adding delta, ms\n" + JSON.stringify(rows, null, 1));
});

it("reconnect snapshot over a populated thread", async () => {
  const rows = [];
  for (const size of SIZES) {
    const projection = longThread(size);
    const { send } = await connected(projection);
    const unchanged = await timed(() => send(snapshotOf(copy(projection), 2)));
    const changed = copy(projection);
    const tail = changed.turnItems.length - 1;
    (changed.turnItems[tail] as { title: string | null }).title = "changed";
    const oneChange = await timed(() => send(snapshotOf(changed, 3)));
    const { send: fresh } = await connected(longThread(1));
    const onto = await timed(() => fresh(snapshotOf(copy(projection), 2)));
    rows.push({
      items: size,
      unchangedMs: +unchanged.toFixed(1),
      oneChangeMs: +oneChange.toFixed(1),
      ontoEmptyMs: +onto.toFixed(1),
    });
  }
  console.log("(b) snapshot through the receiver\n" + JSON.stringify(rows, null, 1));
});

it("decode-then-encode cost", () => {
  const decode = Schema.decodeUnknownSync(OrchestrationV2ThreadStreamItem as never) as (
    value: unknown,
  ) => unknown;
  const encode = Schema.encodeSync(Schema.toCodecJson(OrchestrationV2ThreadStreamItem)) as (
    value: unknown,
  ) => unknown;
  const projection = longThread(1_000);
  const deltaWire = {
    kind: "event",
    sequence: 5,
    event: streamingDeltas(projection, 2)[1],
  };
  const measure = (wire: unknown, runs: number) => {
    const decoded: number[] = [];
    const encoded: number[] = [];
    for (let run = 0; run < runs; run += 1) {
      const input = copy(wire);
      let value: unknown;
      const decodeStart = performance.now();
      value = decode(input);
      decoded.push(performance.now() - decodeStart);
      const encodeStart = performance.now();
      encode(value);
      encoded.push(performance.now() - encodeStart);
    }
    return { decode: summary(decoded), encode: summary(encoded) };
  };
  console.log(
    "(c) transport conversion, ms\n" +
      JSON.stringify(
        {
          oneDelta: measure(deltaWire, 500),
          snapshot1000Items: measure(snapshotOf(projection, 1), 10),
        },
        null,
        1,
      ),
  );
});
