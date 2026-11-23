import type { HtmlRenderReference } from "@t3tools/shared/htmlRender";
import type { McpAppReference } from "@t3tools/shared/mcpApp";
import { htmlRenderFromToolItem, mcpAppFromToolItem } from "@t3tools/shared/toolOutput";

import type { IWireTurnItem } from "./Infrastructure/wire";

export type IEmbed =
  | { Kind: "html-render"; HtmlRender: HtmlRenderReference }
  | { Kind: "mcp-app"; App: McpAppReference };

// Follows deriveTimelineEntriesFromVisibleTurnItems in apps/web/src/session-logic.ts.
/** A page the agent rendered, or an MCP app a tool call opened, which the timeline shows inline. */
export function embedOf(item: IWireTurnItem): IEmbed | null {
  if (item.type !== "dynamic_tool") return null;
  const htmlRender = item.status === "completed" ? htmlRenderFromToolItem(item) : undefined;
  if (htmlRender !== undefined) return { Kind: "html-render", HtmlRender: htmlRender };
  const app = mcpAppFromToolItem(item);
  return app === undefined ? null : { Kind: "mcp-app", App: app };
}
