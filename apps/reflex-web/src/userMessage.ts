import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { resolveUserMessagePresentation } from "@t3tools/client-runtime/user-message";
import {
  parseComposerContextHref,
  replaceComposerContextReferences,
} from "@t3tools/shared/composerContextReferences";
import {
  parseThreadLinkHref,
  threadLinkCandidates,
  unknownThreadLinkLabel,
} from "@t3tools/shared/threadLinks";

import type { IWireProjection, IWireTurnItem } from "./Infrastructure/wire";

type IWireUserItem = Extract<IWireTurnItem, { type: "user_message" }>;
type IWireMessage = IWireProjection["messages"][number];

/** A sent turn item or a queued run's message. */
export type ISentMessage = Pick<
  IWireUserItem,
  | "text"
  | "createdBy"
  | "creationSource"
  | "scheduledTaskId"
  | "senderThreadId"
  | "linkedSender"
  | "context"
> & { id?: string };

export type IThreadTitle = (threadId: string) => string | undefined;

export interface IThreadTarget {
  Ref: ScopedThreadRef;
  Title: string;
  /** Only this client's environment can be opened; another machine's thread is shown, not linked. */
  Openable: boolean;
}

export interface IMessageFold {
  Kind: "agent" | "automation";
  Label: string;
  Summary: string;
  Sender: IThreadTarget | null;
}

export type IAttribution = "automation" | "agent" | "t3code" | "guest" | null;

export const fromItem = (item: IWireUserItem): ISentMessage => ({ ...item, id: item.messageId });

export const fromMessage = (message: IWireMessage): ISentMessage => message;

const presentation = (message: ISentMessage) =>
  resolveUserMessagePresentation({
    ...message,
    role: "user",
    scheduledTaskId: message.scheduledTaskId as never,
  });

export const attribution = (message: ISentMessage): IAttribution =>
  presentation(message).attribution;

/** The words people see: a guest's own text, without an automation's legacy prefix or a bootstrap prompt. */
export const displayText = (message: ISentMessage): string => presentation(message).text;

const firstLine = (text: string): string =>
  text
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)
    ?.trim() ?? "";

// Follows UserTimelineRow and AutomationMessageRow in apps/web/src/components/chat/TimelineUserMessageRow.tsx.
export function messageFold(
  message: ISentMessage,
  environmentId: string,
  title: IThreadTitle,
): IMessageFold | null {
  const shown = presentation(message);
  if (shown.attribution === "automation") {
    return {
      Kind: "automation",
      Label: "Automation",
      Summary: shown.text.trim().split(/\r?\n/, 1)[0] ?? "",
      Sender: null,
    };
  }
  if (shown.attribution !== "agent") return null;
  const sender = senderOf(message, environmentId, title);
  return {
    Kind: "agent",
    Label: sender?.Title || "Agent",
    Summary: firstLine(
      replaceComposerContextReferences(shown.text, (reference) => reference.label),
    ),
    Sender: sender,
  };
}

function senderOf(
  message: ISentMessage,
  environmentId: string,
  title: IThreadTitle,
): IThreadTarget | null {
  const linked = message.linkedSender;
  if (linked !== undefined) {
    const here = linked.environmentId === environmentId;
    return {
      Ref: { environmentId: linked.environmentId, threadId: linked.threadId } as ScopedThreadRef,
      Title: (here ? title(linked.threadId)?.trim() : undefined) || linked.title.trim(),
      Openable: here,
    };
  }
  if (message.senderThreadId === undefined) return null;
  return {
    Ref: { environmentId, threadId: message.senderThreadId } as ScopedThreadRef,
    Title: title(message.senderThreadId)?.trim() ?? "",
    Openable: true,
  };
}

export interface ISteerLabel {
  Text: string;
  Tip: string;
}

// Follows UserMessageIntentMarker in apps/web/src/components/chat/TimelineUserMessageRow.tsx.
export function steerLabel(
  inputIntent: IWireUserItem["inputIntent"] | undefined,
  status: string | undefined,
): ISteerLabel | null {
  if (inputIntent !== "steer" && inputIntent !== "promoted_queued_to_steer") return null;
  const unread = status === "pending";
  return {
    Text: unread ? "Steer · waiting to be read" : "Steer",
    Tip: unread
      ? "Waiting for the agent to read this. It reads steers between steps, after a running command finishes."
      : inputIntent === "promoted_queued_to_steer"
        ? "Originally queued, then promoted to steer the active turn"
        : "Steered the active turn",
  };
}

export type ILinkTarget = IThreadTarget | { Unknown: string };

// Follows MarkdownThreadLink in apps/web/src/components/chat/MarkdownThreadLink.tsx, without its
// metadata lookup: a thread of this environment the shell doesn't hold still opens.
export function threadLinkTarget(
  href: string,
  label: string | null,
  environmentId: string,
  title: IThreadTitle,
): ILinkTarget | null {
  const link = parseThreadLinkHref(href);
  if (link === null) return null;
  const candidates = threadLinkCandidates(link, environmentId as EnvironmentId);
  if (candidates[0]!.environmentId !== environmentId) {
    return { Unknown: label ?? unknownThreadLinkLabel(link, environmentId as EnvironmentId) };
  }
  for (const ref of candidates) {
    const known = title(ref.threadId);
    if (known !== undefined)
      return { Ref: ref, Title: known.trim() || label || "Thread", Openable: true };
  }
  return { Ref: candidates[0]!, Title: label ?? "Thread", Openable: true };
}

/** A `t3-context://…/thread/…` chip resolves through the message's own context records. */
export function contextThreadTarget(
  href: string,
  message: Pick<ISentMessage, "context"> | null,
  environmentId: string,
  title: IThreadTitle,
): IThreadTarget | null {
  const reference = parseComposerContextHref(href);
  if (reference?.kind !== "thread") return null;
  const record = message?.context?.records.find(
    (held) => held.contextId === reference.contextId && held.kind === "thread",
  );
  if (record === undefined || !("threadId" in record)) return null;
  const here = record.environmentId === environmentId;
  return {
    Ref: {
      environmentId: record.environmentId,
      threadId: record.threadId as ThreadId,
    } as ScopedThreadRef,
    Title: (here ? title(record.threadId)?.trim() : undefined) || record.title,
    Openable: here,
  };
}
