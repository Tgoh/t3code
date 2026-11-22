import {
  type ActiveTurnComposerAction,
  resolveComposerDispatchMode,
} from "@t3tools/client-runtime/state/composer-dispatch";
import {
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
} from "@t3tools/client-runtime/state/pending-user-input";
import {
  deriveThreadQueueWorkflowState,
  resolveLatestMergeBackRun,
  threadSupportsProviderHandoff,
} from "@t3tools/client-runtime/state/thread-workflows";
import { COMPACT_COMMAND_PATTERN } from "@t3tools/client-runtime/state/context-window";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS, type ProjectScript } from "@t3tools/contracts";
import {
  answer,
  ask,
  closeResource,
  entity,
  generateGuid,
  getData,
  type IActionGenerator,
  type IAskEntry,
  type IAskId,
  type IEntity,
  type IOpenGenerator,
  type IResourceHandle,
  type ISelectorGenerator,
  inFlight,
  latest,
  leading,
  open,
  openResource,
  pendingAsks,
  publishToNearest,
  receiver,
  resource,
  select,
  start,
  startTimer,
  stopTimer,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import {
  forkThreadEffect,
  mergeBackEffect,
  type IDispatchMode,
  type IModelFavorite,
  type IProviderOption,
  type IQueueOperation,
  type IStartTurn,
  type IWireAttachment,
  type IWireInteractionMode,
  type IWireModelSelection,
  type IWireRuntimeMode,
  projectCommandEffect,
  queueCommandEffect,
  rewindEffect,
  startTurnEffect,
  stopThreadEffect,
  threadCommandEffect,
  withCommandId,
} from "./Infrastructure/commandEffects";
import { type IDiffPanel, type IDiffRequest, type IDiffScope, loadDiff } from "./Diff";
import type { IGitWork } from "./GitWork";
import type { IAddressView } from "./Infrastructure/address";
import type { IPickedFile } from "./Infrastructure/composerFiles";
import { runScriptEffect } from "./Infrastructure/sourceControlEffects";
import {
  storeDraftEffect,
  storedDraftEffect,
  storedDraftFilesEffect,
  storeDraftFilesEffect,
} from "./Infrastructure/draftMemory";
import {
  rememberedModelKey,
  rememberedModelsEffect,
  rememberModelEffect,
} from "./Infrastructure/modelMemory";
import type { IAppearanceMode } from "./colorScheme";
import {
  compatibleRuntimeMode,
  dispatchSelection,
  modelChangeBlock,
  pickedSelection,
  providerOf,
} from "./modelOptions";
import { compactBeforeSendTokens } from "./compaction";
import {
  type IOpenThread,
  isRowVisible,
  latestDiffTurn,
  newestRun,
  timelineItem,
} from "./OpenThread";
import { type IPromptHistoryEntry, promptHistoryEntries, recallablePrompt } from "./promptHistory";
import {
  availableRevertTurnCounts,
  findRevertCheckpoint,
  type IRewindWatch,
  revertTurnCounts,
  rewindOutcome,
  rewindWatch,
  rewoundPrompt,
  threadStartAvailable,
  unsettledRunId,
} from "./rewind";
import {
  carryIntoPrompt,
  type IQuestion,
  type IQuestionDraft,
  questionProgress,
  seededDrafts,
} from "./questions";
import { answerRequest, canAnswer, type IRuntimeRequest } from "./RuntimeRequest";
import { minute } from "./Infrastructure/clock";
import { delay } from "./Infrastructure/delay";
import type { IWireServerConfig } from "./Infrastructure/settings";
import type { IShell } from "./Shell";
import { serverError, serverFailure } from "./Infrastructure/serverError";
import { detachTerminal, type ITerminal, openTerminal, restoreTerminal } from "./Terminal";
import {
  getDefaultThreadDetails,
  type IThreadDetails,
  openStatus,
  refreshStatus,
} from "./ThreadDetails";
import { checkout, threadShown } from "./checkout";

declare module "treflex" {
  interface IResourceRegistry {
    "Composer/Files": { Type: "composerFiles" };
    "Command/Output": { Type: "commandOutput" };
  }
  interface IDataSourceRegistry {
    Replica: IReplica;
    Selection: ISelection;
  }
  interface IMessageRegistry {
    "Thread/Started": { ThreadId: string };
    "Thread/Forked": { ThreadId: string };
    "Thread/MergedBack": { ThreadId: string };
    "Dictation/TranscriptRefused": { ThreadId: string };
    "Git/StatusFollowed": {};
    "Details/Pinned": { Open: boolean };
  }
  interface ITimerRegistry {
    "Rewind/Timeout": {};
  }
}

const TITLE_LENGTH = 60;
export const DEFAULT_RUNTIME_MODE: IWireRuntimeMode = "full-access";

export interface IReplica extends IEntity {
  Providers: IProviderOption[];
  ModelFavorites: IModelFavorite[];
  Shell: IShell;
  OpenThreads: Record<string, IOpenThread>;
  Config: IWireServerConfig | null;
}

export interface ISelection extends IEntity {
  SelectedThreadId: string | null;
  /** A Settings or Usage page, which covers the selected thread. */
  View: IAddressView | null;
  Preferences: {
    AppearanceMode: IAppearanceMode;
    CompactionDismissed: string[];
    DetailsOpen: boolean;
  };
  SystemDark: boolean;
  ClientSettings: { followUpBehavior: ActiveTurnComposerAction } | null;
}

export type IAttachmentDraft = IPickedFile;

/** An expanded command row's output, whose subscription is open while its thread is shown. */
export interface ICommandOutputRow extends IEntity {
  /** The thread that ran the command, which differs from the session's for an inherited row. */
  ThreadId: string;
  ItemId: string;
}

export interface IDetailsPanel {
  /** Shown as a popover under its toggle while the card doesn't fit. */
  Popover: boolean;
  /** Whether the thread view has room to pin the card, as its layout last measured. */
  Fits: boolean;
}

export interface IThreadSession extends IEntity {
  EnvironmentId: string;
  ThreadId: string;
  NewThreadProjectId: string | null;
  Draft: string;
  Attachments: IAttachmentDraft[];
  AttachmentError?: string;
  AttachmentNotice?: string;
  ModelSelection: IWireModelSelection | null;
  RuntimeMode: IWireRuntimeMode | null;
  /** The next send skips the compaction the composer offers. */
  KeepFullHistory: boolean;
  ModelError?: string;
  SendError?: string;
  StopError?: string;
  QueueError?: string;
  RewindError?: string;
  ForkError?: string;
  MergeError?: string;
  ScriptError?: string;
  QuestionAnswers: Record<string, Record<string, IQuestionDraft>>;
  QuestionIndex: Record<string, number>;
  QuestionNotice?: string;
  Panels: { Diff: IDiffPanel | null; Details: IDetailsPanel; Launcher: { Open: boolean } };
  Terminal: ITerminal;
  Git: IGitWork;
  /** Present while the thread is shown and has a checkout, which is when its git status is open. */
  Details: IThreadDetails | null;
  ExpandedRows: Record<string, true>;
  CommandOutputs: Record<string, ICommandOutputRow>;
  /** Code blocks the person turned wrapping off for, by block key. */
  UnwrappedCode: Record<string, true>;
}

export function getDefaultThreadSession(
  environmentId: string,
  threadId: string,
  newThreadProjectId: string | null,
): Omit<IThreadSession, "$Id" | "Git" | "Terminal"> {
  return {
    EnvironmentId: environmentId,
    ThreadId: threadId,
    NewThreadProjectId: newThreadProjectId,
    Draft: "",
    Attachments: [],
    ModelSelection: null,
    RuntimeMode: null,
    KeepFullHistory: false,
    QuestionAnswers: {},
    QuestionIndex: {},
    Panels: {
      Diff: null,
      Details: { Popover: false, Fits: false },
      Launcher: { Open: false },
    },
    ExpandedRows: {},
    CommandOutputs: {},
    UnwrappedCode: {},
    Details: null,
  };
}

export function* effectiveModel(
  draft: IThreadSession,
): ISelectorGenerator<IWireModelSelection | null> {
  if (draft.ModelSelection != null) return draft.ModelSelection;
  const replica = yield* getData(draft, "Replica");
  if (replica === undefined) return null;
  const thread = replica.OpenThreads[draft.ThreadId]?.Thread;
  if (thread != null) return thread.modelSelection;
  const projectId = draft.NewThreadProjectId;
  const projectDefault =
    projectId == null ? null : replica.Shell.Projects[projectId]?.defaultModelSelection;
  if (projectDefault != null) return projectDefault;
  for (const provider of replica.Providers) {
    const model = provider.Models.find((held) => held.IsDefault) ?? provider.Models[0];
    if (model !== undefined) {
      return { instanceId: provider.InstanceId, model: model.Slug } as IWireModelSelection;
    }
  }
  return null;
}

export function modelDisplay(
  providers: IProviderOption[],
  selection: IWireModelSelection,
): { Driver: string | undefined; Name: string } {
  const provider = providers.find((option) => option.InstanceId === selection.instanceId);
  const name =
    provider?.Models.find((model) => model.Slug === selection.model)?.Name ?? selection.model;
  return { Driver: provider?.Driver, Name: name.replace(/^Claude /, "") };
}

function* effectiveProvider(
  draft: IThreadSession,
): ISelectorGenerator<IProviderOption | undefined> {
  const model = yield* effectiveModel(draft);
  const replica = yield* getData(draft, "Replica");
  return model === null ? undefined : providerOf(replica?.Providers ?? [], model);
}

function* threadModelSelection(
  draft: IThreadSession,
): ISelectorGenerator<IWireModelSelection | null> {
  const replica = yield* getData(draft, "Replica");
  return replica?.OpenThreads[draft.ThreadId]?.Thread?.modelSelection ?? null;
}

export interface IModelSwitch {
  Started: boolean;
  SupportsHandoff: boolean;
  CurrentInstanceId: string | null;
}

export function* modelSwitch(draft: IThreadSession): ISelectorGenerator<IModelSwitch> {
  const replica = yield* getData(draft, "Replica");
  const open = replica?.OpenThreads[draft.ThreadId];
  if (draft.NewThreadProjectId !== null || open?.Thread == null) {
    return { Started: false, SupportsHandoff: true, CurrentInstanceId: null };
  }
  const runs = Object.values(open.Runs).sort((left, right) => left.ordinal - right.ordinal);
  const projection = {
    thread: open.Thread,
    runs,
    providerThreads: Object.values(open.ProviderThreads),
    providerSessions: Object.values(open.ProviderSessions),
  };
  return {
    Started: runs.length > 0,
    SupportsHandoff: threadSupportsProviderHandoff(projection as never),
    CurrentInstanceId: open.Thread.modelSelection.instanceId,
  };
}

export interface IQueueWorkflow {
  CanSendNow: boolean;
  CanSteer: boolean;
  PromoteSkipsCompaction: boolean;
  ActiveRunId: string | null;
}

export function* queueWorkflow(draft: IThreadSession): ISelectorGenerator<IQueueWorkflow> {
  const replica = yield* getData(draft, "Replica");
  const open = replica?.OpenThreads[draft.ThreadId];
  if (open?.Thread == null) {
    return { CanSendNow: false, CanSteer: false, PromoteSkipsCompaction: false, ActiveRunId: null };
  }
  const byOrdinal = <T extends { ordinal: number }>(rows: T[]) =>
    rows.sort((left, right) => left.ordinal - right.ordinal);
  const state = deriveThreadQueueWorkflowState({
    thread: open.Thread,
    runs: byOrdinal(Object.values(open.Runs)),
    messages: Object.values(open.Messages),
    providerTurns: Object.values(open.ProviderTurns),
    providerThreads: Object.values(open.ProviderThreads),
    providerSessions: Object.values(open.ProviderSessions),
  } as never);
  return {
    CanSendNow: state.canSendNow,
    CanSteer: state.canPromoteToSteer,
    PromoteSkipsCompaction: state.promoteSkipsCompaction,
    ActiveRunId: state.activeRun?.id ?? null,
  };
}

// Follows canSendRun in apps/web/src/components/chat/QueuedRunsControl.tsx: a fresh-context
// message starts its own turn, so it can skip a compaction but never steer into a turn.
function* steerOperation(
  draft: IThreadSession,
  runId: string,
): ISelectorGenerator<IQueueOperation | null> {
  const workflow = yield* queueWorkflow(draft);
  if (workflow.ActiveRunId === null || !workflow.CanSteer) return null;
  const replica = yield* getData(draft, "Replica");
  const freshContext = replica?.OpenThreads[draft.ThreadId]?.Runs[runId]?.freshContext === true;
  if (freshContext && !workflow.PromoteSkipsCompaction) return null;
  return { Kind: "steer", RunId: runId, TargetRunId: workflow.ActiveRunId };
}

function* effectiveModelDisplay(
  draft: IThreadSession,
): ISelectorGenerator<ReturnType<typeof modelDisplay> | null> {
  const model = yield* effectiveModel(draft);
  if (model === null) return null;
  const replica = yield* getData(draft, "Replica");
  return modelDisplay(replica?.Providers ?? [], model);
}

function* effectiveModelDriver(draft: IThreadSession): ISelectorGenerator<string | undefined> {
  return (yield* effectiveModelDisplay(draft))?.Driver;
}

function* effectiveModelName(draft: IThreadSession): ISelectorGenerator<string | null> {
  return (yield* effectiveModelDisplay(draft))?.Name ?? null;
}

function* threadRuntimeMode(draft: IThreadSession): ISelectorGenerator<IWireRuntimeMode | null> {
  const replica = yield* getData(draft, "Replica");
  return replica?.OpenThreads[draft.ThreadId]?.Thread?.runtimeMode ?? null;
}

function* runtimeModeChoice(draft: IThreadSession) {
  const provider = yield* effectiveProvider(draft);
  const held = draft.RuntimeMode ?? (yield* threadRuntimeMode(draft)) ?? DEFAULT_RUNTIME_MODE;
  return compatibleRuntimeMode(held, provider?.SupportedRuntimeModes);
}

export function* effectiveRuntimeMode(draft: IThreadSession): ISelectorGenerator<IWireRuntimeMode> {
  return (yield* runtimeModeChoice(draft)).Mode;
}

function* runtimeModes(draft: IThreadSession): ISelectorGenerator<ReadonlyArray<IWireRuntimeMode>> {
  return (yield* runtimeModeChoice(draft)).Modes;
}

function* interactionMode(draft: IThreadSession): ISelectorGenerator<IWireInteractionMode> {
  const replica = yield* getData(draft, "Replica");
  return replica?.OpenThreads[draft.ThreadId]?.Thread?.interactionMode ?? "default";
}

export function threadProjectId(
  replica: Pick<IReplica, "OpenThreads" | "Shell"> | undefined,
  threadId: string,
  newThreadProjectId: string | null | undefined,
): string | null {
  return (
    newThreadProjectId ??
    replica?.OpenThreads[threadId]?.Thread?.projectId ??
    replica?.Shell.Threads[threadId]?.projectId ??
    null
  );
}

export function* projectId(draft: IThreadSession): ISelectorGenerator<string | null> {
  if (draft.NewThreadProjectId !== null) return draft.NewThreadProjectId;
  return threadProjectId(yield* getData(draft, "Replica"), draft.ThreadId, null);
}

export function* projectName(draft: IThreadSession): ISelectorGenerator<string | null> {
  const id = yield* projectId(draft);
  if (id === null) return null;
  return (yield* getData(draft, "Replica"))?.Shell.Projects[id]?.title ?? null;
}

export function* stopRequested(draft: IThreadSession): ISelectorGenerator<boolean> {
  const replica = yield* getData(draft, "Replica");
  return replica?.Shell.Threads[draft.ThreadId]?.latestRunStopRequested === true;
}

function* latestThreadDiffTurn(draft: IThreadSession): ISelectorGenerator<number | null> {
  const replica = yield* getData(draft, "Replica");
  const thread = replica?.OpenThreads[draft.ThreadId];
  return thread === undefined ? null : latestDiffTurn(thread);
}

export interface IMenuCatalog {
  Commands: NonNullable<IProviderOption["SlashCommands"]>;
  Skills: NonNullable<IProviderOption["Skills"]>;
}

const EMPTY_CATALOG: IMenuCatalog = { Commands: [], Skills: [] };

export function* menuCatalog(draft: IThreadSession): ISelectorGenerator<IMenuCatalog> {
  const provider = yield* effectiveProvider(draft);
  if (provider === undefined) return EMPTY_CATALOG;
  return { Commands: provider.SlashCommands ?? [], Skills: provider.Skills ?? [] };
}

function* searchRoot(draft: IThreadSession): ISelectorGenerator<string | null> {
  const held = yield* checkout(draft);
  if (held !== null) return held.Cwd;
  const replica = yield* getData(draft, "Replica");
  if (replica === undefined) return null;
  const projectId = draft.NewThreadProjectId;
  const root = projectId === null ? undefined : replica.Shell.Projects[projectId]?.workspaceRoot;
  return replica.OpenThreads[draft.ThreadId]?.Thread?.worktreePath ?? root ?? null;
}

export interface IPanels {
  /** The details card has a checkout to show, which the branch diff needs too. */
  Details: boolean;
  Terminal: boolean;
  /** The thread has a turn to diff. */
  Diff: boolean;
  DiffOpen: boolean;
  RightPanelOpen: boolean;
  TerminalEntityId: string;
}

export function* panels(draft: IThreadSession): ISelectorGenerator<IPanels> {
  const replica = yield* getData(draft, "Replica");
  const thread = replica?.OpenThreads[draft.ThreadId];
  const diffOpen = draft.Panels.Diff !== null;
  return {
    Details: (yield* checkout(draft)) !== null,
    Terminal: thread?.Thread != null,
    Diff: thread !== undefined && latestDiffTurn(thread) !== null,
    DiffOpen: diffOpen,
    RightPanelOpen: diffOpen || draft.Panels.Launcher.Open,
    TerminalEntityId: draft.Terminal.$Id,
  };
}

export function* promptHistory(draft: IThreadSession): ISelectorGenerator<IPromptHistoryEntry[]> {
  const replica = yield* getData(draft, "Replica");
  const thread = replica?.OpenThreads[draft.ThreadId];
  return thread === undefined ? [] : promptHistoryEntries(Object.values(thread.Messages));
}

export function* fileSearchRoot(draft: IThreadSession): ISelectorGenerator<string | null> {
  return yield* searchRoot(draft);
}

/** Stock's Follow-up behavior setting: what a send does while a turn runs. */
export function* followUpBehavior(
  draft: IThreadSession,
): ISelectorGenerator<ActiveTurnComposerAction> {
  const selection = yield* getData(draft, "Selection");
  return selection?.ClientSettings?.followUpBehavior ?? "queue";
}

function* storeDraft(draft: IThreadSession): IActionGenerator {
  const kept = draft.Draft !== "" || draft.ModelSelection !== null || draft.RuntimeMode !== null;
  yield* storeDraftEffect({
    ThreadId: draft.ThreadId,
    Draft: kept
      ? {
          Text: draft.Draft,
          NewThreadProjectId: draft.NewThreadProjectId,
          ModelSelection: draft.ModelSelection,
          RuntimeMode: draft.RuntimeMode,
        }
      : null,
  });
}

export function* storeFiles(draft: IThreadSession): IOpenGenerator {
  const ids = draft.Attachments.map((file) => file.Id);
  const threadId = draft.ThreadId;
  const files = resource(draft, "Composer/Files");
  const stored = ids.length === 0 ? [] : yield* open(files.stored(ids));
  if (stored === undefined) return;
  yield* storeDraftFilesEffect({ ThreadId: threadId, Files: stored });
}
latest(storeFiles);

/** Fills a fresh session from what this browser kept, before anything is typed into it. */
export function* restoreDraft(draft: IThreadSession): IActionGenerator {
  const stored = yield* storedDraftEffect({ ThreadId: draft.ThreadId });
  if (stored !== null) {
    draft.Draft = stored.Text;
    draft.ModelSelection = stored.ModelSelection;
    draft.RuntimeMode = stored.RuntimeMode;
  }
  yield* start(restoreFiles, draft);
}

export function* restoreFiles(draft: IThreadSession): IOpenGenerator {
  const stored = yield* storedDraftFilesEffect({ ThreadId: draft.ThreadId });
  if (stored.length === 0) return;
  const files = resource(draft, "Composer/Files");
  const restored = yield* open(files.restore(stored));
  if (restored === undefined) return;
  draft.Attachments.unshift(...restored);
  if (restored.length < stored.length) {
    draft.AttachmentNotice =
      "Some attachments didn't finish uploading before the page closed. Attach them again.";
  }
  yield* start(storeFiles, draft);
}

export function* setDraft(draft: IThreadSession, text: string): IActionGenerator {
  draft.Draft = text;
  yield* storeDraft(draft);
}

/**
 * A dictation's transcript, the whole draft made against `before`. The check and the write are
 * one action, so no write queued on the session can land between them.
 */
export function* applyTranscript(
  draft: IThreadSession,
  before: string,
  text: string,
  mode: IDispatchMode | null,
): IActionGenerator {
  if (draft.Draft !== before) {
    yield* publishToNearest(draft, "Dictation/TranscriptRefused", { ThreadId: draft.ThreadId });
    return;
  }
  yield* setDraft(draft, text);
  if (mode !== null) yield* start(send, draft, mode);
}

/** Holds the pick for the next turn, and on a started thread's own provider saves it at once. */
export function* setModelSelection(
  draft: IThreadSession,
  selection: IWireModelSelection,
): IOpenGenerator {
  draft.ModelSelection = selection;
  delete draft.ModelError;
  yield* storeDraft(draft);
  yield* rememberModelEffect({ Selection: selection });
  const thread = yield* select(threadModelSelection);
  if (draft.NewThreadProjectId !== null || thread?.instanceId !== selection.instanceId) return;
  const provider = yield* select(effectiveProvider);
  const command = {
    Kind: "modelSelection" as const,
    Selection: dispatchSelection(provider, selection),
  };
  const environmentId = draft.EnvironmentId;
  const threadId = draft.ThreadId;
  try {
    yield* open(
      withCommandId((commandId) =>
        threadCommandEffect({
          EnvironmentId: environmentId,
          ThreadId: threadId,
          CommandId: commandId,
          Command: command,
        }),
      ),
    );
  } catch (error) {
    draft.ModelError = `This model pick was not saved. ${serverError(error).message}`;
  }
}
latest(setModelSelection);

/** A model chosen from the list: re-picking keeps its options, another starts from remembered ones. */
export function* chooseModel(
  draft: IThreadSession,
  instanceId: string,
  model: string,
): IOpenGenerator {
  const blocked = modelChangeBlock({
    ...(yield* select(modelSwitch)),
    NextInstanceId: instanceId,
  });
  if (blocked !== null) {
    draft.ModelError = blocked;
    return;
  }
  const current = yield* select(effectiveModel);
  if (current?.instanceId === instanceId && current.model === model) {
    yield* setModelSelection(draft, current);
    return;
  }
  const remembered = yield* rememberedModelsEffect();
  const selection = pickedSelection(
    instanceId,
    model,
    remembered.OptionsByModel[rememberedModelKey(instanceId, model)],
    yield* select(threadModelSelection),
  );
  yield* setModelSelection(draft, selection);
}

export function* setRuntimeMode(draft: IThreadSession, mode: IWireRuntimeMode): IActionGenerator {
  draft.RuntimeMode = mode;
  yield* storeDraft(draft);
}

export function* addAttachments(
  draft: IThreadSession,
  picked: IPickedFile[],
  error: string | null,
  notice: string | null = null,
): IActionGenerator {
  delete draft.AttachmentNotice;
  if (error === null) delete draft.AttachmentError;
  else draft.AttachmentError = error;
  if (notice !== null) draft.AttachmentNotice = notice;
  draft.Attachments.push(...picked);
  if (picked.length > 0) yield* start(storeFiles, draft);
}

export function* removeAttachment(draft: IThreadSession, id: string): IActionGenerator {
  const index = draft.Attachments.findIndex((held) => held.Id === id);
  if (index >= 0) draft.Attachments.splice(index, 1);
  yield* resource(draft, "Composer/Files").remove(id);
  yield* start(storeFiles, draft);
}

function* uploadAndStart(
  files: IResourceHandle<"Composer/Files">,
  fileIds: string[],
  turn: Omit<IStartTurn, "CommandId" | "MessageId" | "Attachments">,
  setRuntimeMode: boolean,
  compactFirst: boolean,
): IActionGenerator {
  const attachments: IWireAttachment[] = [];
  for (const id of fileIds) {
    const uploaded = yield* files.upload(id);
    if (uploaded === undefined) throw serverFailure("An attachment couldn't be uploaded.");
    attachments.push(uploaded);
  }
  if (setRuntimeMode) {
    yield* withCommandId((commandId) =>
      threadCommandEffect({
        EnvironmentId: turn.EnvironmentId,
        ThreadId: turn.ThreadId,
        CommandId: commandId,
        Command: { Kind: "runtimeMode", Mode: turn.RuntimeMode },
      }),
    );
  }
  if (compactFirst) {
    yield* startTurnEffect({
      ...turn,
      CommandId: yield* generateGuid(),
      MessageId: yield* generateGuid(),
      Text: "/compact",
      Attachments: [],
      DispatchMode: "auto",
      IdleCompaction: "onReturn",
    });
  }
  const commandId = yield* generateGuid();
  const messageId = yield* generateGuid();
  yield* startTurnEffect({
    ...turn,
    CommandId: commandId,
    MessageId: messageId,
    Attachments: attachments,
    // Steering into the compaction is rejected, so the message waits behind it.
    DispatchMode: compactFirst ? "queue" : turn.DispatchMode,
  });
}

/**
 * The tokens the next send compacts first, or null when it sends as is.
 * Follows `resumeCompactionTokens` in apps/web/src/components/ChatView.tsx.
 */
export function* compactionOffer(draft: IThreadSession): ISelectorGenerator<number | null> {
  const tokens = yield* select(compactionCandidate);
  return tokens === null || COMPACT_COMMAND_PATTERN.test(draft.Draft.trim()) ? null : tokens;
}

// Must not read the draft text: it walks the whole timeline, so its memo has to survive typing.
function* compactionCandidate(draft: IThreadSession): ISelectorGenerator<number | null> {
  if (draft.NewThreadProjectId !== null) return null;
  const replica = yield* getData(draft, "Replica");
  const open = replica?.OpenThreads[draft.ThreadId];
  const config = replica?.Config;
  const selection = yield* effectiveModel(draft);
  if (open?.Thread == null || config == null || selection === null) return null;
  const local = yield* getData(draft, "Selection");
  return compactBeforeSendTokens({
    Thread: open,
    Items: () =>
      open.Timeline.filter((id) => isRowVisible(open, id)).map((id) => timelineItem(open, id)!),
    Selection: selection,
    Config: config,
    Idle: Object.values(open.Runs).every(
      (run) => !ACTIVE_RUN.has(run.status) && run.status !== "queued",
    ),
    Now: yield* minute(),
    EnvironmentId: draft.EnvironmentId,
    Dismissed: local?.Preferences.CompactionDismissed ?? [],
  });
}

export function* toggleKeepFullHistory(draft: IThreadSession): IActionGenerator {
  draft.KeepFullHistory = !draft.KeepFullHistory;
}

/** `auto` lets the server choose; during a run the composer asks for `steer` or `queue`. */
export function* send(draft: IThreadSession, mode: IDispatchMode = "auto"): IOpenGenerator {
  const text = draft.Draft.trim();
  const fileIds = draft.Attachments.map((file) => file.Id);
  if ((text === "" && fileIds.length === 0) || (yield* inFlight(editFromHere, draft))) return;
  const projectId = draft.NewThreadProjectId;
  const model = yield* select(effectiveModel);
  const provider = yield* select(effectiveProvider);
  const runtimeMode = yield* select(effectiveRuntimeMode);
  const threadMode = yield* select(threadRuntimeMode);
  const interaction = yield* select(interactionMode);
  const compactFirst = !draft.KeepFullHistory && (yield* select(compactionOffer)) !== null;
  const files = resource(draft, "Composer/Files");
  const turn = {
    EnvironmentId: draft.EnvironmentId,
    ThreadId: draft.ThreadId,
    Text: text,
    ModelSelection: model === null ? null : dispatchSelection(provider, model),
    RuntimeMode: runtimeMode,
    InteractionMode: interaction,
    DispatchMode: mode,
    NewThread:
      projectId === null
        ? null
        : { ProjectId: projectId, Title: text.slice(0, TITLE_LENGTH) || "New thread" },
  };
  delete draft.SendError;
  try {
    if (projectId !== null && model === null) throw serverFailure("No provider is available.");
    const setsMode = projectId === null && threadMode !== null && threadMode !== runtimeMode;
    yield* open(uploadAndStart(files, fileIds, turn, setsMode, compactFirst));
  } catch (error) {
    draft.SendError = serverError(error).message;
    return;
  }
  draft.KeepFullHistory = false;
  if (draft.Draft.trim() === text) draft.Draft = "";
  draft.Attachments = draft.Attachments.filter((file) => !fileIds.includes(file.Id));
  delete draft.AttachmentNotice;
  delete draft.AttachmentError;
  if (fileIds.length > 0) {
    yield* resource(draft, "Composer/Files").forget(fileIds);
    yield* start(storeFiles, draft);
  }
  if (projectId !== null) draft.NewThreadProjectId = null;
  yield* storeDraft(draft);
  if (projectId !== null) {
    yield* publishToNearest(draft, "Thread/Started", { ThreadId: draft.ThreadId });
  }
}
leading(send);

export function* stopRun(draft: IThreadSession): IOpenGenerator {
  delete draft.StopError;
  const environmentId = draft.EnvironmentId;
  const threadId = draft.ThreadId;
  try {
    yield* open(
      withCommandId((commandId) =>
        stopThreadEffect({
          EnvironmentId: environmentId,
          ThreadId: threadId,
          CommandId: commandId,
        }),
      ),
    );
  } catch (error) {
    draft.StopError = serverError(error).message;
  }
}
leading(stopRun);

export type IQueuePress =
  | Exclude<IQueueOperation, { Kind: "start" | "steer" | "edit" }>
  | { Kind: "edit"; RunId: string; Text: string; Alternate: boolean }
  | { Kind: "sendNow"; RunId: string };

// Follows sendQueuedMessage in apps/web/src/components/chat/QueuedRunsControl.tsx, and saveEdit's
// steer in apps/web/src/components/chat/useQueuedRunEdit.ts.
export function* queueAction(draft: IThreadSession, press: IQueuePress): IOpenGenerator {
  delete draft.QueueError;
  let operation: IQueueOperation | null;
  if (press.Kind === "edit") {
    operation = { Kind: "edit", RunId: press.RunId, Text: press.Text };
  } else if (press.Kind !== "sendNow") operation = press;
  else if ((yield* select(queueWorkflow)).CanSendNow) {
    operation = { Kind: "start", RunId: press.RunId };
  } else operation = yield* select((held: IThreadSession) => steerOperation(held, press.RunId));
  const environmentId = draft.EnvironmentId;
  const threadId = draft.ThreadId;
  const run = (operation: IQueueOperation) =>
    open(
      withCommandId((commandId) =>
        queueCommandEffect({
          EnvironmentId: environmentId,
          ThreadId: threadId,
          CommandId: commandId,
          Operation: operation,
        }),
      ),
    );
  try {
    if (operation === null) return;
    yield* run(operation);
    // Only the opposite of the follow-up default asks to steer, as it does for a new follow-up.
    if (press.Kind !== "edit" || !press.Alternate) return;
    const followUp = yield* select(followUpBehavior);
    const mode = resolveComposerDispatchMode({
      running: true,
      alternateModifier: true,
      activeTurnDefault: followUp,
    });
    if (mode !== "steer") return;
    const steer = yield* select((held: IThreadSession) => steerOperation(held, press.RunId));
    if (steer !== null) yield* run(steer);
  } catch (error) {
    draft.QueueError = serverError(error).message;
  }
}
leading(queueAction);

const ACTIVE_RUN = new Set(["preparing", "starting", "running", "waiting"]);
const REWIND_TIMEOUT_MS = 120_000;
const EMPTY_TARGETS: Record<string, number> = {};

export type IRewindChoice = "keepChanges" | "restoreFiles";

export interface IRewindConfirm {
  Path: "Rewind/Confirm";
  TurnCount: number;
  CanRestoreFiles: boolean;
}

interface IRewindLanding {
  Path: "Rewind/Landing";
  Watch: IRewindWatch;
}

function* openThreadOf(draft: IThreadSession): ISelectorGenerator<IOpenThread | undefined> {
  const replica = yield* getData(draft, "Replica");
  return replica?.OpenThreads[draft.ThreadId];
}

// Follows supportsConversationRollback in apps/web/src/components/ChatView.tsx.
function* rollbackSupported(draft: IThreadSession): ISelectorGenerator<boolean> {
  const replica = yield* getData(draft, "Replica");
  const thread = replica?.OpenThreads[draft.ThreadId];
  if (replica === undefined || thread?.Thread == null) return false;
  const activeId = thread.Thread.activeProviderThreadId;
  const instanceId =
    (activeId == null ? undefined : thread.ProviderThreads[activeId]?.providerInstanceId) ??
    thread.Thread.modelSelection.instanceId;
  const provider = replica.Providers.find((option) => option.InstanceId === instanceId);
  return provider !== undefined && provider.SupportsRollback !== false;
}

export function* threadWorking(draft: IThreadSession): ISelectorGenerator<boolean> {
  const thread = yield* openThreadOf(draft);
  const run = thread === undefined ? null : newestRun(thread);
  return run !== null && ACTIVE_RUN.has(run.status);
}

/** The turn count each user row's "Edit from here" rewinds to, by row id. */
export function* revertTargets(draft: IThreadSession): ISelectorGenerator<Record<string, number>> {
  const thread = yield* openThreadOf(draft);
  if (thread === undefined || !(yield* rollbackSupported(draft))) return EMPTY_TARGETS;
  return revertTurnCounts(thread, {
    ThreadStart: threadStartAvailable(thread),
    UnsettledRunId: unsettledRunId(thread),
    Available: availableRevertTurnCounts(thread),
  });
}

// Follows RevertConfirmHost in apps/web/src/components/chat/ChatOverlayHosts.tsx: the server
// refuses file restore outside an isolated worktree.
function* canRestoreFiles(draft: IThreadSession, turnCount: number): ISelectorGenerator<boolean> {
  const thread = yield* openThreadOf(draft);
  if (thread?.Thread == null || thread.Thread.worktreePath === null) return false;
  return findRevertCheckpoint(thread, turnCount)?.status === "ready";
}

interface IRewindPlan {
  Prompt: string;
  Attachments: IWireAttachment[];
  Watch: IRewindWatch;
  Checkpoint: { Id: string; ScopeId: string } | null;
}

function* rewindPlan(
  draft: IThreadSession,
  itemId: string,
  turnCount: number,
  commandId: string,
): ISelectorGenerator<IRewindPlan | null> {
  const thread = yield* openThreadOf(draft);
  if (thread === undefined) return null;
  const item = timelineItem(thread, itemId);
  const watch = rewindWatch(thread, turnCount, commandId);
  if (item?.type !== "user_message" || watch === null) return null;
  const checkpoint = findRevertCheckpoint(thread, turnCount);
  return {
    Prompt: recallablePrompt(item.text),
    Attachments: item.attachments ?? [],
    Watch: watch,
    Checkpoint:
      checkpoint === undefined ? null : { Id: checkpoint.id, ScopeId: checkpoint.scopeId },
  };
}

function* rewindLanded(draft: IThreadSession, watch: IRewindWatch) {
  const thread = yield* openThreadOf(draft);
  return thread === undefined ? null : rewindOutcome(thread, watch);
}

function* sendRewind(
  files: IResourceHandle<"Composer/Files">,
  attachments: IWireAttachment[],
  request: Parameters<typeof rewindEffect>[0],
): IActionGenerator<IPickedFile[]> {
  const recalled = attachments.length === 0 ? [] : yield* files.recall(attachments);
  if (recalled === undefined)
    throw serverFailure("The composer closed before its files came back.");
  try {
    yield* rewindEffect(request);
  } catch (error) {
    for (const file of recalled) yield* files.remove(file.Id);
    throw error;
  }
  return recalled;
}

/**
 * Rewinds the thread to before a user message and puts that message back in the composer, after
 * the person confirms. Follows onRevertToTurnCount in useTimelineRewind.ts and rewindToMessage in
 * chatViewSend.ts, both in apps/web/src/components/chat. Answers whether the composer was filled.
 */
export function* editFromHere(
  draft: IThreadSession,
  itemId: string,
  turnCount: number,
): IOpenGenerator<boolean> {
  if (!(yield* select(rollbackSupported))) {
    draft.RewindError =
      "This provider does not support reverting conversation history. Start a new thread instead.";
    return false;
  }
  if ((yield* select(threadWorking)) || (yield* inFlight(send, draft))) {
    draft.RewindError = "Interrupt the current turn before reverting checkpoints.";
    return false;
  }
  const confirm: IRewindConfirm = {
    Path: "Rewind/Confirm",
    TurnCount: turnCount,
    CanRestoreFiles: yield* select((held: IThreadSession) => canRestoreFiles(held, turnCount)),
  };
  const choice = yield* open(ask<IRewindChoice>(draft, confirm));
  if (choice === undefined) return false;
  delete draft.RewindError;
  const commandId = yield* generateGuid();
  const plan = yield* select((held: IThreadSession) =>
    rewindPlan(held, itemId, turnCount, commandId),
  );
  if (plan === null) {
    draft.RewindError = "The thread has changed. Select a message to rewind again.";
    return false;
  }
  if (draft.Attachments.length + plan.Attachments.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
    draft.RewindError =
      "Make room for this message's attachments in the composer before rewinding.";
    return false;
  }
  const files = resource(draft, "Composer/Files");
  const request = {
    EnvironmentId: draft.EnvironmentId,
    ThreadId: draft.ThreadId,
    CommandId: commandId,
    TurnCount: turnCount,
    RestoreFiles: choice === "restoreFiles",
    Checkpoint: plan.Checkpoint,
  };
  let recalled: IPickedFile[];
  try {
    recalled = yield* open(sendRewind(files, plan.Attachments, request));
  } catch (error) {
    draft.RewindError = serverError(error).message;
    return false;
  }
  // The stream may have delivered the rollback while the command was in flight.
  let outcome = yield* select((held: IThreadSession) => rewindLanded(held, plan.Watch));
  if (outcome === null) {
    yield* startTimer(draft, "Rewind/Timeout", RewindReceiver, REWIND_TIMEOUT_MS);
    const landing: IRewindLanding = { Path: "Rewind/Landing", Watch: plan.Watch };
    const failure = yield* open(ask<string | null>(draft, landing));
    if (failure === undefined) return false;
    yield* stopTimer(draft, "Rewind/Timeout");
    outcome = failure === null ? { Done: true } : { Error: failure };
  }
  if ("Error" in outcome) {
    for (const file of recalled) yield* files.remove(file.Id);
    draft.RewindError = outcome.Error;
    return false;
  }
  draft.Draft = rewoundPrompt(draft.Draft, plan.Prompt);
  yield* storeDraft(draft);
  if (recalled.length > 0) {
    draft.Attachments.push(...recalled);
    yield* start(storeFiles, draft);
  }
  return true;
}
leading(editFromHere);

const isAsk = (entry: IAskEntry, path: string) =>
  (entry.Request as { Path?: string }).Path === path;

export function* rewindConfirm(
  draft: IThreadSession,
): ISelectorGenerator<(IAskEntry & { Request: IRewindConfirm }) | null> {
  const entry = (yield* pendingAsks(draft)).find((held) => isAsk(held, "Rewind/Confirm"));
  return (entry as (IAskEntry & { Request: IRewindConfirm }) | undefined) ?? null;
}

/** The confirm dialog's answer; no choice cancels. */
export function* chooseRewind(
  _draft: IThreadSession,
  askId: IAskId<IRewindChoice>,
  choice?: IRewindChoice,
): IActionGenerator {
  yield* answer(askId, choice);
}

function* answerLanding(draft: IThreadSession, timedOut: boolean): IActionGenerator {
  for (const entry of yield* pendingAsks(draft)) {
    if (!isAsk(entry, "Rewind/Landing")) continue;
    const { Watch } = entry.Request as IRewindLanding;
    const id = entry.Id as IAskId<string | null>;
    if (timedOut) {
      yield* answer(id, "Timed out waiting for the thread to rewind.");
      continue;
    }
    const outcome = yield* select((held: IThreadSession) => rewindLanded(held, Watch));
    if (outcome !== null) yield* answer(id, "Error" in outcome ? outcome.Error : null);
  }
}

/** Run when the thread's stream moves a rollback along. */
export function* checkRewind(draft: IThreadSession): IActionGenerator {
  yield* answerLanding(draft, false);
}

export const RewindReceiver = receiver<IThreadSession>("RewindReceiver")({
  *"Rewind/Timeout"(draft) {
    yield* stopTimer(draft, "Rewind/Timeout");
    yield* answerLanding(draft, true);
  },
});

function* threadTitle(draft: IThreadSession): ISelectorGenerator<string | null> {
  const replica = yield* getData(draft, "Replica");
  return (
    replica?.OpenThreads[draft.ThreadId]?.Thread?.title ??
    replica?.Shell.Threads[draft.ThreadId]?.title ??
    null
  );
}

// Follows onForkFromRun in apps/web/src/components/chat/useTimelineRewind.ts.
export function* forkFromRun(
  draft: IThreadSession,
  sourceThreadId: string,
  runId: string,
): IOpenGenerator {
  delete draft.ForkError;
  const title = yield* select(threadTitle);
  if (title === null) return;
  const targetThreadId = yield* generateGuid();
  const environmentId = draft.EnvironmentId;
  try {
    yield* open(
      withCommandId((commandId) =>
        forkThreadEffect({
          EnvironmentId: environmentId,
          CommandId: commandId,
          SourceThreadId: sourceThreadId,
          TargetThreadId: targetThreadId,
          RunId: runId,
          Title: `${title} fork`,
        }),
      ),
    );
  } catch (error) {
    draft.ForkError = serverError(error).message;
    return;
  }
  yield* publishToNearest(draft, "Thread/Forked", { ThreadId: targetThreadId });
}
leading(forkFromRun);

function* mergeBackRunId(draft: IThreadSession): ISelectorGenerator<string | null> {
  const replica = yield* getData(draft, "Replica");
  const runs = Object.values(replica?.OpenThreads[draft.ThreadId]?.Runs ?? {});
  return resolveLatestMergeBackRun({ runs } as never)?.id ?? null;
}

// Follows merge in ThreadRelationshipsPanel, apps/web/src/components/chat/ThreadRelationshipsControl.tsx.
export function* mergeBack(draft: IThreadSession, targetThreadId: string): IOpenGenerator {
  delete draft.MergeError;
  const runId = yield* select(mergeBackRunId);
  if (runId === null) return;
  const environmentId = draft.EnvironmentId;
  const sourceThreadId = draft.ThreadId;
  try {
    yield* open(
      withCommandId((commandId) =>
        mergeBackEffect({
          EnvironmentId: environmentId,
          CommandId: commandId,
          SourceThreadId: sourceThreadId,
          TargetThreadId: targetThreadId,
          RunId: runId,
        }),
      ),
    );
  } catch (error) {
    draft.MergeError = serverError(error).message;
    return;
  }
  yield* publishToNearest(draft, "Thread/MergedBack", { ThreadId: targetThreadId });
}
leading(mergeBack);

function heldDrafts(draft: IThreadSession, requestId: string): Record<string, IQuestionDraft> {
  const held = draft.QuestionAnswers[requestId];
  if (held !== undefined) return held;
  draft.QuestionAnswers[requestId] = {};
  return draft.QuestionAnswers[requestId]!;
}

const plainDraft = (answer: {
  readonly selectedOptionValues?: ReadonlyArray<string>;
  readonly customAnswer?: string;
}): IQuestionDraft => ({
  ...(answer.customAnswer === undefined ? {} : { customAnswer: answer.customAnswer }),
  ...(answer.selectedOptionValues === undefined
    ? {}
    : { selectedOptionValues: [...answer.selectedOptionValues] }),
});

export function* setQuestionCustomAnswer(
  draft: IThreadSession,
  requestId: string,
  question: IQuestion,
  text: string,
): IActionGenerator {
  if (question.allowCustomAnswer === false) return;
  const held = heldDrafts(draft, requestId);
  held[question.id] = plainDraft(
    setPendingUserInputCustomAnswer(question, held[question.id], text),
  );
}

// Follows onSelectActivePendingUserInputOption in apps/web/src/components/chat/usePendingThreadRequests.ts.
export function* toggleQuestionOption(
  draft: IThreadSession,
  requestId: string,
  questions: ReadonlyArray<IQuestion>,
  questionId: string,
  optionValue: string,
): IActionGenerator {
  const question = questions.find((entry) => entry.id === questionId);
  if (question === undefined) return;
  const current = seededDrafts(questions, draft.QuestionAnswers[requestId])[questionId];
  const prompt = carryIntoPrompt(draft.Draft, current?.customAnswer);
  if (prompt !== draft.Draft) {
    draft.Draft = prompt;
    draft.QuestionNotice =
      "Your typed text was set aside. It will be back in the composer once the question is answered.";
    yield* storeDraft(draft);
  }
  heldDrafts(draft, requestId)[questionId] = plainDraft(
    togglePendingUserInputOptionSelection(question, current, optionValue),
  );
}

const QUESTION_ADVANCE_MS = 200;

function* threadRequests(
  draft: IThreadSession,
): ISelectorGenerator<Record<string, IRuntimeRequest>> {
  const replica = yield* getData(draft, "Replica");
  return replica?.OpenThreads[draft.ThreadId]?.RuntimeRequests ?? {};
}

/** Answers on the last question, else moves to the next one once the current one is answered. */
export function* advanceQuestion(
  draft: IThreadSession,
  requestId: string,
  questions: ReadonlyArray<IQuestion>,
): IActionGenerator {
  const request = (yield* select(threadRequests))[requestId];
  if (request === undefined || !canAnswer(request)) return;
  const current = questionProgress(
    questions,
    draft.QuestionAnswers[requestId],
    draft.QuestionIndex[requestId] ?? 0,
  );
  if (current.IsLastQuestion) {
    if (current.Answers !== null)
      yield* start(
        answerRequest,
        request.$Id,
        draft.EnvironmentId,
        draft.ThreadId,
        null,
        current.Answers,
      );
    return;
  }
  if (current.CanAdvance) draft.QuestionIndex[requestId] = current.QuestionIndex + 1;
}

/** Follows stock's card: a single-select pick moves on after a beat, unless the person moved first. */
export function* chooseQuestionOption(
  draft: IThreadSession,
  requestId: string,
  questions: ReadonlyArray<IQuestion>,
  questionId: string,
  optionValue: string,
): IOpenGenerator {
  yield* toggleQuestionOption(draft, requestId, questions, questionId, optionValue);
  const question = questions.find((entry) => entry.id === questionId);
  if (question === undefined || question.multiSelect) return;
  yield* open(delay(QUESTION_ADVANCE_MS));
  const current = questionProgress(
    questions,
    draft.QuestionAnswers[requestId],
    draft.QuestionIndex[requestId] ?? 0,
  );
  if (current.Question?.id === questionId) yield* advanceQuestion(draft, requestId, questions);
}
latest(chooseQuestionOption);

export function* setQuestionIndex(
  draft: IThreadSession,
  requestId: string,
  index: number,
): IActionGenerator {
  draft.QuestionIndex[requestId] = index;
}

// Follows returnUnsentAnswersToThreadDraft in apps/web/src/questionAttachments.ts.
/**
 * Drops drafts for requests no longer pending. Stop cancels a question and a provider timeout
 * expires it; neither sent the typed answers, so they move into the thread's draft.
 */
export function* settleQuestions(
  draft: IThreadSession,
  pendingIds: ReadonlyArray<string>,
  unansweredIds: ReadonlyArray<string>,
): IActionGenerator {
  const before = draft.Draft;
  for (const [requestId, drafts] of Object.entries(draft.QuestionAnswers)) {
    if (pendingIds.includes(requestId)) continue;
    if (unansweredIds.includes(requestId)) {
      for (const answer of Object.values(drafts)) {
        draft.Draft = carryIntoPrompt(draft.Draft, answer.customAnswer);
      }
    }
    delete draft.QuestionAnswers[requestId];
  }
  for (const requestId of Object.keys(draft.QuestionIndex)) {
    if (!pendingIds.includes(requestId)) delete draft.QuestionIndex[requestId];
  }
  if (pendingIds.length === 0) delete draft.QuestionNotice;
  if (draft.Draft !== before) yield* storeDraft(draft);
}

/** `output` names the thread that ran a command row, whose output shows while it's expanded. */
export function* toggleRowExpanded(
  draft: IThreadSession,
  rowId: string,
  output?: { ThreadId: string },
): IActionGenerator {
  if (draft.ExpandedRows[rowId]) {
    delete draft.ExpandedRows[rowId];
    delete draft.CommandOutputs[rowId];
    return;
  }
  draft.ExpandedRows[rowId] = true;
  if (output === undefined) return;
  draft.CommandOutputs[rowId] = yield* entity<ICommandOutputRow>({
    ThreadId: output.ThreadId,
    ItemId: rowId,
  });
  yield* openOutput(draft, draft.CommandOutputs[rowId]!);
}

function* openOutput(draft: IThreadSession, row: ICommandOutputRow): IActionGenerator {
  yield* openResource(row, "Command/Output", {
    Type: "commandOutput",
    EnvironmentId: draft.EnvironmentId,
    ThreadId: row.ThreadId,
    ItemId: row.ItemId,
  });
}

/** Closes what only a shown thread needs; `reattachThread` opens it again. */
export function* detachThread(draft: IThreadSession): IActionGenerator {
  draft.Panels.Details.Popover = false;
  for (const row of Object.values(draft.CommandOutputs)) {
    yield* closeResource(row, "Command/Output");
  }
  yield* start(detachTerminal, draft.Terminal);
  yield* followCheckout(draft);
}

export function* reattachThread(draft: IThreadSession): IActionGenerator {
  for (const row of Object.values(draft.CommandOutputs)) {
    yield* openOutput(draft, row);
  }
  yield* start(restoreTerminal, draft.Terminal);
  yield* followCheckout(draft);
}

/** Code blocks wrap their lines until the person turns it off. */
export function* toggleCodeWrap(draft: IThreadSession, blockKey: string): IActionGenerator {
  if (draft.UnwrappedCode[blockKey]) delete draft.UnwrappedCode[blockKey];
  else draft.UnwrappedCode[blockKey] = true;
}

export function* openDiff(
  draft: IThreadSession,
  scope: IDiffScope,
  turnCount: number | null,
): IActionGenerator {
  draft.Panels.Launcher.Open = false;
  let request: IDiffRequest | null = null;
  let panel: Omit<IDiffPanel, "$Id">;
  if (scope === "branch") {
    const cwd = yield* select(searchRoot);
    panel = { Scope: scope, ToTurnCount: null, Text: null, BaseRef: null };
    if (cwd === null) panel.Error = "This thread's project isn't loaded yet.";
    else request = { Scope: scope, EnvironmentId: draft.EnvironmentId, Cwd: cwd };
  } else {
    const toTurnCount = turnCount ?? (yield* select(latestThreadDiffTurn));
    panel = { Scope: scope, ToTurnCount: toTurnCount, Text: toTurnCount === null ? "" : null };
    if (toTurnCount !== null) {
      request = {
        Scope: scope,
        EnvironmentId: draft.EnvironmentId,
        ThreadId: draft.ThreadId,
        ToTurnCount: toTurnCount,
      };
    }
  }
  draft.Panels.Diff = yield* entity<IDiffPanel>(panel);
  if (request !== null) yield* start(loadDiff, draft.Panels.Diff, request);
}

export function* closeDiff(draft: IThreadSession): IActionGenerator {
  draft.Panels.Diff = null;
}

export function* detailsOpen(draft: IThreadSession): ISelectorGenerator<boolean> {
  const selection = yield* getData(draft, "Selection");
  return selection?.Preferences.DetailsOpen ?? true;
}

const detailsShown = ({ Fits, Popover }: IDetailsPanel, open: boolean) => (Fits && open) || Popover;

function* refreshWhenShown(
  draft: IThreadSession,
  wasShown: boolean,
  open: boolean,
): IActionGenerator {
  if (!wasShown && detailsShown(draft.Panels.Details, open) && draft.Details !== null) {
    yield* start(refreshStatus, draft.Details);
  }
}

/** Pinning is this device's choice for every thread, so it goes up to the environment. */
export function* toggleDetails(draft: IThreadSession): IActionGenerator {
  const details = draft.Panels.Details;
  let open = yield* select(detailsOpen);
  const wasShown = detailsShown(details, open);
  if (details.Fits) {
    open = !open;
    yield* publishToNearest(draft, "Details/Pinned", { Open: open });
  } else details.Popover = !details.Popover;
  yield* refreshWhenShown(draft, wasShown, open);
}

export function* closeDetailsPopover(draft: IThreadSession): IActionGenerator {
  draft.Panels.Details.Popover = false;
}

export function* fitDetails(draft: IThreadSession, fits: boolean): IActionGenerator {
  const open = yield* select(detailsOpen);
  const wasShown = detailsShown(draft.Panels.Details, open);
  draft.Panels.Details.Fits = fits;
  yield* refreshWhenShown(draft, wasShown, open);
}

export function* followCheckout(draft: IThreadSession): IActionGenerator {
  const cwd = (yield* select(threadShown)) ? ((yield* select(checkout))?.Cwd ?? null) : null;
  if (cwd === (draft.Details?.Cwd ?? null)) return;
  delete draft.ScriptError;
  draft.Details =
    cwd === null
      ? null
      : yield* entity<IThreadDetails>(
          getDefaultThreadDetails(draft.EnvironmentId, draft.ThreadId, cwd),
        );
  if (draft.Details !== null) yield* start(openStatus, draft.Details);
  yield* publishToNearest(draft, "Git/StatusFollowed");
}

/** The header's right-panel toggle: closes whichever surface is open, or shows the launcher. */
export function* toggleRightPanel(draft: IThreadSession): IActionGenerator {
  if (draft.Panels.Diff !== null) {
    yield* closeDiff(draft);
    return;
  }
  draft.Panels.Launcher.Open = !draft.Panels.Launcher.Open;
}

export function* closeLauncher(draft: IThreadSession): IActionGenerator {
  draft.Panels.Launcher.Open = false;
}

export function* closeRightPanel(draft: IThreadSession): IActionGenerator {
  if (draft.Panels.Diff !== null) yield* closeDiff(draft);
  else draft.Panels.Launcher.Open = false;
}

export function* runScript(draft: IThreadSession, script: ProjectScript): IOpenGenerator {
  const held = yield* select(checkout);
  if (held === null) return;
  delete draft.ScriptError;
  const request = {
    EnvironmentId: held.EnvironmentId,
    Cwd: held.Cwd,
    ThreadId: held.ThreadId,
    TerminalId: draft.Terminal.TerminalId,
    WorktreePath: held.WorktreePath,
    ProjectRoot: held.ProjectRoot,
    Command: script.command,
  };
  try {
    yield* open(runScriptEffect(request));
  } catch (error) {
    draft.ScriptError = serverError(error).message;
    return;
  }
  yield* start(openTerminal, draft.Terminal);
}

/** Replaces the project's scripts, so an add or a removal sends the whole list. */
export function* saveScripts(draft: IThreadSession, scripts: ProjectScript[]): IOpenGenerator {
  const held = yield* select(checkout);
  if (held === null) return;
  delete draft.ScriptError;
  try {
    yield* open(
      withCommandId((commandId) =>
        projectCommandEffect({
          EnvironmentId: held.EnvironmentId,
          ProjectId: held.ProjectId,
          CommandId: commandId,
          Command: { Kind: "scripts", Scripts: scripts },
        }),
      ),
    );
  } catch (error) {
    draft.ScriptError = serverError(error).message;
  }
}
leading(saveScripts);

export function* diffLoading(draft: IThreadSession): ISelectorGenerator<boolean> {
  const panel = draft.Panels.Diff;
  return panel !== null && (yield* inFlight(loadDiff, panel));
}

export default createEntityFeature<IThreadSession>("ThreadSession")(
  {
    setDraft,
    setModelSelection,
    chooseModel,
    setRuntimeMode,
    addAttachments,
    removeAttachment,
    send,
    toggleKeepFullHistory,
    stopRun,
    queueAction,
    editFromHere,
    chooseRewind,
    forkFromRun,
    mergeBack,
    setQuestionCustomAnswer,
    toggleQuestionOption,
    chooseQuestionOption,
    advanceQuestion,
    setQuestionIndex,
    toggleRowExpanded,
    toggleCodeWrap,
    openDiff,
    closeDiff,
    toggleDetails,
    closeDetailsPopover,
    fitDetails,
    toggleRightPanel,
    closeRightPanel,
    closeLauncher,
    runScript,
    saveScripts,
  },
  {
    effectiveModel,
    effectiveModelDriver,
    effectiveModelName,
    modelSwitch,
    effectiveRuntimeMode,
    runtimeModes,
    projectId,
    projectName,
    queueWorkflow,
    followUpBehavior,
    compactionOffer,
    menuCatalog,
    promptHistory,
    fileSearchRoot,
    stopRequested,
    revertTargets,
    threadWorking,
    rewindConfirm,
    mergeBackRunId,
    diffLoading,
    checkout,
    panels,
  },
);
