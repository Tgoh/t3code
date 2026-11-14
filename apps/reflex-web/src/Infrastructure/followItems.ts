import {
  EnvironmentRegistry,
  type EnvironmentSupervisor,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { connectionRuntime } from "./connection";

interface ILiveSurface {
  status(detail?: string): void;
  readonly signal: AbortSignal;
}

interface IStreamSurface<Item> extends ILiveSurface {
  emit(message: { Item: Item }): Promise<void>;
}

export function failureText(cause: Cause.Cause<unknown>): string {
  const failure = Cause.squash(cause);
  return failure instanceof Error ? failure.message : String(failure);
}

export function followLive<Item, E, EE>(
  r: ILiveSurface,
  environmentId: string,
  items: Stream.Stream<Item, E, EnvironmentSupervisor.EnvironmentSupervisor>,
  handle: (item: Item) => Effect.Effect<void, EE>,
): Promise<void> {
  const id = EnvironmentId.make(environmentId);
  const program = Effect.gen(function* () {
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    yield* registry.stateChanges(id).pipe(
      Stream.runForEach((state) => Effect.sync(() => r.status(state.phase))),
      Effect.forkScoped,
    );
    yield* registry.followStream(id, items).pipe(Stream.runForEach(handle));
  }).pipe(Effect.scoped);
  return connectionRuntime.runPromise(program, { signal: r.signal });
}

export function followItems<Decoded, Item, E, EE>(
  r: IStreamSurface<Item>,
  environmentId: string,
  items: Stream.Stream<Decoded, E, EnvironmentSupervisor.EnvironmentSupervisor>,
  encode: (item: Decoded) => Effect.Effect<Item, EE>,
  advance: (item: Item) => void,
): Promise<void> {
  return followLive(r, environmentId, items, (decoded) =>
    encode(decoded).pipe(
      Effect.flatMap((item) =>
        Effect.promise(() => r.emit({ Item: item })).pipe(Effect.map(() => advance(item))),
      ),
    ),
  );
}
