import { type IEntity, type IOpenGenerator, latest, open } from "treflex";
import { createEntityFeature } from "treflex-solid";

import { archivedShellEffect, type IWireArchivedShell } from "./Infrastructure/settings";

/** The Archive page's read, which `showView` makes as the page opens and removes as it closes. */
export interface IArchivePage extends IEntity {
  EnvironmentId: string;
  Archived: IWireArchivedShell | null;
}

export function getDefaultArchivePage(environmentId: string): Omit<IArchivePage, "$Id"> {
  return { EnvironmentId: environmentId, Archived: null };
}

// Follows ArchivedThreadsPanel in apps/web/src/components/settings/ArchivedThreadsPanel.tsx.
export function* loadArchived(draft: IArchivePage): IOpenGenerator {
  draft.Archived = yield* open(archivedShellEffect({ EnvironmentId: draft.EnvironmentId }));
}
latest(loadArchived);

export default createEntityFeature<IArchivePage>("ArchivePage")({}, {});
