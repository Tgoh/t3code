import { buildPendingUserInputAnswers } from "@t3tools/client-runtime/state/pending-user-input";
import { DEFAULT_TERMINAL_ID } from "@t3tools/contracts";
import {
  closeResource,
  generateGuid,
  getData,
  type IActionGenerator,
  type IEntity,
  type ISelectorGenerator,
  isEnded,
  openResource,
  publishScoped,
  receiver,
  resource,
  select,
} from "reflex";
import { createFeatureContext } from "reflex-solid";

import {
  closeTerminalEffect,
  type IApprovalDecision,
  type IProviderOption,
  type IWireAttachment,
  type IWireInteractionMode,
  type IWireModelSelection,
  type IWireRuntimeMode,
  queueCommandEffect,
  respondRequestEffect,
  startTurnEffect,
  stopThreadEffect,
  threadDiffEffect,
} from "./Infrastructure/commandEffects";
import type { IPickedFile } from "./Infrastructure/composerFiles";
import {
  type ITerminalLaunch,
  rememberedTerminalEffect,
  rememberTerminalEffect,
} from "./Infrastructure/terminalMemory";
import type { ITerminalStatus } from "./Infrastructure/terminalSession";
import { type IOpenThread, latestDiffTurn } from "./OpenThread";
import type { IShell } from "./Shell";

declare module "reflex" {
  interface IResourceRegistry {
    "Composer/Files": { Type: "composerFiles" };
    "Terminal/Session": { Type: "terminalSession" };
  }
  interface IDataSourceRegistry {
    Replica: IReplica;
  }
  interface IEventRegistry {
    "Thread/Started": { ThreadId: string };
  }
}

const TITLE_LENGTH = 60;
const DEFAULT_RUNTIME_MODE: IWireRuntimeMode = "full-access";

export interface IReplica extends IEntity {
  Providers: IProviderOption[];
  Shell: IShell;
  OpenThreads: Record<string, IOpenThread>;
}

export type IAttachmentDraft = Extract<IPickedFile, { Id: string }>;

export interface IDiffPanel {
  Open: boolean;
  Scope: "turn" | "thread";
  ToTurnCount: number | null;
  Loading: boolean;
  Text: string | null;
  Error?: string;
}

export interface ITerminalPanel {
  Open: boolean;
  TerminalId: string;
  Status: ITerminalStatus | null;
  FocusOnMount: boolean;
  Ending: boolean;
  Error?: string;
}

export interface IThreadSession extends IEntity {
  EnvironmentId: string;
  ThreadId: string;
  NewThreadProjectId: string | null;
  Draft: string;
  Attachments: IAttachmentDraft[];
  AttachmentError?: string;
  ModelSelection: IWireModelSelection | null;
  RuntimeMode: IWireRuntimeMode;
  Sending: boolean;
  SendError?: string;
  Stopping: boolean;
  StopError?: string;
  QuestionAnswers: Record<string, string>;
  Answering: string | null;
  AnswerError?: string;
  Panels: { Diff: IDiffPanel };
  Terminal: ITerminalPanel;
}

export function getDefaultThreadSession(
  environmentId: string,
  threadId: string,
  newThreadProjectId: string | null,
): IThreadSession {
  return {
    $Id: `session:${environmentId}:${threadId}`,
    EnvironmentId: environmentId,
    ThreadId: threadId,
    NewThreadProjectId: newThreadProjectId,
    Draft: "",
    Attachments: [],
    ModelSelection: null,
    RuntimeMode: DEFAULT_RUNTIME_MODE,
    Sending: false,
    Stopping: false,
    QuestionAnswers: {},
    Answering: null,
    Panels: {
      Diff: { Open: false, Scope: "turn", ToTurnCount: null, Loading: false, Text: null },
    },
    Terminal: {
      Open: false,
      TerminalId: DEFAULT_TERMINAL_ID,
      Status: null,
      FocusOnMount: false,
      Ending: false,
    },
  };
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function* effectiveModel(
  draft: IThreadSession,
): ISelectorGenerator<IWireModelSelection | null> {
  if (draft.ModelSelection != null) return draft.ModelSelection;
  const replica = yield* getData("Replica", draft);
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

export function* effectiveModelDisplay(
  draft: IThreadSession,
): ISelectorGenerator<ReturnType<typeof modelDisplay> | null> {
  const model = yield* effectiveModel(draft);
  if (model === null) return null;
  const replica = yield* getData("Replica", draft);
  return modelDisplay(replica?.Providers ?? [], model);
}

export function* effectiveRuntimeMode(draft: IThreadSession): ISelectorGenerator<IWireRuntimeMode> {
  const replica = yield* getData("Replica", draft);
  return replica?.OpenThreads[draft.ThreadId]?.Thread?.runtimeMode ?? draft.RuntimeMode;
}

function* interactionMode(draft: IThreadSession): ISelectorGenerator<IWireInteractionMode> {
  const replica = yield* getData("Replica", draft);
  return replica?.OpenThreads[draft.ThreadId]?.Thread?.interactionMode ?? "default";
}

export function* projectName(draft: IThreadSession): ISelectorGenerator<string | null> {
  const replica = yield* getData("Replica", draft);
  const projectId =
    draft.NewThreadProjectId ?? replica?.OpenThreads[draft.ThreadId]?.Thread?.projectId;
  if (projectId == null) return null;
  return replica?.Shell.Projects[projectId]?.title ?? null;
}

export function* stopRequested(draft: IThreadSession): ISelectorGenerator<boolean> {
  const replica = yield* getData("Replica", draft);
  return replica?.Shell.Threads[draft.ThreadId]?.latestRunStopRequested === true;
}

function* latestThreadDiffTurn(draft: IThreadSession): ISelectorGenerator<number | null> {
  const replica = yield* getData("Replica", draft);
  const thread = replica?.OpenThreads[draft.ThreadId];
  return thread === undefined ? null : latestDiffTurn(thread);
}

function* terminalLaunch(draft: IThreadSession): ISelectorGenerator<ITerminalLaunch | null> {
  const replica = yield* getData("Replica", draft);
  const thread = replica?.OpenThreads[draft.ThreadId]?.Thread;
  if (replica === undefined || thread == null) return null;
  const root = replica.Shell.Projects[thread.projectId]?.workspaceRoot;
  if (root === undefined) return null;
  return { Cwd: thread.worktreePath ?? root, WorktreePath: thread.worktreePath, ProjectRoot: root };
}

function* isThreadOpen(draft: IThreadSession): ISelectorGenerator<boolean> {
  const replica = yield* getData("Replica", draft);
  return replica?.OpenThreads[draft.ThreadId] !== undefined;
}

export function* setDraft(draft: IThreadSession, text: string): IActionGenerator {
  draft.Draft = text;
}

export function* setModelSelection(
  draft: IThreadSession,
  selection: IWireModelSelection,
): IActionGenerator {
  draft.ModelSelection = selection;
}

export function* setRuntimeMode(draft: IThreadSession, mode: IWireRuntimeMode): IActionGenerator {
  draft.RuntimeMode = mode;
}

export function* addAttachments(draft: IThreadSession, picked: IPickedFile[]): IActionGenerator {
  delete draft.AttachmentError;
  for (const file of picked) {
    if (file.Id === null) draft.AttachmentError = `${file.Name}: ${file.Error}`;
    else draft.Attachments.push(file);
  }
}

export function* removeAttachment(draft: IThreadSession, id: string): IActionGenerator {
  const index = draft.Attachments.findIndex((held) => held.Id === id);
  if (index >= 0) draft.Attachments.splice(index, 1);
  yield* resource(draft, "Composer/Files").remove(id);
}

export function* send(draft: IThreadSession): IActionGenerator {
  if (draft.Sending) return;
  const text = draft.Draft.trim();
  const fileIds = draft.Attachments.map((file) => file.Id);
  if (text === "" && fileIds.length === 0) return;
  const projectId = draft.NewThreadProjectId;
  const model = yield* select(effectiveModel);
  const runtimeMode = yield* select(effectiveRuntimeMode);
  const interaction = yield* select(interactionMode);
  const overridden = draft.ModelSelection !== null;
  draft.Sending = true;
  delete draft.SendError;
  let failure: string | null = null;
  try {
    if (projectId !== null && model === null) throw new Error("No provider is available.");
    const attachments: IWireAttachment[] = [];
    for (const id of fileIds) {
      const uploaded = yield* resource(draft, "Composer/Files").upload(id);
      if (uploaded === undefined) throw new Error("An image couldn't be uploaded.");
      attachments.push(uploaded);
    }
    const commandId = yield* generateGuid();
    const messageId = yield* generateGuid();
    yield* startTurnEffect({
      EnvironmentId: draft.EnvironmentId,
      ThreadId: draft.ThreadId,
      CommandId: commandId,
      MessageId: messageId,
      Text: text,
      Attachments: attachments,
      ModelSelection: projectId !== null || overridden ? model : null,
      RuntimeMode: runtimeMode,
      InteractionMode: interaction,
      NewThread:
        projectId === null
          ? null
          : { ProjectId: projectId, Title: text.slice(0, TITLE_LENGTH) || "New thread" },
    });
  } catch (error) {
    failure = errorText(error);
  }
  draft.Sending = false;
  if (failure !== null) {
    draft.SendError = failure;
    return;
  }
  if (draft.Draft.trim() === text) draft.Draft = "";
  draft.Attachments = draft.Attachments.filter((file) => !fileIds.includes(file.Id));
  if (fileIds.length > 0) yield* resource(draft, "Composer/Files").forget(fileIds);
  if (projectId !== null) {
    draft.NewThreadProjectId = null;
    yield* publishScoped(draft, "Thread/Started", { ThreadId: draft.ThreadId });
  }
}

export function* stopRun(draft: IThreadSession): IActionGenerator {
  if (draft.Stopping) return;
  draft.Stopping = true;
  delete draft.StopError;
  try {
    const commandId = yield* generateGuid();
    yield* stopThreadEffect({
      EnvironmentId: draft.EnvironmentId,
      ThreadId: draft.ThreadId,
      CommandId: commandId,
    });
  } catch (error) {
    draft.StopError = errorText(error);
  }
  draft.Stopping = false;
}

export function* queueAction(draft: IThreadSession, runId: string | null): IActionGenerator {
  delete draft.StopError;
  try {
    const commandId = yield* generateGuid();
    yield* queueCommandEffect({
      EnvironmentId: draft.EnvironmentId,
      ThreadId: draft.ThreadId,
      CommandId: commandId,
      RunId: runId,
    });
  } catch (error) {
    draft.StopError = errorText(error);
  }
}

export function* setQuestionAnswer(
  draft: IThreadSession,
  questionId: string,
  text: string,
): IActionGenerator {
  draft.QuestionAnswers[questionId] = text;
}

interface IAskedQuestion {
  id: string;
  options: ReadonlyArray<{ label: string }>;
  multiSelect?: boolean | undefined;
}

export function questionAnswers(draft: IThreadSession, questions: ReadonlyArray<IAskedQuestion>) {
  const drafts = Object.fromEntries(
    questions.map((question) => {
      const text = draft.QuestionAnswers[question.id] ?? "";
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

export function* answerRequest(
  draft: IThreadSession,
  requestId: string,
  decision: IApprovalDecision | null,
  answers: Record<string, string | ReadonlyArray<string>> | null,
): IActionGenerator {
  if (draft.Answering !== null) return;
  draft.Answering = requestId;
  delete draft.AnswerError;
  try {
    const commandId = yield* generateGuid();
    yield* respondRequestEffect({
      EnvironmentId: draft.EnvironmentId,
      ThreadId: draft.ThreadId,
      CommandId: commandId,
      RequestId: requestId,
      Decision: decision,
      Answers: answers,
    });
    draft.QuestionAnswers = {};
  } catch (error) {
    draft.AnswerError = errorText(error);
  }
  draft.Answering = null;
}

export function* openDiff(
  draft: IThreadSession,
  scope: "turn" | "thread",
  turnCount: number | null,
): IActionGenerator {
  const panel = draft.Panels.Diff;
  const toTurnCount = turnCount ?? (yield* select(latestThreadDiffTurn));
  panel.Open = true;
  panel.Scope = scope;
  panel.ToTurnCount = toTurnCount;
  panel.Text = null;
  delete panel.Error;
  if (toTurnCount === null) {
    panel.Loading = false;
    panel.Text = "";
    return;
  }
  panel.Loading = true;
  let text: string | null = null;
  let failure: string | null = null;
  try {
    text = yield* threadDiffEffect({
      EnvironmentId: draft.EnvironmentId,
      ThreadId: draft.ThreadId,
      Scope: scope,
      ToTurnCount: toTurnCount,
    });
  } catch (error) {
    failure = errorText(error);
  }
  if (!panel.Open || panel.Scope !== scope || panel.ToTurnCount !== toTurnCount) return;
  panel.Loading = false;
  panel.Text = text;
  if (failure !== null) panel.Error = failure;
}

export function* closeDiff(draft: IThreadSession): IActionGenerator {
  const panel = draft.Panels.Diff;
  panel.Open = false;
  panel.Loading = false;
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
  if (launch === null || !(yield* select(isThreadOpen))) return;
  draft.Terminal.Open = true;
  draft.Terminal.FocusOnMount = false;
  yield* attachTerminal(draft, launch);
}

export function* openTerminal(draft: IThreadSession): IActionGenerator {
  const panel = draft.Terminal;
  panel.Open = true;
  panel.Status = null;
  panel.FocusOnMount = true;
  delete panel.Error;
  const launch = yield* select(terminalLaunch);
  if (launch === null) {
    panel.Error = "This thread's project isn't loaded yet.";
    return;
  }
  yield* attachTerminal(draft, launch);
  yield* rememberTerminalEffect({ ThreadId: draft.ThreadId, Launch: launch });
}

export function* closeTerminal(draft: IThreadSession): IActionGenerator {
  const panel = draft.Terminal;
  panel.Open = false;
  panel.Status = null;
  delete panel.Error;
  yield* closeResource(draft, "Terminal/Session");
  yield* rememberTerminalEffect({ ThreadId: draft.ThreadId, Launch: null });
}

export function* endTerminal(draft: IThreadSession): IActionGenerator {
  const panel = draft.Terminal;
  if (panel.Ending) return;
  panel.Ending = true;
  delete panel.Error;
  let failure: string | null = null;
  try {
    yield* closeTerminalEffect({
      EnvironmentId: draft.EnvironmentId,
      ThreadId: draft.ThreadId,
      TerminalId: panel.TerminalId,
    });
  } catch (error) {
    failure = errorText(error);
  }
  panel.Ending = false;
  if (failure !== null) {
    panel.Error = failure;
    return;
  }
  yield* closeTerminal(draft);
}

export const TerminalReceiver = receiver<IThreadSession>("TerminalReceiver")({
  *"Terminal/Session"(draft, message) {
    if (isEnded(message)) {
      draft.Terminal.Status = "error";
      draft.Terminal.Error = message.$Ended.Reason ?? "The terminal stopped.";
      return;
    }
    draft.Terminal.Status = message.Status;
    if (message.Error === null) delete draft.Terminal.Error;
    else draft.Terminal.Error = message.Error;
  },
});

export default createFeatureContext<IThreadSession>(import.meta.url)(
  {
    setDraft,
    setModelSelection,
    setRuntimeMode,
    addAttachments,
    removeAttachment,
    send,
    stopRun,
    queueAction,
    setQuestionAnswer,
    answerRequest,
    openDiff,
    closeDiff,
    openTerminal,
    closeTerminal,
    endTerminal,
  },
  { effectiveModel, effectiveModelDisplay, effectiveRuntimeMode, projectName, stopRequested },
);
