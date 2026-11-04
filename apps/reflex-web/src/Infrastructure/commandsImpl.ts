import {
  EnvironmentRegistry,
  type EnvironmentSupervisor,
} from "@t3tools/client-runtime/connection";
import {
  interruptThreadTurn,
  respondToThreadApproval,
  respondToThreadUserInput,
  startThreadTurn,
} from "@t3tools/client-runtime/operations";
import { getInitialServerConfig, request } from "@t3tools/client-runtime/rpc";
import {
  CommandId,
  EnvironmentId,
  isProviderAvailable,
  MessageId,
  ORCHESTRATION_V2_WS_METHODS,
  ProjectId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { implementation } from "reflex";

import {
  attachmentUrlEffect,
  closeTerminalEffect,
  type IProviderOption,
  queueCommandEffect,
  respondRequestEffect,
  serverProvidersEffect,
  startTurnEffect,
  stopThreadEffect,
  threadDiffEffect,
} from "./commandEffects";
import { connectionRuntime } from "./connection";

const inEnvironment = <A, E>(
  environmentId: string,
  effect: Effect.Effect<
    A,
    E,
    EnvironmentSupervisor.EnvironmentSupervisor | SecureRandom.SecureRandom
  >,
  signal?: AbortSignal,
) =>
  connectionRuntime.runPromise(
    EnvironmentRegistry.EnvironmentRegistry.pipe(
      Effect.flatMap((registry) =>
        registry.run(
          EnvironmentId.make(environmentId),
          effect.pipe(Effect.provide(SecureRandom.layerWebCrypto)),
        ),
      ),
    ),
    { signal },
  );

export const startTurnImpl = implementation(startTurnEffect, async (input) => {
  const modelSelection = input.ModelSelection as never;
  const turn = {
    commandId: CommandId.make(input.CommandId),
    threadId: ThreadId.make(input.ThreadId),
    message: {
      messageId: MessageId.make(input.MessageId),
      role: "user" as const,
      text: input.Text,
      attachments: input.Attachments as never,
    },
    ...(input.ModelSelection === null ? {} : { modelSelection }),
    runtimeMode: input.RuntimeMode,
    interactionMode: input.InteractionMode,
    ...(input.NewThread === null
      ? {}
      : {
          titleSeed: input.NewThread.Title,
          bootstrap: {
            // startThreadTurn reads no createdAt: the server stamps the thread.
            createThread: {
              projectId: ProjectId.make(input.NewThread.ProjectId),
              title: input.NewThread.Title,
              modelSelection,
              runtimeMode: input.RuntimeMode,
              interactionMode: input.InteractionMode,
              branch: null,
              worktreePath: null,
            },
          },
        }),
  };
  await inEnvironment(input.EnvironmentId, startThreadTurn(turn as never));
});

export const stopThreadImpl = implementation(stopThreadEffect, async (input) => {
  await inEnvironment(
    input.EnvironmentId,
    interruptThreadTurn({
      commandId: CommandId.make(input.CommandId),
      threadId: ThreadId.make(input.ThreadId),
    }),
  );
});

export const respondRequestImpl = implementation(respondRequestEffect, async (input) => {
  const common = {
    commandId: CommandId.make(input.CommandId),
    threadId: ThreadId.make(input.ThreadId),
    requestId: RuntimeRequestId.make(input.RequestId),
  };
  await inEnvironment(
    input.EnvironmentId,
    input.Decision !== null
      ? respondToThreadApproval({ ...common, decision: input.Decision })
      : respondToThreadUserInput({ ...common, answers: input.Answers ?? {} }),
  );
});

export const queueCommandImpl = implementation(queueCommandEffect, async (input) => {
  const common = {
    commandId: CommandId.make(input.CommandId),
    threadId: ThreadId.make(input.ThreadId),
  };
  await inEnvironment(
    input.EnvironmentId,
    request(
      ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
      input.RunId === null
        ? { type: "queue.resume", ...common }
        : { type: "queued-run.cancel", ...common, runId: RunId.make(input.RunId) },
    ),
  );
});

export const closeTerminalImpl = implementation(closeTerminalEffect, async (input) => {
  await inEnvironment(
    input.EnvironmentId,
    request(WS_METHODS.terminalClose, {
      threadId: input.ThreadId,
      terminalId: input.TerminalId,
      deleteHistory: true,
    }),
  );
});

export const threadDiffImpl = implementation(threadDiffEffect, async (input, action) => {
  const threadId = ThreadId.make(input.ThreadId);
  if (input.Scope === "thread") {
    const whole = await inEnvironment(
      input.EnvironmentId,
      request(ORCHESTRATION_V2_WS_METHODS.getFullThreadDiff, {
        threadId,
        toTurnCount: input.ToTurnCount,
      }),
      action?.signal,
    );
    return whole.diff;
  }
  const turn = await inEnvironment(
    input.EnvironmentId,
    request(ORCHESTRATION_V2_WS_METHODS.getTurnDiff, {
      threadId,
      fromTurnCount: Math.max(0, input.ToTurnCount - 1),
      toTurnCount: input.ToTurnCount,
    }),
    action?.signal,
  );
  return turn.diff;
});

export const attachmentUrlImpl = implementation(attachmentUrlEffect, async (input, action) => {
  const { relativeUrl } = await inEnvironment(
    input.EnvironmentId,
    request(WS_METHODS.assetsCreateUrl, {
      resource: { _tag: "attachment", attachmentId: input.AttachmentId },
    }),
    action?.signal,
  );
  return relativeUrl;
});

export const serverProvidersImpl = implementation(serverProvidersEffect, async (input) => {
  // This runs at startup, before the environment may be registered, which followStream waits for.
  const config = await connectionRuntime.runPromise(
    EnvironmentRegistry.EnvironmentRegistry.pipe(
      Effect.flatMap((registry) =>
        registry
          .followStream(
            EnvironmentId.make(input.EnvironmentId),
            Stream.fromEffect(
              getInitialServerConfig().pipe(Effect.retry(Schedule.spaced("1 second"))),
            ),
          )
          .pipe(Stream.runHead),
      ),
      Effect.map(Option.getOrThrow),
    ),
  );
  return config.providers
    .filter((provider) => provider.enabled && isProviderAvailable(provider))
    .map((provider): IProviderOption => ({
      InstanceId: provider.instanceId,
      Driver: provider.driver,
      Name: provider.displayName ?? provider.instanceId,
      Models: provider.models.map((model) => ({
        Slug: model.slug,
        Name: model.name,
        IsDefault: model.isDefault === true,
      })),
    }));
});
