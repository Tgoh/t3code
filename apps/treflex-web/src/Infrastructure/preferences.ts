import { defineEffect, type IEffect, implementation } from "treflex";

import { type IAppearanceMode, isAppearanceMode } from "../colorScheme";
import { clockNow } from "../timestamps";

/** This device's choices. Each field keeps the localStorage key and value shape it always had. */
export interface IPreferences {
  GroupByProject: boolean;
  ClosedFolders: string[];
  ProjectOrder: string[];
  HiddenProjects: string[];
  ProjectScope: string[];
  SidebarCollapsed: boolean;
  /** The dragged width in pixels, or null for the default. */
  SidebarWidth: number | null;
  /** The details card is pinned beside the chat where it fits, in every thread. */
  DetailsOpen: boolean;
  /** `environment:instance` keys of providers whose resume compaction was answered "Don't ask again". */
  CompactionDismissed: string[];
  AppearanceMode: IAppearanceMode;
  Usage: { Metric: string; Days: number };
  /** Where dictated audio goes: this client's server, nowhere, or not yet chosen. */
  VoiceDestination: IVoiceDestination;
  /** The Files preview shows a Markdown file rendered rather than as source. */
  RenderMarkdown: boolean;
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
  { settles: "sync" },
);
export const storePreferencesEffect = defineEffect<IStorePreferencesEffect, void>(
  "storePreferences",
);
export const storedEditorEffect = defineEffect<IStoredEditorEffect, string | null>("storedEditor", {
  settles: "sync",
});
export const storeEditorEffect = defineEffect<IStoreEditorEffect, void>("storeEditor");
export const clockNowEffect = defineEffect<IClockNowEffect, number>("clockNow", {
  settles: "sync",
});

// The theme, usage, editor, sidebar width and rendered Markdown keys are stock's
// (THEME_APPEARANCE_MODE_STORAGE_KEY, usagePagePreferences.ts, editorPreferences.ts,
// THREAD_SIDEBAR_WIDTH_STORAGE_KEY, RENDER_MARKDOWN_STORAGE_KEY), so a browser on stock's origin
// reads the same values.
export const APPEARANCE_MODE_KEY = "t3code:theme-appearance-mode";
const USAGE_KEY = "t3code:usage-page-preferences:v1";
const EDITOR_KEY = "t3code:last-editor";
const SIDEBAR_WIDTH_KEY = "chat_thread_sidebar_width";
// Named before the client became treflex; renaming them would drop every stored value.
const KEYS = {
  GroupByProject: "reflex-web:group-by-project",
  ClosedFolders: "reflex-web:closed-folders",
  ProjectOrder: "reflex-web:project-order",
  HiddenProjects: "reflex-web:hidden-projects",
  ProjectScope: "reflex-web:project-scope",
  SidebarCollapsed: "reflex-web:sidebar-collapsed",
  DetailsOpen: "reflex-web:details-open",
  VoiceDestination: "reflex-web:voice-destination",
  CompactionDismissed: "reflex-web:compaction-dismissed",
  RenderMarkdown: "t3code.renderMarkdown",
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

function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // As for write.
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
  const usage = readJson(USAGE_KEY) as { metric?: unknown; windowDays?: unknown } | undefined;
  const width = readJson(SIDEBAR_WIDTH_KEY);
  return {
    GroupByProject: readJson(KEYS.GroupByProject) !== false,
    ClosedFolders: ids(readJson(KEYS.ClosedFolders)),
    ProjectOrder: ids(readJson(KEYS.ProjectOrder)),
    HiddenProjects: ids(readJson(KEYS.HiddenProjects)),
    ProjectScope: ids(readJson(KEYS.ProjectScope)),
    SidebarCollapsed: readJson(KEYS.SidebarCollapsed) === true,
    SidebarWidth: typeof width === "number" && Number.isFinite(width) ? width : null,
    // Open by default, as DEFAULT_THREAD_PANEL_VISIBILITY in apps/web/src/rightPanelStore.ts.
    DetailsOpen: readJson(KEYS.DetailsOpen) !== false,
    CompactionDismissed: ids(readJson(KEYS.CompactionDismissed)),
    AppearanceMode: storedAppearanceMode(),
    Usage: {
      Metric: typeof usage?.metric === "string" ? usage.metric : "limits",
      Days: typeof usage?.windowDays === "number" ? usage.windowDays : 30,
    },
    VoiceDestination: voiceDestination(readJson(KEYS.VoiceDestination)),
    RenderMarkdown: readJson(KEYS.RenderMarkdown) === true,
  };
}

export function writePreferences(patch: Partial<IPreferences>) {
  for (const [field, value] of Object.entries(patch) as [keyof IPreferences, unknown][]) {
    if (field === "AppearanceMode") write(APPEARANCE_MODE_KEY, value as string);
    else if (field === "Usage") {
      const usage = value as IPreferences["Usage"];
      write(USAGE_KEY, JSON.stringify({ metric: usage.Metric, windowDays: usage.Days }));
    } else if (field === "SidebarWidth") {
      if (value === null) remove(SIDEBAR_WIDTH_KEY);
      else write(SIDEBAR_WIDTH_KEY, JSON.stringify(value));
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
