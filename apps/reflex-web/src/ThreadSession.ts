import { buildPendingUserInputAnswers } from "@t3tools/client-runtime/state/pending-user-input";
import { threadSupportsProviderHandoff } from "@t3tools/client-runtime/state/thread-workflows";
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
  transient,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import {
  closeTerminalEffect,
  type IModelFavorite,
  type IProviderOption,
  type IStartTurn,
  type IWireAttachment,
  type IWireInteractionMode,
  type IWireModelSelection,
  type IWireRuntimeMode,
  queueCommandEffect,
  startTurnEffect,
  stopThreadEffect,
  threadCommandEffect,
  threadDiffEffect,
  withCommandId,
} from "./Infrastructure/commandEffects";
import type { IPickedFile } from "./Infrastructure/composerFiles";
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
import { type IOpenThread, latestDiffTurn } from "./OpenThread";
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
}

export interface ISelection extends IEntity {
  SelectedThreadId: string | null;
}

export type IAttachmentDraft = IPickedFile;

export interface IDiffPanel {
  Open: boolean;
  Scope: "turn" | "thread";
  ToTurnCount: number | null;
  Text: string | null;
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

const expandedRows = (owner: IThreadSession) =>
  transient(owner, "Timeline/Expanded", { Rows: {} as Record<string, true> });

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
  QuestionAnswers: Record<string, Record<string, string>>;
  Panels: { Diff: IDiffPanel };
  Terminal: ITerminalPanel;
}

export function getDefaultThreadSession(
  environmentId: string,
  threadId: string,
  newThreadProjectId: string | null,
): Omit<IThreadSession, "$Id"> {
  return {
    EnvironmentId: environmentId,
    ThreadId: threadId,
    NewThreadProjectId: newThreadProjectId,
    Draft: "",
    Attachments: [],
    ModelSelection: null,
    RuntimeMode: null,
    QuestionAnswers: {},
    Panels: {
      Diff: { Open: false, Scope: "turn", ToTurnCount: null, Text: null },
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

function* isThreadSelected(draft: IThreadSession): ISelectorGenerator<boolean> {
  const selection = yield* getData(draft, "Selection");
  return selection?.SelectedThreadId === draft.ThreadId;
}

export function* setDraft(draft: IThreadSession, text: string): IActionGenerator {
  draft.Draft = text;
}

/** Holds the pick for the next turn, and on a started thread's own provider saves it at once. */
export function* setModelSelection(
  draft: IThreadSession,
  selection: IWireModelSelection,
): IOpenGenerator {
  draft.ModelSelection = selection;
  delete draft.ModelError;
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
}

export function* removeAttachment(draft: IThreadSession, id: string): IActionGenerator {
  const index = draft.Attachments.findIndex((held) => held.Id === id);
  if (index >= 0) draft.Attachments.splice(index, 1);
  yield* resource(draft, "Composer/Files").remove(id);
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

export function* send(draft: IThreadSession): IOpenGenerator {
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
  if (fileIds.length > 0) yield* resource(draft, "Composer/Files").forget(fileIds);
  if (projectId !== null) {
    draft.NewThreadProjectId = null;
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

export function* queueAction(draft: IThreadSession, runId: string | null): IOpenGenerator {
  delete draft.StopError;
  const environmentId = draft.EnvironmentId;
  const threadId = draft.ThreadId;
  try {
    yield* open(
      withCommandId((commandId) =>
        queueCommandEffect({
          EnvironmentId: environmentId,
          ThreadId: threadId,
          CommandId: commandId,
          RunId: runId,
        }),
      ),
    );
  } catch (error) {
    draft.StopError = errorText(error);
  }
}
leading(queueAction);

export function* setQuestionAnswer(
  draft: IThreadSession,
  requestId: string,
  questionId: string,
  text: string,
): IActionGenerator {
  const held = draft.QuestionAnswers[requestId];
  if (held === undefined) draft.QuestionAnswers[requestId] = { [questionId]: text };
  else held[questionId] = text;
}

export function* toggleRowExpanded(draft: IThreadSession, rowId: string): IActionGenerator {
  const expanded = yield* expandedRows(draft);
  if (expanded.Rows[rowId]) delete expanded.Rows[rowId];
  else expanded.Rows[rowId] = true;
}

interface IAskedQuestion {
  id: string;
  options: ReadonlyArray<{ label: string }>;
  multiSelect?: boolean | undefined;
}

export function questionAnswers(
  draft: IThreadSession,
  requestId: string,
  questions: ReadonlyArray<IAskedQuestion>,
) {
  const typed = draft.QuestionAnswers[requestId] ?? {};
  const drafts = Object.fromEntries(
    questions.map((question) => {
      const text = typed[question.id] ?? "";
      const parts = text.split(",").map((part) => part.trim());
      const isOption = (part: string) => question.options.some(({ label }) => label === part);
      return [
        question.id,
        question.multiSelect && parts.every(isOption)
          ? { selectedOptionValues: parts }
          : { customAnswer: text, selectedOptionValues: [text] },
      ];
    }),
  );
  return buildPendingUserInputAnswers(questions, drafts);
}

export function* openDiff(
  draft: IThreadSession,
  scope: "turn" | "thread",
  turnCount: number | null,
): IOpenGenerator {
  const toTurnCount = turnCount ?? (yield* select(latestThreadDiffTurn));
  const panel = draft.Panels.Diff;
  panel.Open = true;
  panel.Scope = scope;
  panel.ToTurnCount = toTurnCount;
  panel.Text = null;
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

export function* closeDiff(draft: IThreadSession): IActionGenerator {
  const panel = draft.Panels.Diff;
  panel.Open = false;
  panel.Text = null;
  delete panel.Error;
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
    addAttachments,
    removeAttachment,
    send,
    stopRun,
    queueAction,
    setQuestionAnswer,
    toggleRowExpanded,
    openDiff,
    closeDiff,
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
    stopRequested,
    sending,
    stopping,
    queueing,
    ending,
    diffLoading,
    terminalAttachment,
    expandedTimelineRows,
  },
);
