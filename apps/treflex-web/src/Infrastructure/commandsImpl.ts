import {
  EnvironmentRegistry,
  type EnvironmentSupervisor,
} from "@t3tools/client-runtime/connection";
import {
  archiveThread,
  cancelQueuedRun,
  createProject,
  deleteProject,
  deleteThread,
  dismissThreadUserInput,
  editQueuedRun,
  forkSideChat,
  forkThreadFromRun,
  interruptThreadTurn,
  markThreadUnread,
  mergeThreadBack,
  pinThread,
  promoteQueuedRun,
  reorderPinnedThread,
  respondToThreadApproval,
  respondToThreadUserInput,
  resumeThreadQueue,
  revertThreadCheckpoint,
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
import { linkRequestFailureMessage } from "@t3tools/client-runtime/link-request";
// oxlint-disable-next-line t3code/no-rpc-permission-bypass -- this client has no atom command boundary (issues.md, "the command path assumes atoms"); the server authorizes a link answer
import { request, requestGuarded, RpcPermissionGuard } from "@t3tools/client-runtime/rpc";
import { secretRequestFailureMessage } from "@t3tools/client-runtime/secret-request";
import { readFilePreviewResponse } from "@t3tools/client-runtime/file-preview";
import { FILE_TEXT_PREVIEW_MAX_BYTES } from "@t3tools/shared/filePreview";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationV2TurnItem,
  ProjectId,
  ProjectReadFileError,
  RunId,
  RuntimeRequestId,
  THREAD_SEARCH_QUERY_MAX_LENGTH,
  ThreadId,
  TurnItemId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { implementation } from "treflex";

import {
  answerLinkEffect,
  answerSecretEffect,
  assetTextEffect,
  assetUrlEffect,
  browseFoldersEffect,
  searchEntriesEffect,
  searchThreadsEffect,
  cloneControlEffect,
  closeTerminalEffect,
  newProjectEffect,
  openInEditorEffect,
  openInFileManagerEffect,
  projectCommandEffect,
  queueCommandEffect,
  readProjectFileEffect,
  forkThreadEffect,
  mergeBackEffect,
  respondRequestEffect,
  rewindEffect,
  startCloneEffect,
  startTurnEffect,
  stopThreadEffect,
  threadCommandEffect,
  taskFolderEffect,
  threadDiffEffect,
  threadTitlesEffect,
  turnItemEffect,
  mcpAppEffect,
} from "./commandEffects";
import { preferredEditor } from "../editors";
import { connectionRuntime } from "./connection";
import { type IWireTurnItem, wireCodec } from "./wire";
import { errorText } from "../errorText";
import { serverFailure, serverFetch, settle, thrownOf } from "./serverError";
import { runCommand, sourceControl } from "./sourceControl";

const runInEnvironment = <A, E>(
  environmentId: string,
  effect: Effect.Effect<
    A,
    E,
    EnvironmentSupervisor.EnvironmentSupervisor | SecureRandom.SecureRandom
  >,
  signal?: AbortSignal,
) =>
  connectionRuntime.runPromiseExit(
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

export const inEnvironment = <A, E>(
  ...args: Parameters<typeof runInEnvironment<A, E>>
): Promise<A> => settle(runInEnvironment(...args));

// A failure can carry the request, and with it the secret or pairing code, so none keeps its
// cause and only a server's own message is shown.
async function answerPrivately<E>(
  environmentId: string,
  effect: Effect.Effect<void, E, EnvironmentSupervisor.EnvironmentSupervisor>,
  message: (failure: unknown) => string,
): Promise<void> {
  const exit = await runInEnvironment(environmentId, effect);
  if (Exit.isFailure(exit)) throw serverFailure(message(Cause.squash(exit.cause)));
}

export const answerSecretImpl = implementation(answerSecretEffect, (input) =>
  answerPrivately(
    input.EnvironmentId,
    request(WS_METHODS.secretsAnswerRequest, input.Input),
    secretRequestFailureMessage,
  ),
);

export const answerLinkImpl = implementation(answerLinkEffect, (input) =>
  answerPrivately(
    input.EnvironmentId,
    requestGuarded(WS_METHODS.peerLinksAnswerRequest, input.Input).pipe(
      Effect.provideService(RpcPermissionGuard, { authorize: () => Effect.void }),
    ),
    linkRequestFailureMessage,
  ),
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
      ...(input.IdleCompaction === undefined ? {} : { idleCompaction: input.IdleCompaction }),
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

export const rewindImpl = implementation(rewindEffect, async (input) => {
  await inEnvironment(
    input.EnvironmentId,
    revertThreadCheckpoint({
      commandId: CommandId.make(input.CommandId),
      threadId: ThreadId.make(input.ThreadId),
      turnCount: input.TurnCount,
      restoreFiles: input.RestoreFiles,
      ...(input.Checkpoint === null
        ? {}
        : { checkpointId: input.Checkpoint.Id, scopeId: input.Checkpoint.ScopeId }),
    }),
  );
});

export const forkThreadImpl = implementation(forkThreadEffect, async (input) => {
  const common = {
    commandId: CommandId.make(input.CommandId),
    sourceThreadId: ThreadId.make(input.SourceThreadId),
    targetThreadId: ThreadId.make(input.TargetThreadId),
    title: input.Title,
  };
  await inEnvironment(
    input.EnvironmentId,
    input.RunId === null
      ? forkSideChat(common)
      : forkThreadFromRun({ ...common, runId: RunId.make(input.RunId) }),
  );
});

export const mergeBackImpl = implementation(mergeBackEffect, async (input) => {
  await inEnvironment(
    input.EnvironmentId,
    mergeThreadBack({
      commandId: CommandId.make(input.CommandId),
      sourceThreadId: ThreadId.make(input.SourceThreadId),
      targetThreadId: ThreadId.make(input.TargetThreadId),
      runId: RunId.make(input.RunId),
    }),
  );
});

export const threadTitlesImpl = implementation(threadTitlesEffect, async (input, action) => ({
  Titles: await inEnvironment(
    input.EnvironmentId,
    request(ORCHESTRATION_V2_WS_METHODS.getThreadTitles, {
      threadIds: input.ThreadIds.map((id) => ThreadId.make(id)),
    }),
    action?.signal,
  ),
}));

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
  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      EnvironmentSupervisor.EnvironmentSupervisor | SecureRandom.SecureRandom
    >,
  ) => inEnvironment(input.EnvironmentId, effect);
  switch (operation.Kind) {
    case "resume":
      return void (await run(resumeThreadQueue(common)));
    case "start":
      return void (await run(resumeThreadQueue({ ...common, runId: RunId.make(operation.RunId) })));
    case "steer":
      return void (await run(
        promoteQueuedRun({
          ...common,
          queuedRunId: RunId.make(operation.RunId),
          targetRunId: RunId.make(operation.TargetRunId),
        }),
      ));
    case "cancel":
      return void (await run(cancelQueuedRun({ ...common, runId: RunId.make(operation.RunId) })));
    case "edit":
      return void (await run(
        editQueuedRun({ ...common, runId: RunId.make(operation.RunId), text: operation.Text }),
      ));
    default:
      operation satisfies never;
  }
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
    case "reorderPin":
      return void (await run(reorderPinnedThread({ ...common, orderKey: command.OrderKey })));
    case "rename":
      return void (await run(updateThreadMetadata({ ...common, title: command.Title })));
    case "visit":
      return void (await run(
        visitThread({
          ...common,
          visitedAt: command.VisitedAt,
          ...(command.Opened ? { opened: true } : {}),
          ...(command.SearchQuery ? { searchQuery: command.SearchQuery } : {}),
        }),
      ));
    case "regenerateTitle":
      return void (await run(
        updateThreadMetadata({
          commandId: CommandId.make(command.RequestId),
          threadId: common.threadId,
          regenerateTitle: true,
        }),
      ));
    case "markUnread":
      return void (await run(markThreadUnread(common)));
    case "archive":
      return void (await run(archiveThread(common)));
    case "unarchive":
      return void (await run(unarchiveThread(common)));
    case "delete":
      return void (await run(
        deleteThread(command.OnlyIfUnused ? { ...common, onlyIfUnused: true } : common),
      ));
    case "modelSelection":
      return void (await run(
        updateThreadMetadata({ ...common, modelSelection: command.Selection as never }),
      ));
    case "runtimeMode":
      return void (await run(setThreadRuntimeMode({ ...common, runtimeMode: command.Mode })));
    case "branch":
      return void (await run(updateThreadMetadata({ ...common, branch: command.Branch })));
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
    case "scripts":
      return void (await run(updateProject({ ...common, scripts: command.Scripts })));
    default:
      command satisfies never;
  }
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

export const searchThreadsImpl = implementation(searchThreadsEffect, async (input, action) => {
  const result = await inEnvironment(
    input.EnvironmentId,
    request(ORCHESTRATION_V2_WS_METHODS.searchThreads, {
      query: input.Query.trim().slice(0, THREAD_SEARCH_QUERY_MAX_LENGTH).trim(),
    }),
    action?.signal,
  );
  const environmentId = EnvironmentId.make(input.EnvironmentId);
  return { Matches: result.matches.map((match) => ({ ...match, environmentId })) };
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
      createdAt: DateTime.formatIso(DateTime.nowUnsafe()),
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
    request(WS_METHODS.shellOpenInEditor, {
      cwd: input.Path,
      editor: "file-manager",
      ...(input.Reveal === true ? { reveal: true } : {}),
    }),
  );
});

export const openInEditorImpl = implementation(openInEditorEffect, async (input) => {
  const config = await inEnvironment(input.EnvironmentId, request(WS_METHODS.serverGetConfig, {}));
  const editor = preferredEditor(config.availableEditors, input.Stored);
  if (editor === null) throw serverFailure(`No editor on this machine can open ${input.Path}.`);
  await inEnvironment(
    input.EnvironmentId,
    request(WS_METHODS.shellOpenInEditor, {
      cwd: input.Path,
      editor,
      ...(input.ProjectRoot === null ? {} : { projectRoot: input.ProjectRoot }),
    }),
  );
  return editor;
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
  // Follows useCheckpointDiff in apps/web/src/state/queries.ts, which reads a range from the
  // thread's start as the whole thread's diff.
  const result =
    input.FromTurnCount === 0
      ? await inEnvironment(
          input.EnvironmentId,
          request(ORCHESTRATION_V2_WS_METHODS.getFullThreadDiff, {
            threadId,
            toTurnCount: input.ToTurnCount,
            ignoreWhitespace: input.IgnoreWhitespace,
          }),
          action?.signal,
        )
      : await inEnvironment(
          input.EnvironmentId,
          request(ORCHESTRATION_V2_WS_METHODS.getTurnDiff, {
            threadId,
            fromTurnCount: input.FromTurnCount,
            toTurnCount: input.ToTurnCount,
            ignoreWhitespace: input.IgnoreWhitespace,
          }),
          action?.signal,
        );
  return {
    Diff: result.diff,
    Repositories: (result.repositories ?? []).map((repository) => ({ ...repository })),
  };
});

export const taskFolderImpl = implementation(taskFolderEffect, async (input, action) => {
  const { taskFolder } = await inEnvironment(
    input.EnvironmentId,
    request(WS_METHODS.workspaceTaskFolder, { worktreePath: input.WorktreePath }),
    action?.signal,
  );
  return taskFolder === null ? null : taskFolder.projectIsWorktree;
});

const encodeTurnItem = Schema.encodeSync(wireCodec(OrchestrationV2TurnItem));

export const turnItemImpl = implementation(turnItemEffect, async (input, action) => {
  const { item } = await inEnvironment(
    input.EnvironmentId,
    request(ORCHESTRATION_V2_WS_METHODS.getTurnItem, {
      threadId: ThreadId.make(input.ThreadId),
      itemId: TurnItemId.make(input.ItemId),
    }),
    action?.signal,
  );
  return item === null ? null : (encodeTurnItem(item) as IWireTurnItem);
});

export const mcpAppImpl = implementation(mcpAppEffect, async (input, action) => {
  const target = { threadId: ThreadId.make(input.ThreadId), itemId: TurnItemId.make(input.ItemId) };
  const ask = input.Request;
  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      EnvironmentSupervisor.EnvironmentSupervisor | SecureRandom.SecureRandom
    >,
  ) => inEnvironment(input.EnvironmentId, effect, action?.signal);
  switch (ask.Kind) {
    case "toolInfo":
      return run(request(WS_METHODS.mcpAppsToolInfo, { ...target, name: ask.Name }));
    case "callTool":
      return run(
        request(WS_METHODS.mcpAppsCallTool, {
          ...target,
          name: ask.Name,
          arguments: ask.Arguments,
        }),
      );
    case "readResource":
      return run(request(WS_METHODS.mcpAppsReadResource, { ...target, uri: ask.Uri }));
    case "updateModelContext":
      await run(
        request(WS_METHODS.mcpAppsUpdateModelContext, {
          ...target,
          conversationThreadId: ThreadId.make(ask.ConversationThreadId),
          ...(ask.Content === undefined ? {} : { content: ask.Content }),
          ...(ask.StructuredContent === undefined
            ? {}
            : { structuredContent: ask.StructuredContent }),
        }),
      );
      return null;
  }
});

export const assetUrlImpl = implementation(assetUrlEffect, async (input, action) => {
  const { relativeUrl, expiresAt, imageDimensions, fileRevision } = await inEnvironment(
    input.EnvironmentId,
    request(WS_METHODS.assetsCreateUrl, { resource: input.Resource }),
    action?.signal,
  );
  return {
    Url: relativeUrl,
    ExpiresAt: expiresAt,
    ...(imageDimensions === undefined
      ? {}
      : { Size: { Width: imageDimensions.width, Height: imageDimensions.height } }),
    ...(fileRevision === undefined ? {} : { FileRevision: fileRevision }),
  };
});

const isProjectReadFileError = Schema.is(ProjectReadFileError);

// Follows useProjectFileQuery in apps/web/src/components/files/projectFilesQueryState.ts.
export const readProjectFileImpl = implementation(readProjectFileEffect, async (input, action) => {
  const exit = await runInEnvironment(
    input.EnvironmentId,
    request(WS_METHODS.projectsReadFile, { cwd: input.Cwd, relativePath: input.Path }),
    action?.signal,
  );
  if (Exit.isSuccess(exit)) {
    const read = exit.value;
    return {
      Kind: "text" as const,
      Contents: read.contents,
      ByteLength: read.byteLength,
      Truncated: read.truncated,
    };
  }
  const failure = Cause.squash(exit.cause);
  if (!Cause.hasDies(exit.cause) && isProjectReadFileError(failure)) {
    return {
      Kind: "error" as const,
      Message: failure.message,
      Failure: failure.failure ?? null,
      Operation: failure.operation ?? null,
      AttemptedPath: failure.resolvedPath ?? failure.operationPath ?? null,
      Cwd: failure.cwd ?? null,
    };
  }
  throw thrownOf(exit.cause);
});

// Follows the text fetch in apps/web/src/components/files/AttachmentFilePreview.tsx.
export const assetTextImpl = implementation(assetTextEffect, async (input, action) => {
  const { relativeUrl } = await inEnvironment(
    input.EnvironmentId,
    request(WS_METHODS.assetsCreateUrl, { resource: input.Resource }),
    action?.signal,
  );
  const signal = action?.signal ?? new AbortController().signal;
  const response = await serverFetch(relativeUrl, {
    signal,
    ...(input.SizeBytes > 0
      ? { headers: { Range: `bytes=0-${FILE_TEXT_PREVIEW_MAX_BYTES}` } }
      : {}),
  });
  try {
    const { text, truncated } = await readFilePreviewResponse(response, signal);
    return { Text: text, Truncated: truncated };
  } catch (error) {
    throw serverFailure(errorText(error), { cause: error });
  }
});

const followOnce = <A, E>(
  environmentId: string,
  effect: Effect.Effect<A, E, EnvironmentSupervisor.EnvironmentSupervisor>,
) =>
  settle(
    connectionRuntime.runPromiseExit(
      EnvironmentRegistry.EnvironmentRegistry.pipe(
        Effect.flatMap((registry) =>
          registry
            .followStream(EnvironmentId.make(environmentId), Stream.fromEffect(effect))
            .pipe(Stream.runHead),
        ),
        Effect.map(Option.getOrThrow),
      ),
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
