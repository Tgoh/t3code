import {
  ClientCapabilities,
  Persistence,
  PlatformConnectionSource,
} from "@t3tools/client-runtime/platform";
import {
  Connection,
  Connectivity,
  CredentialStore,
  PrimaryConnectionRegistration,
  PrimaryConnectionTarget,
  ProfileStore,
  Wakeups,
} from "@t3tools/client-runtime/connection";
import { TokenStore } from "@t3tools/client-runtime/authorization";
import { fetchRemoteEnvironmentDescriptor } from "@t3tools/client-runtime/environment";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { layerRemoteHttpClient } from "@t3tools/client-runtime/rpc";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as Socket from "effect/socket/Socket";

const httpBaseUrl = `${location.origin}/`;
const wsBaseUrl = httpBaseUrl.replace(/^http/, "ws");

const layerHttpClient = layerRemoteHttpClient((input, init) => globalThis.fetch(input, init));

export const loadDescriptor = fetchRemoteEnvironmentDescriptor({ httpBaseUrl }).pipe(
  Effect.provide(layerHttpClient),
);

const loadRegistration = loadDescriptor.pipe(
  Effect.retry(Schedule.spaced("3 seconds")),
  Effect.orDie,
  Effect.map(
    (descriptor) =>
      new PrimaryConnectionRegistration({
        target: new PrimaryConnectionTarget({
          environmentId: descriptor.environmentId,
          label: descriptor.label,
          httpBaseUrl,
          wsBaseUrl,
        }),
      }),
  ),
);

const layerPlatformSource = Layer.succeed(
  PlatformConnectionSource.PlatformConnectionSource,
  PlatformConnectionSource.PlatformConnectionSource.of({
    registrations: Stream.fromEffect(loadRegistration).pipe(
      Stream.map((registration) => [registration]),
    ),
  }),
);

const layerConnectivity = Connectivity.layer({
  status: Effect.sync(() => (navigator.onLine ? "online" : "offline")),
  changes: Stream.callback((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const online = () => Queue.offerUnsafe(queue, "online");
        const offline = () => Queue.offerUnsafe(queue, "offline");
        window.addEventListener("online", online);
        window.addEventListener("offline", offline);
        return { online, offline };
      }),
      ({ online, offline }) =>
        Effect.sync(() => {
          window.removeEventListener("online", online);
          window.removeEventListener("offline", offline);
        }),
    ).pipe(Effect.asVoid),
  ),
});

const layerWakeups = Wakeups.layer({
  changes: Stream.callback<"application-active">((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const listener = () => {
          if (document.visibilityState === "visible") {
            Queue.offerUnsafe(queue, "application-active");
          }
        };
        document.addEventListener("visibilitychange", listener);
        return listener;
      }),
      (listener) => Effect.sync(() => document.removeEventListener("visibilitychange", listener)),
    ).pipe(Effect.asVoid),
  ),
});

// One primary environment on a cookie session: nothing is persisted and the relay is never reached.
const layerUnused = Layer.mergeAll(
  Layer.succeed(Persistence.ConnectionTargetStore, {
    list: Effect.succeed([]),
    listDisabled: Effect.succeed([]),
  }),
  Layer.mock(Persistence.ConnectionRegistrationStore)({}),
  // Git actions invalidate cached ref lists after they run, so these answer instead of defecting.
  Layer.mock(Persistence.EnvironmentCacheStore)({
    clear: () => Effect.void,
    clearVcsRefs: () => Effect.void,
    removeVcsRefs: () => Effect.void,
  }),
  Layer.mock(ProfileStore.ConnectionProfileStore)({}),
  Layer.mock(CredentialStore.ConnectionCredentialStore)({}),
  Layer.mock(TokenStore.RemoteDpopAccessTokenStore)({}),
  Layer.mock(ManagedRelay.ManagedRelayDpopSigner)({}),
  Layer.mock(ManagedRelay.ManagedRelayClient)({ relayUrl: "http://relay.invalid" }),
  Layer.mock(ClientCapabilities.SshEnvironmentGateway)({}),
  Layer.mock(ClientCapabilities.CloudSession)({ identity: Effect.succeedNone }),
  Layer.succeed(ClientCapabilities.RelayDeviceIdentity, { deviceId: Effect.succeedNone }),
  Layer.succeed(ClientCapabilities.PrimaryEnvironmentAuth, {
    bearerToken: Effect.succeedNone,
  }),
  Layer.succeed(ClientCapabilities.ClientPresentation, { metadata: { label: "Reflex" } }),
);

const layerConnection = Connection.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      layerPlatformSource,
      layerConnectivity,
      layerWakeups,
      layerUnused,
      layerHttpClient,
      Socket.layerWebSocketConstructorGlobal,
    ),
  ),
);

export const connectionRuntime = ManagedRuntime.make(layerConnection);
