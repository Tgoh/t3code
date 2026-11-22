import {
  AVAILABLE_CONNECTION_STATE,
  EnvironmentRegistry,
  EnvironmentSupervisor,
  type PreparedConnection,
  PrimaryConnectionTarget,
} from "@t3tools/client-runtime/connection";
import type { RpcSession } from "@t3tools/client-runtime/rpc";
import { EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

export const ENVIRONMENT_ID = "environment-1";

interface IWaiter {
  test: () => boolean;
  resolve: () => void;
}

/** Resolves waiters as the condition they wait for comes true, instead of polling for it. */
function signals() {
  let waiters: IWaiter[] = [];
  return {
    notify() {
      const ready = waiters.filter((waiter) => waiter.test());
      waiters = waiters.filter((waiter) => !ready.includes(waiter));
      for (const waiter of ready) waiter.resolve();
    },
    until(test: () => boolean): Promise<void> {
      if (test()) return Promise.resolve();
      return new Promise((resolve) => waiters.push({ test, resolve }));
    },
  };
}

export interface IFakeSession {
  readonly session: RpcSession;
  /** Resolves with the input of the first `tag` call on this session. */
  opened(tag: string): Promise<unknown>;
  /** Sends `value` down this session's `tag` stream. */
  push(tag: string, value: unknown): void;
  /** Resolves once this session's `tag` stream has ended. */
  ended(tag: string): Promise<void>;
  /** Inputs of this session's unary `tag` requests. */
  requests(tag: string): unknown[];
}

const isStreamTag = (tag: string) => tag === WS_METHODS.terminalAttach || /subscribe/.test(tag);

function fakeSession(config: unknown): IFakeSession {
  const queues = new Map<string, Queue.Queue<unknown>>();
  const inputs = new Map<string, unknown[]>();
  const closed = new Set<string>();
  const changed = signals();
  const queue = (tag: string) => {
    let held = queues.get(tag);
    if (held === undefined) {
      held = Effect.runSync(Queue.unbounded<unknown>());
      queues.set(tag, held);
    }
    return held;
  };
  const record = (tag: string, input: unknown) => {
    inputs.set(tag, [...(inputs.get(tag) ?? []), input]);
    changed.notify();
  };
  const open = (tag: string, input: unknown) => {
    record(tag, input);
    return Stream.fromQueue(queue(tag)).pipe(
      Stream.ensuring(
        Effect.sync(() => {
          closed.add(tag);
          changed.notify();
        }),
      ),
    );
  };
  const client = new Proxy(
    {},
    {
      get: (_target, tag: string) => (input: unknown) =>
        isStreamTag(tag) ? open(tag, input) : Effect.sync(() => record(tag, input)),
    },
  ) as RpcSession["client"];
  const session: RpcSession = {
    client,
    initialConfig: Effect.succeed(config as Effect.Success<RpcSession["initialConfig"]>),
    subscribeServerConfig: ((input?: unknown) =>
      open(WS_METHODS.subscribeServerConfig, input)) as RpcSession["subscribeServerConfig"],
    ready: Effect.void,
    probe: Effect.void,
    inboundFrames: Effect.succeed(0),
    closed: Effect.never,
  };
  return {
    session,
    opened: async (tag) => {
      await changed.until(() => inputs.has(tag));
      return inputs.get(tag)![0];
    },
    push: (tag, value) => Effect.runSync(Queue.offer(queue(tag), value)),
    ended: (tag) => changed.until(() => closed.has(tag)),
    requests: (tag) => inputs.get(tag) ?? [],
  };
}

/** A running resource, with a wait on what it has emitted and exposed so far. */
export interface IFakeResource {
  readonly messages: unknown[];
  readonly values: unknown[];
  /** Resolves once `test` holds; rejects if the resource fails or ends first. */
  until(test: () => boolean): Promise<void>;
  /** Retests the waits, after a change the resource made outside emit and expose. */
  changed(): void;
  close(): void;
}

export function startResource(start: (context: never) => unknown): IFakeResource {
  const controller = new AbortController();
  const messages: unknown[] = [];
  const values: unknown[] = [];
  const changed = signals();
  let stopped: { error: unknown } | null = null;
  const context = {
    emit: async (message: unknown) => {
      messages.push(message);
      changed.notify();
    },
    expose: (value: unknown) => {
      values.push(value);
      changed.notify();
    },
    status: () => {},
    methods: () => {},
    onIdle: () => {},
    onSupply: () => {},
    end: () => {},
    run: () => Promise.reject(new Error("Not used by these resources.")),
    resumeFrom: undefined,
    signal: controller.signal,
    ownerId: "owner-1",
    key: "resource-1",
  };
  const stop = (error: unknown) => {
    if (controller.signal.aborted) return;
    stopped = { error };
    changed.notify();
  };
  Promise.resolve(start(context as never)).then(
    () => stop(new Error("The resource ended.")),
    (error: unknown) => stop(error),
  );
  return {
    messages,
    values,
    until: async (test) => {
      await changed.until(() => stopped !== null || test());
      if (stopped !== null) throw stopped.error;
    },
    changed: () => changed.notify(),
    close: () => controller.abort(),
  };
}

export interface ISessionSwap {
  /** The session the supervisor holds now. */
  readonly current: IFakeSession;
  /** Replaces the supervisor's session with a new one, as a reconnect does. */
  swap(): IFakeSession;
}

let active: EnvironmentSupervisor.EnvironmentSupervisor["Service"] | null = null;

/** Installs a supervisor that `connectionMock` serves, holding a first session. */
export function sessionSwap(config: unknown = {}): ISessionSwap {
  let current = fakeSession(config);
  const session = Effect.runSync(SubscriptionRef.make(Option.some(current.session)));
  active = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: new PrimaryConnectionTarget({
      environmentId: EnvironmentId.make(ENVIRONMENT_ID),
      label: "Test",
      httpBaseUrl: "http://test.invalid/",
      wsBaseUrl: "ws://test.invalid/",
    }),
    state: Effect.runSync(SubscriptionRef.make(AVAILABLE_CONNECTION_STATE)),
    session,
    prepared: Effect.runSync(SubscriptionRef.make(Option.none<PreparedConnection>())),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
  return {
    get current() {
      return current;
    },
    swap() {
      current = fakeSession(config);
      Effect.runSync(SubscriptionRef.set(session, Option.some(current.session)));
      return current;
    },
  };
}

function supervisor() {
  if (active === null) throw new Error("Call sessionSwap() before starting a resource.");
  return active;
}

const registry = {
  stateChanges: () => Stream.never,
  followStream: <A, E, R>(_id: EnvironmentId, stream: Stream.Stream<A, E, R>) =>
    Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor()),
  run: <A, E, R>(_id: EnvironmentId, effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor()),
} as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"];

type IRegistryEffect<A, E> = Effect.Effect<A, E, EnvironmentRegistry.EnvironmentRegistry>;

const withRegistry = <A, E>(effect: IRegistryEffect<A, E>) =>
  Effect.provideService(effect, EnvironmentRegistry.EnvironmentRegistry, registry);

/** Stands in for `Infrastructure/connection`: `vi.mock("./connection", () => connectionMock)`. */
export const connectionMock = {
  connectionRuntime: {
    runPromise: <A, E>(effect: IRegistryEffect<A, E>, options?: { signal?: AbortSignal }) =>
      Effect.runPromise(withRegistry(effect), options),
    runPromiseExit: <A, E>(effect: IRegistryEffect<A, E>, options?: { signal?: AbortSignal }) =>
      Effect.runPromiseExit(withRegistry(effect), options),
    contextEffect: Effect.context<never>(),
  },
};
