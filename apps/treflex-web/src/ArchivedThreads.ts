import { type IEntity, type IOpenGenerator, latest, open } from "treflex";
import { createComponentFeature } from "treflex-solid";
import { onMount } from "solid-js";

import type { IThreadCommand } from "./Infrastructure/commandEffects";
import { archivedShellEffect, type IWireArchivedShell } from "./Infrastructure/settings";

export interface IArchivedThreads extends IEntity {
  Archived: IWireArchivedShell | null;
}

export function getDefaultArchivedThreads(): Omit<IArchivedThreads, "$Id"> {
  return { Archived: null };
}

export function* loadArchived(draft: IArchivedThreads, environmentId: string): IOpenGenerator {
  draft.Archived = yield* open(archivedShellEffect({ EnvironmentId: environmentId }));
}
latest(loadArchived);

const ArchivedThreads = createComponentFeature<IArchivedThreads>(import.meta.url)(
  { loadArchived },
  {},
);
export default ArchivedThreads;

// Follows ArchivedThreadsPanel in apps/web/src/components/settings/ArchivedThreadsPanel.tsx.
export function useArchivedThreads(
  environmentId: string,
  threadCommand: (threadId: string, command: IThreadCommand) => Promise<unknown>,
) {
  const page = ArchivedThreads.use();
  onMount(() => void page.loadArchived(environmentId));
  const command = (threadId: string, kind: "unarchive" | "delete") =>
    void threadCommand(threadId, { Kind: kind }).then(() => page.loadArchived(environmentId));
  return { state: page.state, command };
}
