import {
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_VERSION_TEXT,
} from "@t3tools/contracts";
import { defineEffect, type IEffect, implementation } from "treflex";

import type { IWireHistoryPage } from "./wire";

interface IThreadHistoryPageEffect extends IEffect {
  Type: "threadHistoryPage";
  ThreadId: string;
  Cursor: string;
}

const declared = defineEffect<IThreadHistoryPageEffect, IWireHistoryPage>("threadHistoryPage");

export const threadHistoryPage = (threadId: string, cursor: string) =>
  declared({ ThreadId: threadId, Cursor: cursor });

export const threadHistoryPageImpl = implementation(declared, async (effect, action) => {
  const query = new URLSearchParams({ cursor: effect.Cursor });
  const response = await fetch(
    `/api/orchestration/threads/${encodeURIComponent(effect.ThreadId)}/history?${query}`,
    {
      headers: { [ORCHESTRATION_PROTOCOL_HEADER]: ORCHESTRATION_PROTOCOL_VERSION_TEXT },
      signal: action?.signal,
    },
  );
  if (!response.ok) throw new Error(`History request failed with HTTP ${response.status}.`);
  return (await response.json()) as IWireHistoryPage;
});
