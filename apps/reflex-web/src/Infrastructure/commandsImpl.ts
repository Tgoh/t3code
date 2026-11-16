import {
  EnvironmentRegistry,
  type EnvironmentSupervisor,
} from "@t3tools/client-runtime/connection";
import {
  createProject,
  deleteProject,
  deleteThread,
  dismissThreadUserInput,
  interruptThreadTurn,
  markThreadUnread,
  pinThread,
  respondToThreadApproval,
  respondToThreadUserInput,
  settleThread,
  setThreadRuntimeMode,
  snoozeThread,
  startThreadTurn,
  unarchiveThread,
  unpinThread,
  unsettleThread,
  unsnoozeThread,
  updateProject,
  updateThreadMetadata,
  visitThread,
} from "@t3tools/client-runtime/operations";
import { getInitialServerConfig, request } from "@t3tools/client-runtime/rpc";
import {
  CommandId,
  EDITORS,
  type EditorId,
  EnvironmentId,
  isProviderAvailable,
  MessageId,
  ORCHESTRATION_V2_WS_METHODS,
  ProjectId,
  ProviderInstanceId,
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
import { implementation } from "treflex";

import {
  addProjectSettingsEffect,
  assetUrlEffect,
  browseFoldersEffect,
  searchEntriesEffect,
  cloneControlEffect,
  closeTerminalEffect,
  type IProviderOption,
  modelFavoritesEffect,
  newProjectEffect,
  openInEditorEffect,
  openInFileManagerEffect,
  projectCommandEffect,
  queueCommandEffect,
  respondRequestEffect,
  serverProvidersEffect,
  setModelFavoriteEffect,
  startCloneEffect,
  startTurnEffect,
  stopThreadEffect,
  threadCommandEffect,
  threadDiffEffect,
} from "./commandEffects";
import { applyModelPreferences } from "../modelOptions";
import { connectionRuntime } from "./connection";
import { runCommand, sourceControl } from "./sourceControl";

export const inEnvironment = <A, E>(
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
    dispatchMode: input.DispatchMode,
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
    input.Dismiss
      ? dismissThreadUserInput(common)
      : input.Decision !== null
        ? respondToThreadApproval({ ...common, decision: input.Decision })
        : respondToThreadUserInput({ ...common, answers: input.Answers ?? {} }),
  );
});

export const queueCommandImpl = implementation(queueCommandEffect, async (input) => {
  const common = {
    commandId: CommandId.make(input.CommandId),
    threadId: ThreadId.make(input.ThreadId),
  };
  const operation = input.Operation;
  const command = (() => {
    switch (operation.Kind) {
      case "resume":
        return { type: "queue.resume" as const, ...common };
      case "cancel":
        return {
          type: "queued-run.cancel" as const,
          ...common,
          runId: RunId.make(operation.RunId),
        };
      case "start":
        return { type: "queued-run.start" as const, ...common, runId: RunId.make(operation.RunId) };
      case "steer":
        return {
          type: "queued-message.promote-to-steer" as const,
          ...common,
          queuedRunId: RunId.make(operation.RunId),
          targetRunId: RunId.make(operation.TargetRunId),
        };
      case "edit":
        return {
          type: "queued-run.edit" as const,
          ...common,
          runId: RunId.make(operation.RunId),
          text: operation.Text,
        };
    }
  })();
  await inEnvironment(
    input.EnvironmentId,
    request(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, command),
  );
});

export const threadCommandImpl = implementation(threadCommandEffect, async (input) => {
  const common = {
    commandId: CommandId.make(input.CommandId),
    threadId: ThreadId.make(input.ThreadId),
  };
  const command = input.Command;
  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      EnvironmentSupervisor.EnvironmentSupervisor | SecureRandom.SecureRandom
    >,
  ) => inEnvironment(input.EnvironmentId, effect);
  switch (command.Kind) {
    case "settle":
      return void (await run(settleThread(common)));
    case "unsettle":
      return void (await run(unsettleThread({ ...common, reason: "user" })));
    case "snooze":
      return void (await run(snoozeThread({ ...common, snoozedUntil: command.Until })));
    case "unsnooze":
      return void (await run(unsnoozeThread({ ...common, reason: "user" })));
    case "pin":
      return void (await run(pinThread(common)));
    case "unpin":
      return void (await run(unpinThread(common)));
    case "rename":
      return void (await run(updateThreadMetadata({ ...common, title: command.Title })));
    case "visit":
      return void (await run(visitThread({ ...common, visitedAt: command.VisitedAt })));
    case "markUnread":
      return void (await run(markThreadUnread(common)));
    case "unarchive":
      return void (await run(unarchiveThread(common)));
    case "delete":
      return void (await run(deleteThread(common)));
    case "modelSelection":
      return void (await run(
        updateThreadMetadata({ ...common, modelSelection: command.Selection as never }),
      ));
    case "runtimeMode":
      return void (await run(setThreadRuntimeMode({ ...common, runtimeMode: command.Mode })));
    default:
      command satisfies never;
  }
});

export const projectCommandImpl = implementation(projectCommandEffect, async (input) => {
  const common = {
    commandId: CommandId.make(input.CommandId),
    projectId: ProjectId.make(input.ProjectId),
  };
  const command = input.Command;
  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      EnvironmentSupervisor.EnvironmentSupervisor | SecureRandom.SecureRandom
    >,
  ) => inEnvironment(input.EnvironmentId, effect);
  switch (command.Kind) {
    case "create":
      return void (await run(
        createProject({
          ...common,
          title: command.Title,
          workspaceRoot: command.WorkspaceRoot,
          createWorkspaceRootIfMissing: true,
          defaultModelSelection: null,
        }),
      ));
    case "pin":
      return void (await run(updateProject({ ...common, pinned: true })));
    case "unpin":
      return void (await run(updateProject({ ...common, pinned: false })));
    case "archive":
      return void (await run(updateProject({ ...common, archived: true })));
    case "unarchive":
      return void (await run(updateProject({ ...common, archived: false })));
    case "rename":
      return void (await run(updateProject({ ...common, title: command.Title })));
    case "delete":
      return void (await run(
        deleteProject(command.Force === true ? { ...common, force: true } : common),
      ));
    default:
      command satisfies never;
  }
});

export const addProjectSettingsImpl = implementation(addProjectSettingsEffect, async (input) => {
  const config = await inEnvironment(input.EnvironmentId, request(WS_METHODS.serverGetConfig, {}));
  return {
    BaseDirectory: config.settings.addProjectBaseDirectory,
    GhqCloneLayout: config.settings.ghqCloneLayout,
    NewProjectsRoot: config.newProjectsRoot ?? null,
    Os: config.environment.platform.os,
  };
});

export const searchEntriesImpl = implementation(searchEntriesEffect, async (input, action) => {
  const result = await inEnvironment(
    input.EnvironmentId,
    request(WS_METHODS.projectsSearchEntries, {
      cwd: input.Cwd,
      query: input.Query.trim().slice(0, 256),
      limit: input.Limit,
    }),
    action?.signal,
  );
  return { Entries: result.entries.map((entry) => ({ path: entry.path, kind: entry.kind })) };
});

export const browseFoldersImpl = implementation(browseFoldersEffect, async (input, action) => {
  const listing = await inEnvironment(
    input.EnvironmentId,
    request(WS_METHODS.filesystemBrowse, {
      partialPath: input.PartialPath,
      ...(input.Cwd === null ? {} : { cwd: input.Cwd }),
    }),
    action?.signal,
  );
  return {
    ParentPath: listing.parentPath,
    Entries: listing.entries.map((entry) => ({ name: entry.name, fullPath: entry.fullPath })),
  };
});

export const startCloneImpl = implementation(startCloneEffect, async (input) => {
  await runCommand(sourceControl.startProjectClone, {
    environmentId: EnvironmentId.make(input.EnvironmentId),
    input: {
      projectId: ProjectId.make(input.ProjectId),
      title: input.Title,
      createdAt: new Date().toISOString(),
      remoteUrl: input.RemoteUrl,
      destinationPath: input.DestinationPath,
    },
  });
});

export const cloneControlImpl = implementation(cloneControlEffect, async (input) => {
  await runCommand(
    input.Kind === "cancel" ? sourceControl.cancelProjectClone : sourceControl.retryProjectClone,
    {
      environmentId: EnvironmentId.make(input.EnvironmentId),
      input: { projectId: ProjectId.make(input.ProjectId) },
    },
  );
});

export const newProjectImpl = implementation(newProjectEffect, async (input) => {
  const created = await inEnvironment(
    input.EnvironmentId,
    request(WS_METHODS.projectsCreateNew, { name: input.Name }),
  );
  return {
    ProjectId: created.projectId,
    WorkspaceRoot: created.workspaceRoot,
    CommitError: created.commitError ?? null,
  };
});

export const openInFileManagerImpl = implementation(openInFileManagerEffect, async (input) => {
  await inEnvironment(
    input.EnvironmentId,
    request(WS_METHODS.shellOpenInEditor, { cwd: input.Path, editor: "file-manager" }),
  );
});

const LAST_EDITOR_KEY = "t3code:last-editor";

// Follows resolveAndPersistPreferredEditor in apps/web/src/editorPreferences.ts.
function preferredEditor(available: ReadonlyArray<EditorId>): EditorId | null {
  let stored: string | null = null;
  try {
    stored = JSON.parse(localStorage.getItem(LAST_EDITOR_KEY) ?? "null") as string | null;
  } catch {
    stored = null;
  }
  const held = available.find((editor) => editor === stored);
  if (held !== undefined) return held;
  const editor = EDITORS.find((candidate) => available.includes(candidate.id))?.id ?? null;
  if (editor !== null) {
    try {
      localStorage.setItem(LAST_EDITOR_KEY, JSON.stringify(editor));
    } catch {
      // Without storage the first available editor is picked again next time.
    }
  }
  return editor;
}

export const openInEditorImpl = implementation(openInEditorEffect, async (input) => {
  const config = await inEnvironment(input.EnvironmentId, request(WS_METHODS.serverGetConfig, {}));
  const editor = preferredEditor(config.availableEditors);
  if (editor === null) throw new Error(`No editor on this machine can open ${input.Path}.`);
  await inEnvironment(
    input.EnvironmentId,
    request(WS_METHODS.shellOpenInEditor, {
      cwd: input.Path,
      editor,
      ...(input.ProjectRoot === null ? {} : { projectRoot: input.ProjectRoot }),
    }),
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

export const assetUrlImpl = implementation(assetUrlEffect, async (input, action) => {
  const { relativeUrl, imageDimensions } = await inEnvironment(
    input.EnvironmentId,
    request(WS_METHODS.assetsCreateUrl, { resource: input.Resource }),
    action?.signal,
  );
  return {
    Url: relativeUrl,
    ...(imageDimensions === undefined
      ? {}
      : { Size: { Width: imageDimensions.width, Height: imageDimensions.height } }),
  };
});

const plainCopy = <T>(value: ReadonlyArray<T>): T[] => JSON.parse(JSON.stringify(value));

const followOnce = <A, E>(
  environmentId: string,
  effect: Effect.Effect<A, E, EnvironmentSupervisor.EnvironmentSupervisor>,
) =>
  connectionRuntime.runPromise(
    EnvironmentRegistry.EnvironmentRegistry.pipe(
      Effect.flatMap((registry) =>
        registry
          .followStream(EnvironmentId.make(environmentId), Stream.fromEffect(effect))
          .pipe(Stream.runHead),
      ),
      Effect.map(Option.getOrThrow),
    ),
  );

/** A read that can run at startup: it waits for the environment to register and connect. */
export const onceRegistered = <A, E>(
  environmentId: string,
  effect: Effect.Effect<A, E, EnvironmentSupervisor.EnvironmentSupervisor>,
) =>
  followOnce(
    environmentId,
    effect.pipe(Effect.retry({ times: 30, schedule: Schedule.spaced("1 second") })),
  );

const initialConfig = (environmentId: string) =>
  followOnce(
    environmentId,
    getInitialServerConfig().pipe(Effect.retry(Schedule.spaced("1 second"))),
  );

export const serverProvidersImpl = implementation(serverProvidersEffect, async (input) => {
  const config = input.Fresh
    ? await inEnvironment(input.EnvironmentId, request(WS_METHODS.serverGetConfig, {}))
    : await initialConfig(input.EnvironmentId);
  const preferences = config.settings?.providerModelPreferences ?? {};
  return config.providers
    .filter((provider) => provider.enabled && isProviderAvailable(provider))
    .map((provider): IProviderOption => ({
      InstanceId: provider.instanceId,
      Driver: provider.driver,
      Name: provider.displayName ?? provider.instanceId,
      ...(provider.supportedRuntimeModes === undefined
        ? {}
        : { SupportedRuntimeModes: [...provider.supportedRuntimeModes] }),
      ...(provider.slashCommands.length === 0
        ? {}
        : { SlashCommands: plainCopy(provider.slashCommands) }),
      ...(provider.skills.length === 0 ? {} : { Skills: plainCopy(provider.skills) }),
      Models: applyModelPreferences(provider.models, preferences[provider.instanceId]).map(
        (model) => ({
          Slug: model.slug,
          Name: model.name,
          ...(model.shortName === undefined ? {} : { ShortName: model.shortName }),
          ...(model.subProvider === undefined ? {} : { SubProvider: model.subProvider }),
          IsDefault: model.isDefault === true,
          ...(model.isLegacy === true ? { IsLegacy: true } : {}),
          ...(model.capabilities == null ? {} : { Capabilities: model.capabilities }),
        }),
      ),
    }));
});

export const modelFavoritesImpl = implementation(modelFavoritesEffect, async (input) => {
  const config = await inEnvironment(input.EnvironmentId, request(WS_METHODS.serverGetConfig, {}));
  return (config.settings.favorites ?? []).map((favorite) => ({
    Provider: favorite.provider,
    Model: favorite.model,
  }));
});

export const setModelFavoriteImpl = implementation(setModelFavoriteEffect, async (input) => {
  await inEnvironment(
    input.EnvironmentId,
    request(WS_METHODS.serverUpdateSettings, {
      patch: {
        setModelFavorites: [
          {
            provider: ProviderInstanceId.make(input.Provider),
            model: input.Model,
            favorite: input.Favorite,
          },
        ],
      },
    }),
  );
});
