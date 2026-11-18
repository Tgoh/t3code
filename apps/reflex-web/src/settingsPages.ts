import {
  globalIdleCompaction,
  IDLE_COMPACTION_MODES,
  idleCompactionPatch,
  readsIdleCompactionModes,
} from "@t3tools/contracts";

import type {
  IWireClientSettings,
  IWireServerSettings,
  IWireSettingsPatch,
} from "./Infrastructure/settings";

// Follows the nav in apps/web/src/components/settings/settingsSearch.ts and SettingsSidebarNav.tsx.
export const SETTINGS_NAV = [
  {
    Group: null,
    Pages: [
      { Id: "general", Label: "General", Icon: "Settings2", Built: true },
      { Id: "appearance", Label: "Appearance", Icon: "Palette", Built: true },
      { Id: "chat", Label: "Chat", Icon: "MessageSquareText", Built: true },
      { Id: "diffs", Label: "Diffs & pull requests", Icon: "FileDiff", Built: false },
      { Id: "keybindings", Label: "Keybindings", Icon: "Keyboard", Built: true },
      { Id: "voice", Label: "Voice", Icon: "Mic", Built: true },
      { Id: "snap-shot", Label: "SnapShots", Icon: "Camera", Built: false },
    ],
  },
  {
    Group: "Agents",
    Pages: [
      { Id: "providers", Label: "Providers", Icon: "Bot", Built: true },
      { Id: "threads", Label: "Threads", Icon: "MessagesSquare", Built: true },
      { Id: "browser", Label: "Browser", Icon: "Globe", Built: false },
      { Id: "devices", Label: "Devices", Icon: "Smartphone", Built: false },
      { Id: "scheduled-tasks", Label: "Scheduled tasks", Icon: "CalendarClock", Built: false },
    ],
  },
  {
    Group: "Code",
    Pages: [
      { Id: "projects", Label: "Projects", Icon: "PanelsTopLeft", Built: true },
      { Id: "source-control", Label: "Source control", Icon: "GitBranch", Built: false },
      { Id: "worktrees", Label: "Worktrees", Icon: "FolderTree", Built: false },
    ],
  },
  {
    Group: "Connections",
    Pages: [
      { Id: "connections", Label: "Environments", Icon: "Server", Built: false },
      { Id: "access", Label: "Sharing & access", Icon: "ShieldCheck", Built: false },
      { Id: "secrets", Label: "Secrets", Icon: "KeyRound", Built: false },
    ],
  },
  {
    Group: null,
    Pages: [
      { Id: "maintenance", Label: "Maintenance", Icon: "Wrench", Built: false },
      { Id: "labs", Label: "Labs", Icon: "FlaskConical", Built: false },
      { Id: "about", Label: "About", Icon: "Info", Built: true },
      { Id: "archived", Label: "Archive", Icon: "Archive", Built: true },
    ],
  },
] as const;

export type ISettingsNavPage = (typeof SETTINGS_NAV)[number]["Pages"][number];
export type ISettingsPageId = ISettingsNavPage["Id"];
export const DEFAULT_SETTINGS_PAGE: ISettingsPageId = "general";

const NAV_PAGES = SETTINGS_NAV.flatMap((group): readonly ISettingsNavPage[] => group.Pages);

export const settingsPageOf = (id: string): ISettingsNavPage | null =>
  NAV_PAGES.find((page) => page.Id === id) ?? null;

export const builtSettingsPage = (id: string | null): ISettingsPageId =>
  id !== null && settingsPageOf(id)?.Built === true
    ? (id as ISettingsPageId)
    : DEFAULT_SETTINGS_PAGE;

export type ISettingValue = string | boolean | number;

export type ISettingControl =
  | { Kind: "switch" }
  | {
      Kind: "select";
      Options: ReadonlyArray<{
        Value: string;
        Label: string;
        Disabled?: (held: ISettingsHeld) => boolean;
      }>;
      /** Labels too long for a phone row wrap there instead of being cut off. */
      Wrap?: boolean;
    }
  | { Kind: "text"; Placeholder: string }
  | { Kind: "textarea"; Placeholder: string }
  | { Kind: "number"; Min: number; Max: number };

export interface ISettingsHeld {
  Server: IWireServerSettings | null;
  Client: IWireClientSettings;
}

export type ISettingWrite =
  | { Store: "server"; Patch: IWireSettingsPatch }
  | { Store: "client"; Patch: Partial<IWireClientSettings> };

export interface ISettingRow {
  Id: string;
  Title: string;
  Description: string;
  Control: ISettingControl;
  /** False where stock reads the setting but this client doesn't act on it yet. */
  Applied: boolean;
  Read: (held: ISettingsHeld) => ISettingValue | null;
  Write: (value: ISettingValue, held: ISettingsHeld) => ISettingWrite;
  Visible?: (held: ISettingsHeld) => boolean;
  /** Where set, the row offers a reset while its value differs. */
  Default?: ISettingValue;
}

export interface ISettingsSection {
  Title: string;
  Rows: ISettingRow[];
}

type IClientKey = keyof IWireClientSettings;
type IServerKey = keyof IWireServerSettings & keyof IWireSettingsPatch;

const options = (entries: Record<string, string>) =>
  Object.entries(entries).map(([Value, Label]) => ({ Value, Label }));

function clientRow(
  key: IClientKey,
  row: Omit<ISettingRow, "Read" | "Write" | "Applied"> & { Applied?: boolean },
): ISettingRow {
  return {
    Applied: false,
    ...row,
    Read: (held) => (held.Client[key] as ISettingValue | undefined) ?? null,
    Write: (value) => ({ Store: "client", Patch: { [key]: value } }),
  };
}

function serverRow(
  key: IServerKey,
  row: Omit<ISettingRow, "Read" | "Write" | "Applied"> & { Applied?: boolean },
  nullValue?: string,
): ISettingRow {
  return {
    Applied: true,
    ...row,
    Read: (held) => {
      if (held.Server === null) return null;
      const value = held.Server[key] as ISettingValue | null | undefined;
      return value === null || value === undefined ? (nullValue ?? null) : value;
    },
    Write: (value) => ({
      Store: "server",
      Patch: { [key]: nullValue !== undefined && value === nullValue ? null : value },
    }),
  };
}

const switchControl = { Kind: "switch" } as const;

// Follows GeneralSettingsPanel in apps/web/src/components/settings/SettingsPanels.tsx.
const GENERAL: ISettingsSection[] = [
  {
    Title: "Notifications",
    Rows: [
      clientRow("notificationMode", {
        Id: "notificationMode",
        Title: "Thread notifications",
        Description:
          "System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while T3 Code is open.",
        Control: {
          Kind: "select",
          Options: options({
            off: "Off",
            notifications: "Notifications only",
            sound: "Sound only",
            "notifications-and-sound": "Notifications with sound",
          }),
        },
      }),
      clientRow("inAppNotificationsEnabled", {
        Id: "inAppNotificationsEnabled",
        Title: "In-app notifications",
        Description:
          "Show a toast when another thread finishes, fails, or needs input or approval while this app has focus.",
        Control: switchControl,
      }),
    ],
  },
  {
    Title: "Sidebar",
    Rows: [
      {
        Id: "sidebarProjectGroupingMode",
        Title: "Project grouping",
        Description: "Combine matching repositories across environments.",
        Control: switchControl,
        Applied: false,
        Read: (held) => held.Client.sidebarProjectGroupingMode !== "separate",
        // Stock restores the last enabled mode it remembers; "repository" is its default.
        Write: (value) => ({
          Store: "client",
          Patch: { sidebarProjectGroupingMode: value === true ? "repository" : "separate" },
        }),
      },
      clientRow("sidebarProjectSortOrder", {
        Id: "sidebarProjectSortOrder",
        Title: "Project order",
        Description: "Order of projects in the sidebar project picker and command palette.",
        Control: {
          Kind: "select",
          Options: options({
            updated_at: "Last user message",
            created_at: "Created at",
            manual: "Manual",
          }),
        },
      }),
      clientRow("sidebarWorkingShelfEnabled", {
        Id: "sidebarWorkingShelfEnabled",
        Title: "Working section",
        Description:
          "Fold working and monitoring threads into a Working section. They return to the top of the inbox when they need you. The boring sidebar in Labs has no Working section.",
        Control: switchControl,
      }),
    ],
  },
  {
    Title: "Confirmations",
    Rows: [
      clientRow("confirmThreadUnpin", {
        Id: "confirmThreadUnpin",
        Title: "Unpin confirmation",
        Description: "Ask before unpinning a thread from the pinned section.",
        Control: switchControl,
      }),
      clientRow("confirmThreadArchive", {
        Id: "confirmThreadArchive",
        Title: "Archive confirmation",
        Description:
          "Require a second click on the inline archive action before a thread is archived.",
        Control: switchControl,
      }),
      clientRow("confirmThreadDelete", {
        Id: "confirmThreadDelete",
        Title: "Delete confirmation",
        Description: "Ask before deleting a thread and its chat history.",
        Control: switchControl,
      }),
    ],
  },
  {
    Title: "Display",
    Rows: [
      clientRow("timestampFormat", {
        Id: "timestampFormat",
        Title: "Time format",
        Description: "System default follows your browser or OS clock preference.",
        Control: {
          Kind: "select",
          Options: options({
            locale: "System default",
            "12-hour": "12-hour",
            "24-hour": "24-hour",
          }),
        },
      }),
    ],
  },
];

// Follows AppearanceSettingsPanel.tsx; the color scheme sits above these in its own control.
const APPEARANCE: ISettingsSection[] = [
  {
    Title: "Interface",
    Rows: [
      clientRow("chatWidth", {
        Id: "chatWidth",
        Title: "Chat width",
        Description: "Set how wide messages and the composer can grow on large screens.",
        Control: {
          Kind: "select",
          Options: options({ comfortable: "Comfortable", wide: "Wide", full: "Full" }),
        },
      }),
      clientRow("effortDisplay", {
        Id: "effortDisplay",
        Title: "Effort display",
        Description: "Show reasoning effort in the composer as its name, such as High, or as bars.",
        Control: { Kind: "select", Options: options({ label: "Word", bars: "Bars" }) },
      }),
      clientRow("mathRenderingEnabled", {
        Id: "mathRenderingEnabled",
        Title: "Render math",
        Description:
          "Typeset LaTeX math, such as $x^2$ or \\[x^2\\], in messages and Markdown previews. The composer keeps TeX source editable.",
        Control: switchControl,
      }),
      clientRow("wordWrap", {
        Id: "wordWrap",
        Title: "Word wrap",
        Description: "Wrap long lines in code blocks, diffs, and file previews by default.",
        Control: switchControl,
      }),
    ],
  },
];

// Follows ChatSettingsPanel in SettingsPanels.tsx.
const CHAT: ISettingsSection[] = [
  {
    Title: "Composer",
    Rows: [
      clientRow("composerRichTextEnabled", {
        Id: "composerRichTextEnabled",
        Title: "Rich text composer",
        Description: "Show formatted Markdown as you type.",
        Control: switchControl,
      }),
      clientRow("sendShortcut", {
        Id: "sendShortcut",
        Title: "Send shortcut",
        Description: "Choose when Enter sends a prompt or inserts a new line",
        Control: {
          Kind: "select",
          Options: options({
            enter: "Enter",
            "mod-enter-multiline": "Ctrl + Enter for multiline prompts",
            "mod-enter": "Ctrl + Enter always",
          }),
          Wrap: true,
        },
      }),
      clientRow("showSkillsInSlashMenu", {
        Id: "showSkillsInSlashMenu",
        Title: "Show skills in slash menu",
        Description:
          "Also include skills in the / command menu. Skills always appear when you type $.",
        Control: switchControl,
      }),
    ],
  },
  {
    Title: "Follow-ups",
    Rows: [
      clientRow("followUpBehavior", {
        Id: "followUpBehavior",
        Title: "Follow-up behavior",
        Description: "Queue follow-ups while the agent runs or steer the current run.",
        Control: { Kind: "select", Options: options({ queue: "Queue", steer: "Steer" }) },
        Applied: true,
      }),
    ],
  },
  {
    Title: "Activity",
    Rows: [
      clientRow("toolCallVisibility", {
        Id: "toolCallVisibility",
        Title: "Tool calls in chat",
        Description:
          "Hide the commands, edits, and searches agents run. Hide successful keeps failures. Zen shows only final answers. Approvals, questions, and errors always show.",
        Control: {
          Kind: "select",
          Options: options({
            showAll: "Show all",
            hideSuccessful: "Hide successful",
            hideAll: "Hide all",
            zen: "Zen",
          }),
        },
      }),
    ],
  },
  {
    Title: "Screen reader",
    Rows: [
      clientRow("screenReaderAnnouncements", {
        Id: "screenReaderAnnouncements",
        Title: "Screen reader announcements",
        Description:
          "What a screen reader hears from the open thread: a turn starting, needing you, and ending. Status and messages adds what the agent writes before its last message. Everything adds each step.",
        Control: {
          Kind: "select",
          Options: options({
            status: "Status only",
            messages: "Status and messages",
            everything: "Everything",
          }),
        },
      }),
      clientRow("screenReaderWindowTitle", {
        Id: "screenReaderWindowTitle",
        Title: "Screen reader window title",
        Description:
          "Start the window title with the thread's status, like Needs approval, and its name, so screen readers read them first when you switch apps. Taskbars, shared screens, and time trackers see it too.",
        Control: switchControl,
      }),
    ],
  },
];

const DEFAULT_AUTO_SETTLE_DAYS = 7;
const autoSettleOn = (held: ISettingsHeld) =>
  held.Server !== null && held.Server.sidebarAutoSettleAfterDays != null;

// Follows ThreadsSettingsPanel in SettingsPanels.tsx, leaving out its model pickers and snooze presets.
const THREADS: ISettingsSection[] = [
  {
    Title: "New projects",
    Rows: [
      serverRow("addProjectBaseDirectory", {
        Id: "addProjectBaseDirectory",
        Title: "Add project starts in",
        Description: 'Leave empty to use "~/" when the Add Project browser opens.',
        Control: { Kind: "text", Placeholder: "~/" },
      }),
      serverRow("ghqCloneLayout", {
        Id: "ghqCloneLayout",
        Title: "Clone into host folders",
        Description: "Clones go to github.com/owner/repo under the folder above, like ghq.",
        Control: switchControl,
      }),
    ],
  },
  {
    Title: "New threads",
    Rows: [
      serverRow("defaultRuntimeMode", {
        Id: "defaultRuntimeMode",
        Title: "Permissions",
        Description: "Default permissions for new threads. Projects can override them.",
        Control: {
          Kind: "select",
          Options: options({
            "approval-required": "Supervised",
            "auto-accept-edits": "Auto-accept edits",
            auto: "Auto",
            "full-access": "Full access",
          }),
        },
      }),
      serverRow(
        "defaultThreadEnvMode",
        {
          Id: "defaultThreadEnvMode",
          Title: "Workspace",
          Description: "Where new threads start. Projects and their t3.json can override it.",
          Control: {
            Kind: "select",
            Options: options({
              "": "Default",
              local: "Current checkout",
              worktree: "New worktree",
            }),
          },
        },
        "",
      ),
    ],
  },
  {
    Title: "Usage limits",
    Rows: [
      serverRow("autoResumeLimitedThreads", {
        Id: "autoResumeLimitedThreads",
        Title: "Resume after usage limits",
        Description:
          "Automatically resume threads when their usage limits reset. You can cancel auto-resume in each thread.",
        Control: switchControl,
      }),
      serverRow("snoozeLimitedThreads", {
        Id: "snoozeLimitedThreads",
        Title: "Snooze until limits reset",
        Description:
          "Snooze threads until their usage limits reset. Enable auto-resume to continue the agent after the reset.",
        Control: switchControl,
      }),
    ],
  },
  {
    Title: "Auto-settle",
    Rows: [
      serverRow("sidebarAutoSettleOnMerge", {
        Id: "sidebarAutoSettleOnMerge",
        Title: "Auto-settle merged threads",
        Description:
          "Settle a thread when its pull request merges. Closed pull requests still settle automatically.",
        Control: switchControl,
      }),
      {
        Id: "sidebarAutoSettleEnabled",
        Title: "Auto-settle inactive threads",
        Description: "Sidebar threads with no activity for this long settle automatically.",
        Control: switchControl,
        Applied: true,
        Read: (held) => (held.Server === null ? null : autoSettleOn(held)),
        Write: (value) => ({
          Store: "server",
          Patch: { sidebarAutoSettleAfterDays: value === true ? DEFAULT_AUTO_SETTLE_DAYS : null },
        }),
      },
      {
        Id: "sidebarAutoSettleAfterDays",
        Title: "Days of inactivity before auto-settle",
        Description: "Any new activity un-settles a thread automatically.",
        Control: { Kind: "number", Min: 1, Max: 90 },
        Applied: true,
        Visible: autoSettleOn,
        Read: (held) => held.Server?.sidebarAutoSettleAfterDays ?? null,
        Write: (value) => ({
          Store: "server",
          Patch: {
            sidebarAutoSettleAfterDays: Math.min(90, Math.max(1, Math.round(Number(value)))),
          },
        }),
      },
      {
        ...serverRow("sidebarAutoSettleKeepPullRequests", {
          Id: "sidebarAutoSettleKeepPullRequests",
          Title: "Keep threads with a PR",
          Description:
            "Inactivity does not settle threads with a pull request. Merge and close still do.",
          Control: switchControl,
        }),
        Visible: autoSettleOn,
      },
    ],
  },
  {
    Title: "Text generation",
    Rows: [
      serverRow("threadTitleInstructions", {
        Id: "threadTitleInstructions",
        Title: "Thread title instructions",
        Description: "Appended to the prompt for new and regenerated thread titles.",
        Control: {
          Kind: "textarea",
          Placeholder: "Keep titles to a few words. Lead with the main subject.",
        },
      }),
      serverRow("responseStreamingMode", {
        Id: "responseStreamingMode",
        Title: "Response streaming",
        Description: "Each paragraph or code block appears as soon as it is complete.",
        Control: {
          Kind: "select",
          Options: options({
            turn: "Wait for the full response",
            paragraph: "Show finished paragraphs",
          }),
        },
      }),
    ],
  },
];

// Follows the transcription rows of apps/web/src/components/settings/VoiceSettingsPanel.tsx.
const VOICE: ISettingsSection[] = [
  {
    Title: "Transcription",
    Rows: [
      clientRow("speechStreaming", {
        Id: "speechStreaming",
        Title: "Streaming transcription",
        Description:
          "Transcribe while recording, on models that support it. Turn off to transcribe after stopping, which may help when live transcription falls behind.",
        Control: switchControl,
        Applied: true,
      }),
      clientRow("speechTranslateToEnglish", {
        Id: "speechTranslateToEnglish",
        Title: "Translate to English",
        Description: "Speak any language and get English text, on models that translate.",
        Control: switchControl,
        Applied: true,
      }),
      clientRow("speechSilenceFiltering", {
        Id: "speechSilenceFiltering",
        Title: "Silence filtering",
        Description: "Skip silence and background noise before transcribing.",
        Control: switchControl,
        Applied: true,
      }),
      clientRow("speechRemoveFillerWords", {
        Id: "speechRemoveFillerWords",
        Title: "Remove filler words",
        Description: "Drop “um” and “uh” from transcripts.",
        Control: switchControl,
        Applied: true,
      }),
    ],
  },
];

const DEFAULT_IDLE_COMPACTION = globalIdleCompaction({ compactIdleThreads: false });

// Follows ScopedCompactIdleThreadsRow in SettingsPanels.tsx, which the Providers panel renders.
const PROVIDERS: ISettingsSection[] = [
  {
    Title: "Advanced",
    Rows: [
      {
        Id: "idleCompaction",
        Title: "Compact idle threads",
        Description:
          "When to compact an idle Claude thread over 200,000 tokens: after you return, just before its prompt cache expires, or never. Each Claude provider can override this.",
        Control: {
          Kind: "select",
          Options: IDLE_COMPACTION_MODES.map((mode) => ({
            Value: mode.value,
            Label: mode.label,
            // A server from before modes has only the on/off switch, so it cannot store "Never".
            ...(mode.value === "off"
              ? {
                  Disabled: (held: ISettingsHeld) =>
                    held.Server !== null && !readsIdleCompactionModes(held.Server),
                }
              : {}),
          })),
          Wrap: true,
        },
        Applied: true,
        Default: DEFAULT_IDLE_COMPACTION,
        Read: (held) => (held.Server === null ? null : globalIdleCompaction(held.Server)),
        Write: (value, held) => {
          const mode = IDLE_COMPACTION_MODES.find((entry) => entry.value === value)?.value;
          return {
            Store: "server",
            Patch:
              mode === undefined || held.Server === null
                ? {}
                : idleCompactionPatch(held.Server, mode),
          };
        },
      },
    ],
  },
];

export const SETTINGS_SECTIONS = {
  general: GENERAL,
  appearance: APPEARANCE,
  chat: CHAT,
  threads: THREADS,
  voice: VOICE,
  providers: PROVIDERS,
} as const satisfies Partial<Record<ISettingsPageId, ISettingsSection[]>>;

export interface ISettingsSearchItem {
  Id: string;
  Title: string;
  Page: ISettingsPageId;
  Text: string;
}

// The rows built outside SETTINGS_SECTIONS, so search finds them too.
const OTHER_SEARCH_ITEMS: Array<Omit<ISettingsSearchItem, "Text"> & { Description: string }> = [
  {
    Id: "colorScheme",
    Title: "Color scheme",
    Page: "appearance",
    Description: "System light dark theme",
  },
  { Id: "providers", Title: "Providers", Page: "providers", Description: "Enable provider status" },
  { Id: "models", Title: "Models", Page: "providers", Description: "Hide reorder favorite filter" },
  { Id: "projectName", Title: "Name", Page: "projects", Description: "Project name" },
  { Id: "projectPin", Title: "Pin", Page: "projects", Description: "Pinned projects" },
  { Id: "projectArchive", Title: "Archive", Page: "projects", Description: "Archive project" },
  { Id: "removeProject", Title: "Remove project", Page: "projects", Description: "Delete" },
  { Id: "keybindings", Title: "Keybindings", Page: "keybindings", Description: "Shortcuts keys" },
  {
    Id: "voiceDestination",
    Title: "Transcribe with",
    Page: "voice",
    Description: "Microphone dictation speech audio destination",
  },
  { Id: "voiceModel", Title: "Model", Page: "voice", Description: "Speech transcription download" },
  { Id: "archivedThreads", Title: "Archived threads", Page: "archived", Description: "Unarchive" },
  { Id: "version", Title: "Version", Page: "about", Description: "Current version" },
  { Id: "privacyPolicy", Title: "Privacy policy", Page: "about", Description: "Legal" },
];

export function settingsSearchItems(): ISettingsSearchItem[] {
  const rows = Object.entries(SETTINGS_SECTIONS).flatMap(([page, sections]) =>
    sections.flatMap((section) =>
      section.Rows.map((row) => ({
        Id: row.Id,
        Title: row.Title,
        Page: page as ISettingsPageId,
        Description: `${section.Title} ${row.Description}`,
      })),
    ),
  );
  return [...rows, ...OTHER_SEARCH_ITEMS].map((item) => ({
    Id: item.Id,
    Title: item.Title,
    Page: item.Page,
    Text: `${item.Title} ${item.Description} ${settingsPageOf(item.Page)?.Label ?? ""}`.toLowerCase(),
  }));
}

/** Title matches first, then any word of the row, its section or its page. */
export function searchSettings(items: ISettingsSearchItem[], query: string): ISettingsSearchItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const matches = items.filter((item) => words.every((word) => item.Text.includes(word)));
  const titled = (item: ISettingsSearchItem) =>
    words.every((word) => item.Title.toLowerCase().includes(word)) ? 0 : 1;
  return matches.toSorted((left, right) => titled(left) - titled(right));
}

export const settingRows = (): ISettingRow[] =>
  Object.values(SETTINGS_SECTIONS).flatMap((sections) =>
    sections.flatMap((section) => section.Rows),
  );
