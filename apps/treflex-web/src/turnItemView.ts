import { sentMessageFromToolItem } from "@t3tools/shared/toolOutput";

import type { IWireTurnItem } from "./Infrastructure/wire";

export interface ITurnItemView {
  Tone: "user" | "assistant" | "quiet" | "tool" | "plan" | "request" | "error" | "unknown";
  Label: string;
  Body?: string | undefined;
  Format: "markdown" | "text" | "code";
  Collapsed?: boolean;
  LiveOutput?: boolean;
}

const json = (value: unknown): string | undefined =>
  value === undefined ? undefined : JSON.stringify(value, null, 2);

const lines = (...parts: Array<string | null | undefined>): string =>
  parts.filter((part) => part !== undefined && part !== null && part !== "").join("\n");

const tool = (Label: string, Body: string | undefined): ITurnItemView => ({
  Tone: "tool",
  Label,
  Body,
  Format: "code",
  Collapsed: true,
});

const quiet = (Label: string, Body?: string): ITurnItemView => ({
  Tone: "quiet",
  Label,
  Body,
  Format: "text",
});

const request = (Label: string, Body: string): ITurnItemView => ({
  Tone: "request",
  Label,
  Body,
  Format: "text",
  Collapsed: true,
});

export function viewOf(
  item: IWireTurnItem,
  counts: { additions: number; deletions: number } | null = null,
): ITurnItemView {
  switch (item.type) {
    case "user_message":
      return {
        Tone: "user",
        Label: "You",
        Body: item.text,
        Format: "markdown",
      };
    case "assistant_message":
      return { Tone: "assistant", Label: "Assistant", Body: item.text, Format: "markdown" };
    case "reasoning":
      return {
        Tone: "quiet",
        Label: "Reasoning",
        Body: item.text,
        Format: "text",
        Collapsed: true,
      };
    case "proposed_plan":
      return { Tone: "plan", Label: "Proposed plan", Body: item.markdown, Format: "markdown" };
    case "todo_list":
      return {
        Tone: "plan",
        Label: "Plan",
        Body: lines(item.explanation, ...item.steps.map((step) => `[${step.status}] ${step.text}`)),
        Format: "text",
      };
    case "command_execution":
      return {
        ...tool(
          `Command: ${item.input}`,
          item.exitCode === undefined ? "" : `exit ${item.exitCode}`,
        ),
        Format: "text",
        LiveOutput: true,
      };
    case "file_change":
      return tool(
        `Changed ${item.fileName}${
          counts === null ? "" : ` (+${counts.additions} -${counts.deletions})`
        }`,
        lines(item.diffStr, ...(item.changes ?? []).map((c) => `${c.operation} ${c.path}`)),
      );
    case "file_search":
      return tool(
        `File search: ${item.pattern ?? ""}`,
        (item.results ?? []).map((r) => r.fileName).join("\n"),
      );
    case "web_search":
      return tool(
        `Web search: ${(item.patterns ?? []).join(", ")}`,
        (item.results ?? []).map((r) => lines(r.title, r.url)).join("\n"),
      );
    case "dynamic_tool": {
      const sent = item.status === "completed" ? sentMessageFromToolItem(item) : undefined;
      if (sent !== undefined)
        return { Tone: "assistant", Label: "Assistant", Body: sent, Format: "markdown" };
      return tool(
        `Tool: ${item.toolName ?? "unnamed"}`,
        item.outputOmitted === true
          ? lines(json(item.input), "Output not sent with the thread.")
          : lines(json(item.input), json(item.output)),
      );
    }
    case "subagent":
      return tool(`Subagent (${item.driver})`, lines(item.prompt, item.progress, item.result));
    case "approval_request":
      return request(
        `Approval requested: ${item.requestKind}`,
        lines(item.prompt, item.reason, `Status: ${item.status}`),
      );
    case "user_input_request":
      return request(
        "Question for you",
        lines(...item.questions.map((q) => q.question), `Status: ${item.status}`),
      );
    case "secret_request":
      return request(`Secret requested: ${item.label}`, lines(item.reason, item.secretStatus));
    case "link_request":
      return request(`Link requested: ${item.label ?? item.url ?? ""}`, item.reason);
    case "error":
      return { Tone: "error", Label: "Error", Body: item.failure.message, Format: "text" };
    case "checkpoint":
      return quiet(`Checkpoint: ${item.filesTotal?.count ?? item.files.length} files`);
    case "run_interrupt_request":
    case "run_interrupt_result":
    case "system_notice":
      return quiet(item.message);
    case "notification":
      return quiet(item.summary, item.detail);
    case "compaction":
      return quiet("Context compacted", item.summary);
    case "handoff":
      return quiet(`Handed off to ${item.toModel ?? item.toProviderInstanceId}`, item.summary);
    case "fork":
      return quiet("Forked here");
    case "thread_created":
      return quiet(`Started a thread with ${item.targetModel}`);
    default: {
      item satisfies never;
      const unknown = item as { type: string };
      return {
        Tone: "unknown",
        Label: `Unknown item: ${unknown.type}`,
        Body: json(unknown),
        Format: "code",
        Collapsed: true,
      };
    }
  }
}
