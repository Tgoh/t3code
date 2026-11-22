import type {
  AssetResource,
  ModelCapabilities,
  PeerLinkRequestAnswerInput,
  ProjectScript,
  SecretRequestAnswerInput,
  ServerProviderSkill,
  ServerProviderSlashCommand,
} from "@t3tools/contracts";
import type { EnvironmentThreadSearchMatch } from "@t3tools/client-runtime/state/thread-search";
import { defineEffect, generateGuid, type IActionGenerator, type IEffect } from "treflex";

import type { IWireProjection, IWireTurnItem } from "./wire";

export type IWireAttachment = Extract<
  IWireTurnItem,
  { type: "user_message" }
>["attachments"][number];
export type IWireModelSelection = IWireProjection["thread"]["modelSelection"];
export type IWireRuntimeMode = IWireProjection["thread"]["runtimeMode"];
export type IWireInteractionMode = IWireProjection["thread"]["interactionMode"];
export type IApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "acceptAlways"
  | "decline"
  | "cancel";

export type IDispatchMode = "auto" | "queue" | "steer" | "restart";

export interface IStartTurn {
  EnvironmentId: string;
  ThreadId: string;
  CommandId: string;
  MessageId: string;
  Text: string;
  Attachments: IWireAttachment[];
  ModelSelection: IWireModelSelection | null;
  RuntimeMode: IWireRuntimeMode;
  InteractionMode: IWireInteractionMode;
  DispatchMode: IDispatchMode;
  NewThread: { ProjectId: string; Title: string } | null;
  /** Marks a `/compact` this client sent on its own before the user's message. */
  IdleCompaction?: "onReturn";
}

export interface IStopThread {
  EnvironmentId: string;
  ThreadId: string;
  CommandId: string;
}

export interface IRespondRequest {
  EnvironmentId: string;
  ThreadId: string;
  CommandId: string;
  RequestId: string;
  Decision: IApprovalDecision | null;
  Answers: Record<string, string | ReadonlyArray<string>> | null;
  Dismiss?: true;
}

export type IQueueOperation =
  | { Kind: "resume" }
  | { Kind: "cancel"; RunId: string }
  | { Kind: "start"; RunId: string }
  | { Kind: "steer"; RunId: string; TargetRunId: string }
  | { Kind: "edit"; RunId: string; Text: string };

export interface IQueueCommand {
  EnvironmentId: string;
  ThreadId: string;
  CommandId: string;
  Operation: IQueueOperation;
}

export interface IRewind {
  EnvironmentId: string;
  ThreadId: string;
  CommandId: string;
  TurnCount: number;
  RestoreFiles: boolean;
  Checkpoint: { Id: string; ScopeId: string } | null;
}

interface IRewindEffect extends IEffect, IRewind {
  Type: "rewind";
}

export const rewindEffect = defineEffect<IRewindEffect, void>("rewind");

export interface IForkThread {
  EnvironmentId: string;
  CommandId: string;
  SourceThreadId: string;
  TargetThreadId: string;
  RunId: string;
  Title: string;
}

interface IForkThreadEffect extends IEffect, IForkThread {
  Type: "forkThread";
}

export const forkThreadEffect = defineEffect<IForkThreadEffect, void>("forkThread");

export interface IMergeBack {
  EnvironmentId: string;
  CommandId: string;
  SourceThreadId: string;
  TargetThreadId: string;
  RunId: string;
}

interface IMergeBackEffect extends IEffect, IMergeBack {
  Type: "mergeBack";
}

export const mergeBackEffect = defineEffect<IMergeBackEffect, void>("mergeBack");

interface IThreadTitlesEffect extends IEffect {
  Type: "threadTitles";
  EnvironmentId: string;
  ThreadIds: string[];
}

/** Deleted and unknown threads are absent from the titles. */
export const threadTitlesEffect = defineEffect<
  IThreadTitlesEffect,
  { Titles: Record<string, string> }
>("threadTitles");

export interface IProviderOption {
  InstanceId: string;
  Driver?: string;
  Name: string;
  SupportsRollback?: false;
  SupportedRuntimeModes?: IWireRuntimeMode[];
  SlashCommands?: ServerProviderSlashCommand[];
  Skills?: ServerProviderSkill[];
  /** Slugs the user hid; `Models` already leaves them out. */
  HiddenModels?: string[];
  Models: Array<{
    Slug: string;
    Name: string;
    ShortName?: string;
    SubProvider?: string;
    IsDefault: boolean;
    IsLegacy?: boolean;
    Capabilities?: ModelCapabilities;
  }>;
}

export interface IModelFavorite {
  Provider: string;
  Model: string;
}

interface IStartTurnEffect extends IEffect, IStartTurn {
  Type: "startTurn";
}
interface IStopThreadEffect extends IEffect, IStopThread {
  Type: "stopThread";
}
interface IRespondRequestEffect extends IEffect, IRespondRequest {
  Type: "respondRequest";
}

export interface IThreadDiff {
  EnvironmentId: string;
  ThreadId: string;
  Scope: "turn" | "thread";
  ToTurnCount: number;
}

interface IThreadDiffEffect extends IEffect, IThreadDiff {
  Type: "threadDiff";
}

export type IThreadCommand =
  | { Kind: "settle" }
  | { Kind: "unsettle" }
  | { Kind: "snooze"; Until: string }
  | { Kind: "unsnooze" }
  | { Kind: "pin" }
  | { Kind: "unpin" }
  | { Kind: "rename"; Title: string }
  | { Kind: "visit"; VisitedAt: string; Opened?: true; SearchQuery?: string }
  | { Kind: "markUnread" }
  | { Kind: "unarchive" }
  | { Kind: "delete" }
  | { Kind: "modelSelection"; Selection: IWireModelSelection }
  | { Kind: "runtimeMode"; Mode: IWireRuntimeMode }
  | { Kind: "branch"; Branch: string | null };

interface IThreadCommandEffect extends IEffect {
  Type: "threadCommand";
  EnvironmentId: string;
  ThreadId: string;
  CommandId: string;
  Command: IThreadCommand;
}

export const threadCommandEffect = defineEffect<IThreadCommandEffect, void>("threadCommand");

export type IProjectCommand =
  | { Kind: "create"; Title: string; WorkspaceRoot: string }
  | { Kind: "pin" }
  | { Kind: "unpin" }
  | { Kind: "archive" }
  | { Kind: "unarchive" }
  | { Kind: "rename"; Title: string }
  | { Kind: "delete"; Force?: boolean }
  | { Kind: "scripts"; Scripts: ProjectScript[] };

interface IProjectCommandEffect extends IEffect {
  Type: "projectCommand";
  EnvironmentId: string;
  ProjectId: string;
  CommandId: string;
  Command: IProjectCommand;
}

export const projectCommandEffect = defineEffect<IProjectCommandEffect, void>("projectCommand");

export interface IAddProjectSettings {
  BaseDirectory: string;
  GhqCloneLayout: boolean;
  NewProjectsRoot: string | null;
  Os: string;
}

interface IAddProjectSettingsEffect extends IEffect {
  Type: "addProjectSettings";
  EnvironmentId: string;
}

export const addProjectSettingsEffect = defineEffect<
  IAddProjectSettingsEffect,
  IAddProjectSettings
>("addProjectSettings");

export interface IFolderListing {
  ParentPath: string;
  Entries: Array<{ name: string; fullPath: string }>;
}

interface IBrowseFoldersEffect extends IEffect {
  Type: "browseFolders";
  EnvironmentId: string;
  PartialPath: string;
  Cwd: string | null;
}

export interface IProjectEntries {
  Entries: Array<{ path: string; kind: "file" | "directory" }>;
}

interface ISearchEntriesEffect extends IEffect {
  Type: "searchEntries";
  EnvironmentId: string;
  Cwd: string;
  Query: string;
  Limit: number;
}

export const searchEntriesEffect = defineEffect<ISearchEntriesEffect, IProjectEntries>(
  "searchEntries",
);

export const browseFoldersEffect = defineEffect<IBrowseFoldersEffect, IFolderListing>(
  "browseFolders",
);

interface ISearchThreadsEffect extends IEffect {
  Type: "searchThreads";
  EnvironmentId: string;
  Query: string;
}

export const searchThreadsEffect = defineEffect<
  ISearchThreadsEffect,
  { Matches: EnvironmentThreadSearchMatch[] }
>("searchThreads");

export interface IStartClone {
  EnvironmentId: string;
  ProjectId: string;
  Title: string;
  RemoteUrl: string;
  DestinationPath: string;
}

interface IStartCloneEffect extends IEffect, IStartClone {
  Type: "startClone";
}

export const startCloneEffect = defineEffect<IStartCloneEffect, void>("startClone");

interface ICloneControlEffect extends IEffect {
  Type: "cloneControl";
  EnvironmentId: string;
  ProjectId: string;
  Kind: "cancel" | "retry";
}

export const cloneControlEffect = defineEffect<ICloneControlEffect, void>("cloneControl");

export interface INewProject {
  ProjectId: string;
  WorkspaceRoot: string;
  CommitError: string | null;
}

interface INewProjectEffect extends IEffect {
  Type: "newProject";
  EnvironmentId: string;
  Name: string;
}

export const newProjectEffect = defineEffect<INewProjectEffect, INewProject>("newProject");

interface IOpenInFileManagerEffect extends IEffect {
  Type: "openInFileManager";
  EnvironmentId: string;
  Path: string;
}

export const openInFileManagerEffect = defineEffect<IOpenInFileManagerEffect, void>(
  "openInFileManager",
);

interface IOpenInEditorEffect extends IEffect {
  Type: "openInEditor";
  EnvironmentId: string;
  // An absolute path, with a `:line:column` suffix when it names a position.
  Path: string;
  ProjectRoot: string | null;
  Stored: string | null;
}

/** Answers the editor it opened. */
export const openInEditorEffect = defineEffect<IOpenInEditorEffect, string>("openInEditor");

export const threadDiffEffect = defineEffect<IThreadDiffEffect, string>("threadDiff");

interface IAssetUrlEffect extends IEffect {
  Type: "assetUrl";
  EnvironmentId: string;
  Resource: AssetResource;
}

export interface IAssetUrl {
  Url: string;
  Size?: { Width: number; Height: number };
}

export const assetUrlEffect = defineEffect<IAssetUrlEffect, IAssetUrl>("assetUrl");

interface IQueueCommandEffect extends IEffect, IQueueCommand {
  Type: "queueCommand";
}

interface ICloseTerminalEffect extends IEffect {
  Type: "closeTerminal";
  EnvironmentId: string;
  ThreadId: string;
  TerminalId: string;
}

export const closeTerminalEffect = defineEffect<ICloseTerminalEffect, void>("closeTerminal");
export const queueCommandEffect = defineEffect<IQueueCommandEffect, void>("queueCommand");
export const startTurnEffect = defineEffect<IStartTurnEffect, void>("startTurn");
export const stopThreadEffect = defineEffect<IStopThreadEffect, void>("stopThread");
export const respondRequestEffect = defineEffect<IRespondRequestEffect, void>("respondRequest");

export interface ISecretAnswer {
  EnvironmentId: string;
  Input: SecretRequestAnswerInput;
}

interface ISecretAnswerEffect extends IEffect, ISecretAnswer {
  Type: "answerSecret";
}

export const answerSecretEffect = defineEffect<ISecretAnswerEffect, void>("answerSecret", {
  redact: true,
});

export interface ILinkAnswer {
  EnvironmentId: string;
  Input: PeerLinkRequestAnswerInput;
}

interface ILinkAnswerEffect extends IEffect, ILinkAnswer {
  Type: "answerLink";
}

export const answerLinkEffect = defineEffect<ILinkAnswerEffect, void>("answerLink", {
  redact: true,
});

export function* withCommandId<R>(
  run: (commandId: string) => IActionGenerator<R>,
): IActionGenerator<R> {
  return yield* run(yield* generateGuid());
}
