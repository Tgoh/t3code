import { defineEffect, type IEffect, implementation } from "treflex";

/** A changed files card's choices; a card with neither is closed with its folders collapsed. */
export interface IChangedFilesCard {
  Open: boolean;
  /** Every folder expanded. */
  Expanded: boolean;
}

interface IStoredChangedFilesEffect extends IEffect {
  Type: "storedChangedFiles";
  ThreadId: string;
}

interface IStoreChangedFilesEffect extends IEffect {
  Type: "storeChangedFiles";
  ThreadId: string;
  /** By run id, holding only the cards with a choice made. */
  Cards: Record<string, IChangedFilesCard>;
}

const PREFIX = "treflex-web:changed-files-expanded:";

export const storedChangedFilesEffect = defineEffect<
  IStoredChangedFilesEffect,
  Record<string, IChangedFilesCard>
>("storedChangedFiles", { settles: "sync" });
export const storeChangedFilesEffect = defineEffect<IStoreChangedFilesEffect, void>(
  "storeChangedFiles",
);

function storedCard(held: unknown): IChangedFilesCard | null {
  // An entry of `true` was written before the card could close: Expand all alone.
  if (held === true) return { Open: false, Expanded: true };
  if (held === null || typeof held !== "object") return null;
  const open = "Open" in held && held.Open === true;
  const expanded = "Expanded" in held && held.Expanded === true;
  return open || expanded ? { Open: open, Expanded: expanded } : null;
}

export function readChangedFiles(threadId: string): Record<string, IChangedFilesCard> {
  try {
    const held: unknown = JSON.parse(localStorage.getItem(PREFIX + threadId) ?? "{}");
    if (held === null || typeof held !== "object") return {};
    return Object.fromEntries(
      Object.entries(held).flatMap(([runId, value]) => {
        const card = storedCard(value);
        return card === null ? [] : [[runId, card]];
      }),
    );
  } catch {
    return {};
  }
}

export const storedChangedFilesImpl = implementation(storedChangedFilesEffect, (effect) =>
  readChangedFiles(effect.ThreadId),
);

export const storeChangedFilesImpl = implementation(storeChangedFilesEffect, (effect) => {
  try {
    if (Object.keys(effect.Cards).length === 0) localStorage.removeItem(PREFIX + effect.ThreadId);
    else localStorage.setItem(PREFIX + effect.ThreadId, JSON.stringify(effect.Cards));
  } catch {
    // A full store drops the write; the choice holds until the page reloads.
  }
});
