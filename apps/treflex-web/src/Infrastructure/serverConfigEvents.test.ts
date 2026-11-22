import {
  AVAILABLE_CONNECTION_STATE,
  EnvironmentSupervisor,
  type PreparedConnection,
  PrimaryConnectionTarget,
} from "@t3tools/client-runtime/connection";
import type { RpcSession } from "@t3tools/client-runtime/rpc";
import { EnvironmentId, type ServerConfigStreamEvent } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { describe, expect, it } from "vite-plus/test";

import { serverConfigEvents } from "./serverConfigEvents";

const event = (label: string) => ({ type: label }) as unknown as ServerConfigStreamEvent;

function session(events: Queue.Queue<ServerConfigStreamEvent>): RpcSession {
  return {
    client: {} as RpcSession["client"],
    initialConfig: Effect.never,
    subscribeServerConfig: () => Stream.fromQueue(events),
    ready: Effect.void,
    probe: Effect.void,
    inboundFrames: Effect.succeed(0),
    closed: Effect.never,
  };
}

describe("serverConfigEvents", () => {
  it("follows the supervisor onto a replacement session", async () => {
    // oxlint-disable-next-line t3code/no-manual-effect-runtime-in-tests -- this app's tests don't depend on @effect/vitest
    const received = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* Queue.unbounded<ServerConfigStreamEvent>();
        const second = yield* Queue.unbounded<ServerConfigStreamEvent>();
        const active = yield* SubscriptionRef.make(Option.some(session(first)));
        const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
          target: new PrimaryConnectionTarget({
            environmentId: EnvironmentId.make("environment-1"),
            label: "Test",
            httpBaseUrl: "http://test.invalid/",
            wsBaseUrl: "ws://test.invalid/",
          }),
          state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
          session: active,
          prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
          connect: Effect.void,
          disconnect: Effect.void,
          retryNow: Effect.void,
        });
        const firstSeen = yield* Deferred.make<void>();
        const collected = yield* serverConfigEvents.pipe(
          Stream.tap(() => Deferred.succeed(firstSeen, undefined)),
          Stream.take(2),
          Stream.runCollect,
          Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
          Effect.forkChild,
        );
        yield* Queue.offer(first, event("first-snapshot"));
        yield* Deferred.await(firstSeen);
        yield* SubscriptionRef.set(active, Option.some(session(second)));
        yield* Queue.offer(second, event("second-snapshot"));
        return yield* Fiber.join(collected);
      }),
    );
    expect(received.map((item) => item.type)).toEqual(["first-snapshot", "second-snapshot"]);
  });
});
