import { defineEffect, type IEffect, implementation } from "treflex";

interface IStoredChangedFilesExpandedEffect extends IEffect {
  Type: "storedChangedFilesExpanded";
  ThreadId: string;
}

interface IStoreChangedFilesExpandedEffect extends IEffect {
  Type: "storeChangedFilesExpanded";
  ThreadId: string;
  /** The runs whose card has every folder expanded. */
  Expanded: Record<string, true>;
}

const PREFIX = "treflex-web:changed-files-expanded:";

export const storedChangedFilesExpandedEffect = defineEffect<
  IStoredChangedFilesExpandedEffect,
  Record<string, true>
>("storedChangedFilesExpanded", { settles: "sync" });
export const storeChangedFilesExpandedEffect = defineEffect<IStoreChangedFilesExpandedEffect, void>(
  "storeChangedFilesExpanded",
);

export const storedChangedFilesExpandedImpl = implementation(
  storedChangedFilesExpandedEffect,
  (effect) => {
    try {
      const held: unknown = JSON.parse(localStorage.getItem(PREFIX + effect.ThreadId) ?? "{}");
      if (held === null || typeof held !== "object") return {};
      return Object.fromEntries(
        Object.entries(held).flatMap(([runId, expanded]) =>
          expanded === true ? [[runId, true as const]] : [],
        ),
      );
    } catch {
      return {};
    }
  },
);

export const storeChangedFilesExpandedImpl = implementation(
  storeChangedFilesExpandedEffect,
  (effect) => {
    try {
      if (Object.keys(effect.Expanded).length === 0) {
        localStorage.removeItem(PREFIX + effect.ThreadId);
      } else localStorage.setItem(PREFIX + effect.ThreadId, JSON.stringify(effect.Expanded));
    } catch {
      // A full store drops the write; the choice holds until the page reloads.
    }
  },
);
