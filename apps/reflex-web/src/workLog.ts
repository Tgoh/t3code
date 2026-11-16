import {
  commandDisplayText,
  commandProgramName,
} from "@t3tools/client-runtime/work-log/command-label";
import {
  contextCompactionLabel,
  liveActivityToolStatus,
  normalizeCompactToolLabel,
  resolveWorkEntryToolPresentation,
  toolGroupAction,
  type WorkLogPresentationEntry,
  workEntryIndicatesToolFailure,
  type WorkLogToolLifecycleStatus,
} from "@t3tools/client-runtime/work-log/presentation";
import { extractToolActivityPresentation } from "@t3tools/client-runtime/work-log/tool-presentation";
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { formatFilePathPosition, splitFilePathPosition } from "@t3tools/shared/fileLinks";
import {
  fileBasename,
  isWindowsAbsolutePath,
  stripSlashPrefixedWindowsDrive,
} from "@t3tools/shared/path";
import {
  classifyToolActivity,
  collectToolFilePaths,
  dynamicToolTitle,
  formatReadToolLabel,
  formatSearchToolLabel,
} from "@t3tools/shared/toolActivity";

import type { IWireTurnItem } from "./Infrastructure/wire";

export interface IWorkLogEntry extends WorkLogPresentationEntry {
  readonly runId: string | null;
  readonly sourceActivityKind?: string;
}

// The presentation helpers read no decoded field, so the wire form passes through them.
const asItem = (item: IWireTurnItem) => item as unknown as OrchestrationV2TurnItem;

function lifecycleStatus(item: IWireTurnItem): WorkLogToolLifecycleStatus {
  switch (item.status) {
    case "pending":
    case "running":
    case "waiting":
      return "inProgress";
    case "cancelled":
    case "interrupted":
      return "stopped";
    default:
      return item.status;
  }
}

function tone(item: IWireTurnItem): IWorkLogEntry["tone"] {
  switch (item.type) {
    case "reasoning":
      return "thinking";
    case "command_execution":
    case "file_change":
    case "file_search":
    case "web_search":
    case "dynamic_tool":
    case "subagent":
    case "thread_created":
    case "user_input_request":
    case "approval_request":
      return "tool";
    default:
      return "info";
  }
}

export function providerErrorPresentation(item: Extract<IWireTurnItem, { type: "error" }>): {
  label: string;
  detail: string;
} {
  if (item.retry === undefined) {
    return {
      label:
        item.failure.class === "usage_limit"
          ? "Usage limit reached"
          : item.title?.trim() || "Provider error",
      detail: item.failure.message,
    };
  }
  const progress =
    item.retry.maxAttempts === null
      ? `${item.retry.attempt}`
      : `${item.retry.attempt}/${item.retry.maxAttempts}`;
  const label =
    item.status === "running"
      ? `Retrying provider (${progress})`
      : item.status === "completed"
        ? `Provider recovered (${progress} retries)`
        : item.status === "failed"
          ? `${item.failure.class === "usage_limit" ? "Usage limit reached" : "Provider error"} after ${progress} retries`
          : `Provider retry stopped (${progress})`;
  const retryDelay =
    item.status === "running" && item.retry.retryDelayMs !== null && item.retry.retryDelayMs > 0
      ? item.retry.retryDelayMs < 1_000
        ? ` Retrying in ${item.retry.retryDelayMs}ms.`
        : ` Retrying in ${(item.retry.retryDelayMs / 1_000).toFixed(1).replace(/\.0$/u, "")}s.`
      : "";
  return { label, detail: `${item.failure.message}${retryDelay}` };
}

// Follows projectedWorkEntry in apps/web/src/session-logic.ts, and the notification entry of
// deriveTimelineEntriesFromVisibleTurnItems there.
export function workLogEntry(item: IWireTurnItem): IWorkLogEntry {
  const title = item.title?.trim() || null;
  const common = {
    id: item.id,
    createdAt: item.startedAt ?? item.updatedAt,
    runId: item.runId,
    tone: tone(item),
    itemType: item.type,
    toolLifecycleStatus: lifecycleStatus(item),
    structuredPayload: asItem(item),
    ...extractToolActivityPresentation(item),
  } as const;
  switch (item.type) {
    case "notification":
      return { ...common, tone: "info", toolLifecycleStatus: undefined, label: item.summary };
    case "thread_created":
      return { ...common, label: "Created thread" };
    case "compaction":
      return {
        ...common,
        label: contextCompactionLabel(item),
        sourceActivityKind: "context-compaction",
        ...(item.summary ? { detail: item.summary } : {}),
      };
    case "reasoning":
      return { ...common, label: title ?? "Thinking", ...(item.text ? { detail: item.text } : {}) };
    case "command_execution":
      return {
        ...common,
        label: title ?? "Ran command",
        command: item.input,
        rawCommand: item.input,
        toolTitle: title ?? "Command",
        toolData: item,
      };
    case "file_change":
      return {
        ...common,
        label:
          title ??
          (item.changes !== undefined && item.changes.length > 1
            ? `Changed ${item.changes.length} files`
            : `Changed ${item.fileName}`),
        changedFiles: item.changes?.length
          ? item.changes.map((change) => change.path)
          : [item.fileName],
        toolTitle: title ?? "File change",
        toolData: item,
      };
    case "file_search":
      return {
        ...common,
        label: title ?? formatSearchToolLabel(item) ?? "Searched files",
        ...(item.pattern ? { detail: item.pattern } : {}),
        toolTitle: title ?? "File search",
        toolData: item,
      };
    case "web_search":
      return {
        ...common,
        label: title ?? "Searched the web",
        ...(item.patterns?.length ? { detail: item.patterns.join(", ") } : {}),
        toolTitle: title ?? "Web search",
        toolData: item,
      };
    case "checkpoint":
      return {
        ...common,
        label: title ?? "Checkpoint captured",
        changedFiles: item.files.map((file) => file.path),
        toolData: item,
      };
    case "system_notice":
      return {
        ...common,
        label: item.message,
        ...(item.level === "info" ? {} : { sourceActivityKind: "runtime.warning" }),
      };
    case "error":
      return {
        ...common,
        ...providerErrorPresentation(item),
        ...(item.failure.class === "usage_limit" && item.status !== "completed"
          ? { sourceActivityKind: "runtime.warning" }
          : item.retry === undefined
            ? { sourceActivityKind: "runtime.error" }
            : {}),
        toolData: item,
      };
    case "dynamic_tool": {
      const classified = classifyToolActivity({
        itemType: "dynamic_tool_call",
        data: { toolName: item.toolName ?? undefined, input: item.input },
      });
      const [readPath] = collectToolFilePaths({ input: item.input });
      return {
        ...common,
        label:
          title ??
          (classified === "read"
            ? formatReadToolLabel(readPath ?? "")
            : classified === "search"
              ? (formatSearchToolLabel({ input: item.input }) ?? item.toolName ?? "Tool call")
              : (item.toolName ?? "Tool call")),
        toolTitle: title ?? item.toolName ?? "Tool",
        toolData: { input: item.input, output: item.output },
      };
    }
    case "todo_list": {
      const done = item.steps.filter((step) => step.status === "completed").length;
      const current =
        item.steps.find((step) => step.status === "running") ??
        item.steps.find((step) => step.status === "pending");
      return {
        ...common,
        label: `Tasks ${done}/${item.steps.length}${current ? ` · ${current.text}` : ""}`,
      };
    }
    case "approval_request":
      return {
        ...common,
        label: title ?? "Approval requested",
        detail: item.prompt ?? item.requestKind,
        toolData: item,
      };
    case "user_input_request":
      return {
        ...common,
        label: title ?? (item.questionAnswer ? "Answered questions" : "Input requested"),
        ...(item.questionAnswer ? { questionAnswer: item.questionAnswer as never } : {}),
        toolData: item,
      };
    default:
      return { ...common, label: title ?? item.type.replaceAll("_", " "), toolData: item };
  }
}

// Follows apps/web/src/filePathDisplay.ts.
export function formatWorkspaceRelativePath(
  pathWithPosition: string,
  workspaceRoot: string | undefined,
): string {
  const position = splitFilePathPosition(pathWithPosition);
  const normalizedPath = stripSlashPrefixedWindowsDrive(position.path.replaceAll("\\", "/"));
  let displayPath = normalizedPath;
  if (workspaceRoot) {
    const normalizedRoot = stripSlashPrefixedWindowsDrive(
      workspaceRoot.replace(/[\\/]+$/, "").replaceAll("\\", "/"),
    );
    const workspaceLabel = fileBasename(normalizedRoot);
    const caseInsensitive = isWindowsAbsolutePath(stripSlashPrefixedWindowsDrive(workspaceRoot));
    const fold = (value: string) => (caseInsensitive ? value.toLowerCase() : value);
    const pathForCompare = fold(normalizedPath);
    const rootForCompare = fold(normalizedRoot);
    if (pathForCompare === rootForCompare) {
      displayPath = workspaceLabel;
    } else if (pathForCompare.startsWith(`${rootForCompare}/`)) {
      displayPath = `${workspaceLabel}/${normalizedPath.slice(normalizedRoot.length + 1)}`;
    } else if (!normalizedPath.startsWith("/") && !isWindowsAbsolutePath(normalizedPath)) {
      const relativePath = normalizedPath.replace(/^\.\/+/, "").replace(/^\/+/, "");
      displayPath = pathForCompare.startsWith(fold(`${workspaceLabel}/`))
        ? normalizedPath
        : `${workspaceLabel}/${relativePath}`;
    }
  }
  return formatFilePathPosition({ ...position, path: displayPath });
}

// Follows workLogEntryIsToolLike and the status checks beside it in apps/web/src/session-logic.ts.
export function workLogEntryIsToolLike(entry: IWorkLogEntry): boolean {
  return (
    entry.tone === "tool" ||
    entry.tone === "thinking" ||
    entry.tone === "error" ||
    entry.command !== undefined ||
    entry.requestKind !== undefined
  );
}

function workEntryIndicatesToolSuccess(entry: IWorkLogEntry): boolean {
  if (
    !workLogEntryIsToolLike(entry) ||
    workEntryIndicatesToolFailure(entry) ||
    (entry.tone === "thinking" && entry.itemType !== "reasoning")
  )
    return false;
  const status = entry.toolLifecycleStatus;
  return (
    status !== "failed" &&
    status !== "declined" &&
    status !== "inProgress" &&
    status !== "stopped" &&
    status !== "idle"
  );
}

function workEntryIndicatesToolNeutralStatus(entry: IWorkLogEntry): boolean {
  return (
    workLogEntryIsToolLike(entry) &&
    !workEntryIndicatesToolFailure(entry) &&
    !workEntryIndicatesToolSuccess(entry)
  );
}

// The rest follows apps/web/src/components/chat/MessagesTimeline.logic.ts.
export function workEntryIsActiveTurnActivity(entry: IWorkLogEntry): boolean {
  return (
    entry.toolLifecycleStatus === "inProgress" ||
    (entry.toolLifecycleStatus === undefined &&
      (entry.sourceActivityKind === "task.progress" || workLogEntryIsToolLike(entry)))
  );
}

export function workEntryIsVisibleInGroup(entry: IWorkLogEntry, expanded = false): boolean {
  if (entry.itemType === "reasoning") return Boolean(entry.detail?.trim());
  return (
    (expanded &&
      (entry.toolLifecycleStatus === "inProgress" ||
        entry.sourceActivityKind === "task.progress")) ||
    entry.toolLifecycleStatus === "stopped" ||
    !workEntryIndicatesToolNeutralStatus(entry)
  );
}

const toolDataRecord = (entry: IWorkLogEntry): Record<string, unknown> | undefined =>
  entry.toolData !== null && typeof entry.toolData === "object" && !Array.isArray(entry.toolData)
    ? (entry.toolData as Record<string, unknown>)
    : undefined;

function readPaths(entry: IWorkLogEntry, workspaceRoot: string | undefined): string[] {
  const fromChanged = entry.changedFiles ?? [];
  const structured = entry.structuredPayload;
  const raw =
    fromChanged.length > 0
      ? fromChanged
      : structured?.type === "dynamic_tool" &&
          collectToolFilePaths({ input: structured.input }).length > 0
        ? collectToolFilePaths({ input: structured.input })
        : collectToolFilePaths(toolDataRecord(entry));
  return raw.map((path) => formatWorkspaceRelativePath(path, workspaceRoot));
}

const thoughtText = (entry: IWorkLogEntry) => entry.detail?.trim().replace(/\s+/g, " ");

export function workEntryDisplayLabel(entry: IWorkLogEntry, workspaceRoot: string | undefined) {
  if (entry.itemType === "system_notice") return entry.label;
  if (entry.itemType === "reasoning" || entry.tone === "thinking")
    return thoughtText(entry) || entry.label;
  const presentation = resolveWorkEntryToolPresentation(entry);
  if (presentation) return presentation.displayName;
  if (entry.command?.trim()) return commandDisplayText(entry.command);
  const action = toolGroupAction(entry);
  if (action === "code-search" || action === "search") {
    const searchLabel =
      entry.itemType === "file_search" ? entry.label : formatSearchToolLabel(toolDataRecord(entry));
    if (searchLabel) return searchLabel;
  }
  const paths = action === "read" ? readPaths(entry, workspaceRoot) : [];
  if (action === "read" && paths[0]) return formatReadToolLabel(paths[0], paths.length - 1);
  const item = entry.structuredPayload;
  const providerRetry = item?.type === "error" && item.retry !== undefined;
  const title =
    item?.type === "dynamic_tool" ? dynamicToolTitle(item.toolName, item.input, item.title) : null;
  if (title) return title;
  const detail = entry.detail?.trim();
  const detailIsSearchOutput =
    (action === "code-search" || action === "search") && /[\r\n]/.test(detail ?? "");
  if (detail && !providerRetry && action !== "read" && !detailIsSearchOutput) return detail;
  const [firstPath] = entry.changedFiles ?? [];
  if (firstPath) {
    const path = formatWorkspaceRelativePath(firstPath, workspaceRoot);
    return entry.changedFiles!.length === 1
      ? path
      : `${path} +${entry.changedFiles!.length - 1} more`;
  }
  if (action === "read" && !entry.viewedImagePath) return "Read file";
  const heading = normalizeCompactToolLabel(entry.toolTitle || entry.label);
  return `${heading.charAt(0).toUpperCase()}${heading.slice(1)}`;
}

export function singleToolCallLabel(entry: IWorkLogEntry, workspaceRoot: string | undefined) {
  if (entry.itemType === "reasoning") return thoughtText(entry) || "Thought";
  const presentation = resolveWorkEntryToolPresentation(entry, "completed");
  if (presentation) return presentation.displayName;
  const item = entry.structuredPayload;
  const title =
    item?.type === "dynamic_tool" ? dynamicToolTitle(item.toolName, item.input, item.title) : null;
  if (title) return title;
  if (entry.itemType === "web_search") return entry.toolTitle ?? "Web search";
  return workEntryDisplayLabel(entry, workspaceRoot);
}

export function liveWorkEntryLabel(
  entry: IWorkLogEntry,
  workspaceRoot: string | undefined,
  active: boolean,
) {
  const status = liveActivityToolStatus(entry.toolLifecycleStatus, active);
  if (entry.itemType === "reasoning")
    return thoughtText(entry) || (status === "inProgress" ? "Thinking" : "Thought");
  const presentation = resolveWorkEntryToolPresentation({ ...entry, toolLifecycleStatus: status });
  if (presentation) return presentation.displayName;
  const command = entry.command?.trim();
  if (command) {
    const verb =
      status === "inProgress"
        ? "Running"
        : status === "failed"
          ? "Failed"
          : status === "declined"
            ? "Declined"
            : status === "stopped"
              ? "Stopped"
              : "Ran";
    return `${verb} ${commandProgramName(command) ?? "command"}`;
  }
  return workEntryDisplayLabel(entry, workspaceRoot);
}
