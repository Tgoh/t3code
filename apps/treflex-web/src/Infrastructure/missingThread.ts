import {
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_VERSION_TEXT,
} from "@t3tools/contracts";

export async function reportsMissingThread(response: Response): Promise<boolean> {
  if (response.status !== 404) {
    await response.body?.cancel();
    return false;
  }
  try {
    const body = (await response.json()) as { _tag?: unknown } | null;
    return body?._tag === "EnvironmentResourceNotFoundError";
  } catch {
    return false;
  }
}

// Follows the ThreadSnapshotLoader layer in
// packages/client-runtime/src/state/boundedThreadSnapshotHttp.ts: the socket can't tell a
// missing thread from a failure, and the HTTP snapshot's not-found error can.
export async function threadMissing(threadId: string): Promise<boolean> {
  const query = new URLSearchParams({
    compactTurnItems: "1",
    dedupeBodies: "1",
    compactIds: "1",
    deferWork: "1",
  });
  try {
    const response = await fetch(
      `/api/orchestration/threads/${encodeURIComponent(threadId)}/bounded?${query}`,
      { headers: { [ORCHESTRATION_PROTOCOL_HEADER]: ORCHESTRATION_PROTOCOL_VERSION_TEXT } },
    );
    return await reportsMissingThread(response);
  } catch {
    return false;
  }
}
