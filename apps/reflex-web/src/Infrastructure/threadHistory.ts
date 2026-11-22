import {
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_VERSION_TEXT,
  OrchestrationV2ThreadHistoryPage,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { defineEffect, type IEffect, implementation } from "treflex";

import { ServerError, serverFetch } from "./serverError";
import { type IWireHistoryPage, wireCodec } from "./wire";

interface IThreadHistoryPageEffect extends IEffect {
  Type: "threadHistoryPage";
  ThreadId: string;
  Cursor: string;
}

const decodePage = Schema.decodeUnknownSync(OrchestrationV2ThreadHistoryPage);
const encodePage = Schema.encodeSync(wireCodec(OrchestrationV2ThreadHistoryPage));

const declared = defineEffect<IThreadHistoryPageEffect, IWireHistoryPage>("threadHistoryPage");

export const threadHistoryPage = (threadId: string, cursor: string) =>
  declared({ ThreadId: threadId, Cursor: cursor });

export const threadHistoryPageImpl = implementation(declared, async (effect, action) => {
  const query = new URLSearchParams({ cursor: effect.Cursor });
  const response = await serverFetch(
    `/api/orchestration/threads/${encodeURIComponent(effect.ThreadId)}/history?${query}`,
    {
      headers: { [ORCHESTRATION_PROTOCOL_HEADER]: ORCHESTRATION_PROTOCOL_VERSION_TEXT },
      signal: action?.signal ?? null,
    },
  );
  if (!response.ok) throw new ServerError(`History request failed with HTTP ${response.status}.`);
  return encodePage(decodePage(await response.json())) as unknown as IWireHistoryPage;
});
