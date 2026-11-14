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
  NewThread: { ProjectId: string; Title: string } | null;
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
}

export interface IQueueCommand {
  EnvironmentId: string;
  ThreadId: string;
  CommandId: string;
  RunId: string | null;
}

export interface IProviderOption {
  InstanceId: string;
  Driver?: string;
  Name: string;
  Models: Array<{ Slug: string; Name: string; IsDefault: boolean }>;
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
interface IServerProvidersEffect extends IEffect {
  Type: "serverProviders";
  EnvironmentId: string;
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
  | { Kind: "visit"; VisitedAt: string }
  | { Kind: "markUnread" }
  | { Kind: "delete" };

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
  | { Kind: "rename"; Title: string };

interface IProjectCommandEffect extends IEffect {
  Type: "projectCommand";
  EnvironmentId: string;
  ProjectId: string;
  CommandId: string;
  Command: IProjectCommand;
}

export const projectCommandEffect = defineEffect<IProjectCommandEffect, void>("projectCommand");

export const threadDiffEffect = defineEffect<IThreadDiffEffect, string>("threadDiff");

interface IAttachmentUrlEffect extends IEffect {
  Type: "attachmentUrl";
  EnvironmentId: string;
  AttachmentId: string;
}

export const attachmentUrlEffect = defineEffect<IAttachmentUrlEffect, string>("attachmentUrl");

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
export const serverProvidersEffect = defineEffect<IServerProvidersEffect, IProviderOption[]>(
  "serverProviders",
);

export function* withCommandId<R>(
  run: (commandId: string) => IActionGenerator<R>,
): IActionGenerator<R> {
  return yield* run(yield* generateGuid());
}
