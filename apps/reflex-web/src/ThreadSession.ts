import {
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
} from "@t3tools/client-runtime/state/pending-user-input";
import {
  deriveThreadQueueWorkflowState,
  threadSupportsProviderHandoff,
} from "@t3tools/client-runtime/state/thread-workflows";
import { DEFAULT_TERMINAL_ID } from "@t3tools/contracts";
import {
  closeResource,
  generateGuid,
  getData,
  type IActionGenerator,
  type IEntity,
  type IOpenGenerator,
  type IResourceHandle,
  type ISelectorGenerator,
  inFlight,
  isEnded,
  latest,
  leading,
  open,
  openResource,
  publishToNearest,
  receiver,
  resource,
  select,
  start,
  transient,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import {
  closeTerminalEffect,
  type IDispatchMode,
  type IModelFavorite,
  type IProviderOption,
  type IQueueOperation,
  type IStartTurn,
  type IWireAttachment,
  type IWireInteractionMode,
  type IWireModelSelection,
  type IWireRuntimeMode,
  queueCommandEffect,
  searchEntriesEffect,
  startTurnEffect,
  stopThreadEffect,
  threadCommandEffect,
  threadDiffEffect,
  withCommandId,
} from "./Infrastructure/commandEffects";
import type { IGitWork } from "./GitWork";
import type { IPickedFile } from "./Infrastructure/composerFiles";
import { branchDiffEffect, type IBranchDiff } from "./Infrastructure/sourceControlEffects";
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
import {
  type ITerminalLaunch,
  rememberedTerminalEffect,
  rememberTerminalEffect,
} from "./Infrastructure/terminalMemory";
import type { ITerminalStatus } from "./Infrastructure/terminalSession";
import {
  compatibleRuntimeMode,
  dispatchSelection,
  modelChangeBlock,
  pickedSelection,
  providerOf,
} from "./modelOptions";
import { FILE_SEARCH_LIMIT, type IProjectEntry } from "./composerMenu";
import { type IOpenThread, latestDiffTurn } from "./OpenThread";
import { type IPromptHistoryEntry, promptHistoryEntries } from "./promptHistory";
import { carryIntoPrompt, type IQuestion, type IQuestionDraft, seededDrafts } from "./questions";
import type {
  IWireArchivedShell,
  IWireServerConfig,
  IWireUsageSummary,
} from "./Infrastructure/settings";
import type { IShell } from "./Shell";

declare module "treflex" {
  interface IResourceRegistry {
    "Composer/Files": { Type: "composerFiles" };
    "Terminal/Session": { Type: "terminalSession" };
  }
  interface IDataSourceRegistry {
    Replica: IReplica;
    Selection: ISelection;
  }
  interface IMessageRegistry {
    "Thread/Started": { ThreadId: string };
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
  Archived: IWireArchivedShell | null;
  Usage: { Key: string; Summary: IWireUsageSummary } | null;
}

export interface ISelection extends IEntity {
  SelectedThreadId: string | null;
}

export type IAttachmentDraft = IPickedFile;

export interface IDiffPanel {
  Open: boolean;
  Scope: "turn" | "thread" | "branch";
  ToTurnCount: number | null;
  Text: string | null;
  BaseRef?: string | null;
  Error?: string;
}

export interface ITerminalPanel {
  Open: boolean;
  TerminalId: string;
  Error?: string;
}

const attachment = (draft: IThreadSession) =>
  transient(draft, "Terminal/Attachment", {
    Status: null as ITerminalStatus | null,
    FocusOnMount: false,
  });

const fileSearch = (draft: IThreadSession) =>
  transient(draft, "Composer/FileSearch", {
    Query: null as string | null,
    Entries: [] as IProjectEntry[],
  });

const expandedRows = (owner: IThreadSession) =>
  transient(owner, "Timeline/Expanded", { Rows: {} as Record<string, true> });

const unwrappedCode = (owner: IThreadSession) =>
  transient(owner, "Timeline/Unwrapped", { Blocks: {} as Record<string, true> });

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
  ModelError?: string;
  SendError?: string;
  StopError?: string;
  QueueError?: string;
  QuestionAnswers: Record<string, Record<string, IQuestionDraft>>;
  QuestionIndex: Record<string, number>;
  QuestionNotice?: string;
  Panels: { Diff: IDiffPanel; Details: { Open: boolean }; Launcher: { Open: boolean } };
  Terminal: ITerminalPanel;
  Git: IGitWork;
}

export function getDefaultThreadSession(
  environmentId: string,
  threadId: string,
  newThreadProjectId: string | null,
): Omit<IThreadSession, "$Id" | "Git"> {
  return {
    EnvironmentId: environmentId,
    ThreadId: threadId,
    NewThreadProjectId: newThreadProjectId,
    Draft: "",
    Attachments: [],
    ModelSelection: null,
    RuntimeMode: null,
    QuestionAnswers: {},
    QuestionIndex: {},
    Panels: {
      Diff: { Open: false, Scope: "turn", ToTurnCount: null, Text: null },
      // Follows DEFAULT_THREAD_PANEL_VISIBILITY in apps/web/src/rightPanelStore.ts.
      Details: { Open: true },
      Launcher: { Open: false },
    },
    Terminal: { Open: false, TerminalId: DEFAULT_TERMINAL_ID },
  };
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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
  ActiveRunId: string | null;
}

export function* queueWorkflow(draft: IThreadSession): ISelectorGenerator<IQueueWorkflow> {
  const replica = yield* getData(draft, "Replica");
  const open = replica?.OpenThreads[draft.ThreadId];
  if (open?.Thread == null) return { CanSendNow: false, CanSteer: false, ActiveRunId: null };
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
    ActiveRunId: state.activeRun?.id ?? null,
  };
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

export function* projectId(draft: IThreadSession): ISelectorGenerator<string | null> {
  if (draft.NewThreadProjectId !== null) return draft.NewThreadProjectId;
  const replica = yield* getData(draft, "Replica");
  return replica?.OpenThreads[draft.ThreadId]?.Thread?.projectId ?? null;
}

export function* projectName(draft: IThreadSession): ISelectorGenerator<string | null> {
  const replica = yield* getData(draft, "Replica");
  const projectId =
    draft.NewThreadProjectId ?? replica?.OpenThreads[draft.ThreadId]?.Thread?.projectId;
  if (projectId == null) return null;
  return replica?.Shell.Projects[projectId]?.title ?? null;
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

function* terminalLaunch(draft: IThreadSession): ISelectorGenerator<ITerminalLaunch | null> {
  const replica = yield* getData(draft, "Replica");
  const thread = replica?.OpenThreads[draft.ThreadId]?.Thread;
  if (replica === undefined || thread == null) return null;
  const root = replica.Shell.Projects[thread.projectId]?.workspaceRoot;
  if (root === undefined) return null;
  return { Cwd: thread.worktreePath ?? root, WorktreePath: thread.worktreePath, ProjectRoot: root };
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
  const replica = yield* getData(draft, "Replica");
  if (replica === undefined) return null;
  const thread = replica.OpenThreads[draft.ThreadId]?.Thread;
  const projectId = draft.NewThreadProjectId ?? thread?.projectId;
  const root = projectId == null ? undefined : replica.Shell.Projects[projectId]?.workspaceRoot;
  return thread?.worktreePath ?? root ?? null;
}

export function* promptHistory(draft: IThreadSession): ISelectorGenerator<IPromptHistoryEntry[]> {
  const replica = yield* getData(draft, "Replica");
  const thread = replica?.OpenThreads[draft.ThreadId];
  return thread === undefined ? [] : promptHistoryEntries(Object.values(thread.Messages));
}

/** Files matching an `@` query, from the thread's worktree or project root. */
export function* searchFiles(draft: IThreadSession, query: string): IOpenGenerator {
  const root = yield* select(searchRoot);
  const search = yield* fileSearch(draft);
  if (root === null) {
    search.Query = query;
    search.Entries = [];
    return;
  }
  const request = {
    EnvironmentId: draft.EnvironmentId,
    Cwd: root,
    Query: query,
    Limit: FILE_SEARCH_LIMIT,
  };
  let entries: IProjectEntry[] = [];
  try {
    entries = (yield* open(searchEntriesEffect(request))).Entries;
  } catch {
    entries = [];
  }
  const held = yield* fileSearch(draft);
  held.Query = query;
  held.Entries = entries;
}
latest(searchFiles);

export function* fileSearchResult(draft: IThreadSession) {
  return yield* fileSearch(draft);
}

function* isThreadSelected(draft: IThreadSession): ISelectorGenerator<boolean> {
  const selection = yield* getData(draft, "Selection");
  return selection?.SelectedThreadId === draft.ThreadId;
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
    draft.ModelError = `This model pick was not saved. ${errorText(error)}`;
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
): IActionGenerator {
  const attachments: IWireAttachment[] = [];
  for (const id of fileIds) {
    const uploaded = yield* files.upload(id);
    if (uploaded === undefined) throw new Error("An attachment couldn't be uploaded.");
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
  const commandId = yield* generateGuid();
  const messageId = yield* generateGuid();
  yield* startTurnEffect({
    ...turn,
    CommandId: commandId,
    MessageId: messageId,
    Attachments: attachments,
  });
}

/** `auto` lets the server choose; during a run the composer asks for `steer` or `queue`. */
export function* send(draft: IThreadSession, mode: IDispatchMode = "auto"): IOpenGenerator {
  const text = draft.Draft.trim();
  const fileIds = draft.Attachments.map((file) => file.Id);
  if (text === "" && fileIds.length === 0) return;
  const projectId = draft.NewThreadProjectId;
  const model = yield* select(effectiveModel);
  const provider = yield* select(effectiveProvider);
  const runtimeMode = yield* select(effectiveRuntimeMode);
  const threadMode = yield* select(threadRuntimeMode);
  const interaction = yield* select(interactionMode);
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
    if (projectId !== null && model === null) throw new Error("No provider is available.");
    const setsMode = projectId === null && threadMode !== null && threadMode !== runtimeMode;
    yield* open(uploadAndStart(files, fileIds, turn, setsMode));
  } catch (error) {
    draft.SendError = errorText(error);
    return;
  }
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
    draft.StopError = errorText(error);
  }
}
leading(stopRun);

export type IQueuePress =
  | Exclude<IQueueOperation, { Kind: "start" | "steer" }>
  | { Kind: "sendNow"; RunId: string };

// Follows sendQueuedMessage in apps/web/src/components/chat/QueuedRunsControl.tsx.
export function* queueAction(draft: IThreadSession, press: IQueuePress): IOpenGenerator {
  delete draft.QueueError;
  let operation: IQueueOperation;
  if (press.Kind !== "sendNow") operation = press;
  else {
    const workflow = yield* select(queueWorkflow);
    if (workflow.CanSendNow) operation = { Kind: "start", RunId: press.RunId };
    else if (workflow.ActiveRunId !== null && workflow.CanSteer) {
      operation = { Kind: "steer", RunId: press.RunId, TargetRunId: workflow.ActiveRunId };
    } else return;
  }
  const environmentId = draft.EnvironmentId;
  const threadId = draft.ThreadId;
  try {
    yield* open(
      withCommandId((commandId) =>
        queueCommandEffect({
          EnvironmentId: environmentId,
          ThreadId: threadId,
          CommandId: commandId,
          Operation: operation,
        }),
      ),
    );
  } catch (error) {
    draft.QueueError = errorText(error);
  }
}
leading(queueAction);

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

export function* toggleRowExpanded(draft: IThreadSession, rowId: string): IActionGenerator {
  const expanded = yield* expandedRows(draft);
  if (expanded.Rows[rowId]) delete expanded.Rows[rowId];
  else expanded.Rows[rowId] = true;
}

/** Code blocks wrap their lines until the person turns it off. */
export function* toggleCodeWrap(draft: IThreadSession, blockKey: string): IActionGenerator {
  const unwrapped = yield* unwrappedCode(draft);
  if (unwrapped.Blocks[blockKey]) delete unwrapped.Blocks[blockKey];
  else unwrapped.Blocks[blockKey] = true;
}

export function* openDiff(
  draft: IThreadSession,
  scope: "turn" | "thread" | "branch",
  turnCount: number | null,
): IOpenGenerator {
  draft.Panels.Launcher.Open = false;
  if (scope === "branch") {
    yield* openBranchDiff(draft);
    return;
  }
  const toTurnCount = turnCount ?? (yield* select(latestThreadDiffTurn));
  const panel = draft.Panels.Diff;
  panel.Open = true;
  panel.Scope = scope;
  panel.ToTurnCount = toTurnCount;
  panel.Text = null;
  delete panel.BaseRef;
  delete panel.Error;
  if (toTurnCount === null) {
    panel.Text = "";
    return;
  }
  const request = {
    EnvironmentId: draft.EnvironmentId,
    ThreadId: draft.ThreadId,
    Scope: scope,
    ToTurnCount: toTurnCount,
  };
  let text: string | null = null;
  let failure: string | null = null;
  try {
    text = yield* open(threadDiffEffect(request));
  } catch (error) {
    failure = errorText(error);
  }
  const current = draft.Panels.Diff;
  if (!current.Open) return;
  current.Text = text;
  if (failure !== null) current.Error = failure;
}
latest(openDiff);

function* openBranchDiff(draft: IThreadSession): IOpenGenerator {
  const cwd = yield* select(searchRoot);
  const panel = draft.Panels.Diff;
  panel.Open = true;
  panel.Scope = "branch";
  panel.ToTurnCount = null;
  panel.Text = null;
  panel.BaseRef = null;
  delete panel.Error;
  if (cwd === null) {
    panel.Error = "This thread's project isn't loaded yet.";
    return;
  }
  let diff: IBranchDiff | null = null;
  let failure: string | null = null;
  try {
    diff = yield* open(branchDiffEffect({ EnvironmentId: draft.EnvironmentId, Cwd: cwd }));
  } catch (error) {
    failure = errorText(error);
  }
  const current = draft.Panels.Diff;
  if (!current.Open || current.Scope !== "branch") return;
  if (diff !== null) {
    current.Text = diff.Diff;
    current.BaseRef = diff.BaseRef;
  }
  if (failure !== null) current.Error = failure;
}

export function* closeDiff(draft: IThreadSession): IActionGenerator {
  const panel = draft.Panels.Diff;
  panel.Open = false;
  panel.Text = null;
  delete panel.BaseRef;
  delete panel.Error;
}

export function* toggleDetails(draft: IThreadSession): IActionGenerator {
  draft.Panels.Details.Open = !draft.Panels.Details.Open;
}

/** The header's right-panel toggle: closes whichever surface is open, or shows the launcher. */
export function* toggleRightPanel(draft: IThreadSession): IActionGenerator {
  if (draft.Panels.Diff.Open) {
    yield* closeDiff(draft);
    return;
  }
  draft.Panels.Launcher.Open = !draft.Panels.Launcher.Open;
}

export function* closeLauncher(draft: IThreadSession): IActionGenerator {
  draft.Panels.Launcher.Open = false;
}

function* attachTerminal(draft: IThreadSession, launch: ITerminalLaunch): IActionGenerator {
  yield* openResource(draft, "Terminal/Session", TerminalReceiver, {
    Type: "terminalSession",
    EnvironmentId: draft.EnvironmentId,
    ThreadId: draft.ThreadId,
    TerminalId: draft.Terminal.TerminalId,
    Cwd: launch.Cwd,
    WorktreePath: launch.WorktreePath,
    ProjectRoot: launch.ProjectRoot,
  });
}

export function* restoreTerminal(draft: IThreadSession): IActionGenerator {
  const launch = yield* rememberedTerminalEffect({ ThreadId: draft.ThreadId });
  if (launch === null || !(yield* select(isThreadSelected))) return;
  draft.Terminal.Open = true;
  (yield* attachment(draft)).FocusOnMount = false;
  yield* attachTerminal(draft, launch);
}

export function* openTerminal(draft: IThreadSession): IActionGenerator {
  const panel = draft.Terminal;
  panel.Open = true;
  delete panel.Error;
  const attached = yield* attachment(draft);
  attached.Status = null;
  attached.FocusOnMount = true;
  const launch = yield* select(terminalLaunch);
  if (launch === null) {
    panel.Error = "This thread's project isn't loaded yet.";
    return;
  }
  yield* attachTerminal(draft, launch);
  yield* rememberTerminalEffect({ ThreadId: draft.ThreadId, Launch: launch });
}

export function* detachTerminal(draft: IThreadSession): IActionGenerator {
  (yield* attachment(draft)).Status = null;
  yield* closeResource(draft, "Terminal/Session");
}

export function* closeTerminal(draft: IThreadSession): IActionGenerator {
  draft.Terminal.Open = false;
  delete draft.Terminal.Error;
  yield* detachTerminal(draft);
  yield* rememberTerminalEffect({ ThreadId: draft.ThreadId, Launch: null });
}

export function* endTerminal(draft: IThreadSession): IOpenGenerator {
  delete draft.Terminal.Error;
  const request = {
    EnvironmentId: draft.EnvironmentId,
    ThreadId: draft.ThreadId,
    TerminalId: draft.Terminal.TerminalId,
  };
  try {
    yield* open(closeTerminalEffect(request));
  } catch (error) {
    draft.Terminal.Error = errorText(error);
    return;
  }
  yield* closeTerminal(draft);
}
leading(endTerminal);

export function* sending(draft: IThreadSession): ISelectorGenerator<boolean> {
  return yield* inFlight(send, draft);
}

export function* stopping(draft: IThreadSession): ISelectorGenerator<boolean> {
  return yield* inFlight(stopRun, draft);
}

export function* queueing(draft: IThreadSession): ISelectorGenerator<boolean> {
  return yield* inFlight(queueAction, draft);
}

export function* ending(draft: IThreadSession): ISelectorGenerator<boolean> {
  return yield* inFlight(endTerminal, draft);
}

export function* diffLoading(draft: IThreadSession): ISelectorGenerator<boolean> {
  return draft.Panels.Diff.Open && (yield* inFlight(openDiff, draft));
}

export function* terminalAttachment(draft: IThreadSession) {
  return yield* attachment(draft);
}

export function* expandedTimelineRows(draft: IThreadSession) {
  return (yield* expandedRows(draft)).Rows;
}

export function* unwrappedCodeBlocks(draft: IThreadSession) {
  return (yield* unwrappedCode(draft)).Blocks;
}

export const TerminalReceiver = receiver<IThreadSession>("TerminalReceiver")({
  *"Terminal/Session"(draft, message) {
    if (isEnded(message)) return;
    (yield* attachment(draft)).Status = message.Status;
    if (message.Error === null) delete draft.Terminal.Error;
    else draft.Terminal.Error = message.Error;
  },
});

export default createEntityFeature<IThreadSession>(import.meta.url)(
  {
    setDraft,
    setModelSelection,
    chooseModel,
    setRuntimeMode,
    searchFiles,
    addAttachments,
    removeAttachment,
    send,
    stopRun,
    queueAction,
    setQuestionCustomAnswer,
    toggleQuestionOption,
    setQuestionIndex,
    toggleRowExpanded,
    toggleCodeWrap,
    openDiff,
    closeDiff,
    toggleDetails,
    toggleRightPanel,
    closeLauncher,
    openTerminal,
    closeTerminal,
    endTerminal,
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
    menuCatalog,
    promptHistory,
    fileSearchResult,
    stopRequested,
    sending,
    stopping,
    queueing,
    ending,
    diffLoading,
    terminalAttachment,
    expandedTimelineRows,
    unwrappedCodeBlocks,
  },
);
