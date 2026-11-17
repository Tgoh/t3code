import { defineEffect, type IEffect, implementation } from "treflex";

import { type IAppearanceMode, isAppearanceMode } from "../colorScheme";
import { type IProjectSort, isProjectSort } from "../projectOrder";
import { clockNow } from "../timestamps";

/** This device's choices. Each field keeps the localStorage key and value shape it always had. */
export interface IPreferences {
  GroupByProject: boolean;
  ClosedFolders: string[];
  ProjectSort: IProjectSort;
  ProjectOrder: string[];
  HiddenProjects: string[];
  ProjectScope: string[];
  SidebarCollapsed: boolean;
  /** `environment:instance` keys of providers whose resume compaction was answered "Don't ask again". */
  CompactionDismissed: string[];
  AppearanceMode: IAppearanceMode;
  Usage: { Metric: string; Days: number };
  /** Where dictated audio goes: this client's server, nowhere, or not yet chosen. */
  VoiceDestination: IVoiceDestination;
}

export type IVoiceDestination = "server" | "off" | null;

interface IStoredPreferencesEffect extends IEffect {
  Type: "storedPreferences";
}

interface IStorePreferencesEffect extends IEffect {
  Type: "storePreferences";
  Patch: Partial<IPreferences>;
}

interface IStoredEditorEffect extends IEffect {
  Type: "storedEditor";
}

interface IStoreEditorEffect extends IEffect {
  Type: "storeEditor";
  Editor: string;
}

interface IClockNowEffect extends IEffect {
  Type: "clockNow";
}

export const storedPreferencesEffect = defineEffect<IStoredPreferencesEffect, IPreferences>(
  "storedPreferences",
);
export const storePreferencesEffect = defineEffect<IStorePreferencesEffect, void>(
  "storePreferences",
);
export const storedEditorEffect = defineEffect<IStoredEditorEffect, string | null>("storedEditor");
export const storeEditorEffect = defineEffect<IStoreEditorEffect, void>("storeEditor");
export const clockNowEffect = defineEffect<IClockNowEffect, number>("clockNow");

// The theme, usage and editor keys are stock's (THEME_APPEARANCE_MODE_STORAGE_KEY,
// usagePagePreferences.ts, editorPreferences.ts), so a browser on stock's origin reads the same values.
export const APPEARANCE_MODE_KEY = "t3code:theme-appearance-mode";
const USAGE_KEY = "t3code:usage-page-preferences:v1";
const EDITOR_KEY = "t3code:last-editor";
const KEYS = {
  GroupByProject: "reflex-web:group-by-project",
  ClosedFolders: "reflex-web:closed-folders",
  ProjectSort: "reflex-web:project-sort",
  ProjectOrder: "reflex-web:project-order",
  HiddenProjects: "reflex-web:hidden-projects",
  ProjectScope: "reflex-web:project-scope",
  SidebarCollapsed: "reflex-web:sidebar-collapsed",
  VoiceDestination: "reflex-web:voice-destination",
  CompactionDismissed: "reflex-web:compaction-dismissed",
} as const;

function readJson(key: string): unknown {
  try {
    const held = localStorage.getItem(key);
    return held === null ? undefined : JSON.parse(held);
  } catch {
    return undefined;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows and blocked storage just forget the choice; it still applies to this page.
  }
}

const ids = (held: unknown): string[] =>
  Array.isArray(held) ? held.filter((id): id is string => typeof id === "string") : [];

export function storedAppearanceMode(): IAppearanceMode {
  try {
    const held = localStorage.getItem(APPEARANCE_MODE_KEY);
    return isAppearanceMode(held) ? held : "system";
  } catch {
    return "system";
  }
}

const voiceDestination = (held: unknown): IVoiceDestination =>
  held === "server" || held === "off" ? held : null;

export function readPreferences(): IPreferences {
  const sort = readJson(KEYS.ProjectSort);
  const usage = readJson(USAGE_KEY) as { metric?: unknown; windowDays?: unknown } | undefined;
  return {
    GroupByProject: readJson(KEYS.GroupByProject) !== false,
    ClosedFolders: ids(readJson(KEYS.ClosedFolders)),
    ProjectSort: isProjectSort(sort) ? sort : "manual",
    ProjectOrder: ids(readJson(KEYS.ProjectOrder)),
    HiddenProjects: ids(readJson(KEYS.HiddenProjects)),
    ProjectScope: ids(readJson(KEYS.ProjectScope)),
    SidebarCollapsed: readJson(KEYS.SidebarCollapsed) === true,
    CompactionDismissed: ids(readJson(KEYS.CompactionDismissed)),
    AppearanceMode: storedAppearanceMode(),
    Usage: {
      Metric: typeof usage?.metric === "string" ? usage.metric : "limits",
      Days: typeof usage?.windowDays === "number" ? usage.windowDays : 30,
    },
    VoiceDestination: voiceDestination(readJson(KEYS.VoiceDestination)),
  };
}

export function writePreferences(patch: Partial<IPreferences>) {
  for (const [field, value] of Object.entries(patch) as [keyof IPreferences, unknown][]) {
    if (field === "AppearanceMode") write(APPEARANCE_MODE_KEY, value as string);
    else if (field === "Usage") {
      const usage = value as IPreferences["Usage"];
      write(USAGE_KEY, JSON.stringify({ metric: usage.Metric, windowDays: usage.Days }));
    } else write(KEYS[field], JSON.stringify(value));
  }
}

export const storedPreferencesImpl = implementation(storedPreferencesEffect, readPreferences);

export const storePreferencesImpl = implementation(storePreferencesEffect, (effect) =>
  writePreferences(effect.Patch),
);

export const storedEditorImpl = implementation(storedEditorEffect, () => {
  const held = readJson(EDITOR_KEY);
  return typeof held === "string" ? held : null;
});

export const storeEditorImpl = implementation(storeEditorEffect, (effect) =>
  write(EDITOR_KEY, JSON.stringify(effect.Editor)),
);

export const clockNowImpl = implementation(clockNowEffect, clockNow);
