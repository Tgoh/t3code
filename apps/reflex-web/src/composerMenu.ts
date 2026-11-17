import {
  dedupeProviderSkillsByName,
  getProviderSkillsForSlashMenu,
  getProviderSlashCommandsForSlashMenu,
  isProviderSkillUserInvocable,
} from "@t3tools/client-runtime/providerSkills";
import type { ServerProviderSkill, ServerProviderSlashCommand } from "@t3tools/contracts";
import {
  type ComposerTrigger,
  detectComposerTrigger,
  replaceTextRange,
  serializeComposerFileLink,
} from "@t3tools/shared/composerTrigger";
import { formatProviderSkillDisplayName } from "@t3tools/shared/inlineSkills";
import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
} from "@t3tools/shared/searchRanking";

export type IMenuTrigger = ComposerTrigger & { kind: "path" | "slash-command" | "skill" };

export interface IMenuItem {
  Id: string;
  Kind: "file" | "directory" | "command" | "skill";
  Label: string;
  Description: string;
  Insert: string;
}

export interface IProjectEntry {
  path: string;
  kind: "file" | "directory";
}

export const MENU_PLACEHOLDER = "Ask anything. @ files, $ skills, / commands";

export const FILE_SEARCH_LIMIT = 80;

/** The menu the caret is in, if any. The client has no pull request menu, so `#` opens none. */
export function menuTrigger(text: string, cursor: number): IMenuTrigger | null {
  const trigger = detectComposerTrigger(text, cursor);
  return trigger === null || trigger.kind === "pull-request" ? null : (trigger as IMenuTrigger);
}

const basename = (path: string) =>
  path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
const dirname = (path: string) =>
  path.slice(0, Math.max(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))));

// Follows the path items in apps/web/src/components/chat/useComposerMenuItems.ts.
export function fileItems(entries: ReadonlyArray<IProjectEntry>): IMenuItem[] {
  return entries.map((entry) => ({
    Id: `path:${entry.kind}:${entry.path}`,
    Kind: entry.kind,
    Label: basename(entry.path),
    Description: dirname(entry.path),
    Insert: `${serializeComposerFileLink(entry.path)} `,
  }));
}

// Follows scoreProviderSkill in apps/web/src/providerSkillSearch.ts.
function scoreSkill(skill: ServerProviderSkill, query: string): number | null {
  const scores = [
    scoreQueryMatch({
      value: skill.name.toLowerCase(),
      query,
      exactBase: 0,
      prefixBase: 2,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 100,
      boundaryMarkers: ["-", "_", "/"],
    }),
    scoreQueryMatch({
      value: formatProviderSkillDisplayName(skill).toLowerCase(),
      query,
      exactBase: 1,
      prefixBase: 3,
      boundaryBase: 5,
      includesBase: 7,
      fuzzyBase: 110,
    }),
    scoreQueryMatch({
      value: skill.shortDescription?.toLowerCase() ?? "",
      query,
      exactBase: 20,
      prefixBase: 22,
      boundaryBase: 24,
      includesBase: 26,
    }),
    scoreQueryMatch({
      value: skill.description?.toLowerCase() ?? "",
      query,
      exactBase: 30,
      prefixBase: 32,
      boundaryBase: 34,
      includesBase: 36,
    }),
    scoreQueryMatch({
      value: skill.scope?.toLowerCase() ?? "",
      query,
      exactBase: 40,
      prefixBase: 42,
      includesBase: 44,
    }),
  ].filter((score) => score !== null);
  return scores.length === 0 ? null : Math.min(...scores);
}

const skillDescription = (skill: ServerProviderSkill) =>
  skill.shortDescription ?? skill.description ?? (skill.scope ? `${skill.scope} skill` : "");

const skillItem = (skill: ServerProviderSkill, label: string): IMenuItem => ({
  Id: `skill:${skill.name}`,
  Kind: "skill",
  Label: label,
  Description: skillDescription(skill),
  Insert: `$${skill.name} `,
});

// Follows searchProviderSkills in apps/web/src/providerSkillSearch.ts.
export function skillItems(skills: ReadonlyArray<ServerProviderSkill>, query: string): IMenuItem[] {
  const enabled = dedupeProviderSkillsByName(skills.filter(isProviderSkillUserInvocable));
  const normalized = normalizeSearchQuery(query, { trimLeadingPattern: /^\p{Sc}+/u });
  const ranked: Array<{ item: ServerProviderSkill; score: number; tieBreaker: string }> = [];
  for (const skill of enabled) {
    const score = normalized ? scoreSkill(skill, normalized) : 0;
    if (score === null) continue;
    insertRankedSearchResult(
      ranked,
      {
        item: skill,
        score,
        tieBreaker: `${formatProviderSkillDisplayName(skill).toLowerCase()}\u0000${skill.name}`,
      },
      Number.POSITIVE_INFINITY,
    );
  }
  return (normalized ? ranked.map((entry) => entry.item) : enabled).map((skill) =>
    skillItem(skill, formatProviderSkillDisplayName(skill)),
  );
}

type ISlashEntry =
  | { Kind: "command"; Command: ServerProviderSlashCommand }
  | { Kind: "skill"; Skill: ServerProviderSkill };

function scoreSlash(entry: ISlashEntry, query: string): number | null {
  if (entry.Kind === "skill") {
    if (query === "skill") return 0;
    const skillQuery = query.startsWith("skill:") ? query.slice("skill:".length) : query;
    const score = skillQuery ? scoreSkill(entry.Skill, skillQuery) : 0;
    if (score !== null) return score;
    return "skill".startsWith(query) ? Number.MAX_SAFE_INTEGER : null;
  }
  const command = entry.Command;
  const scores = [
    scoreQueryMatch({
      value: command.name.toLowerCase(),
      query,
      exactBase: 0,
      prefixBase: 2,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 100,
      boundaryMarkers: ["-", "_", "/"],
    }),
    scoreQueryMatch({
      value: (command.description ?? "").toLowerCase(),
      query,
      exactBase: 20,
      prefixBase: 22,
      boundaryBase: 24,
      includesBase: 26,
    }),
  ].filter((score) => score !== null);
  return scores.length === 0 ? null : Math.min(...scores);
}

/**
 * Follows the slash items in apps/web/src/components/chat/useComposerMenuItems.ts and
 * searchSlashCommandItems in composerSlashCommandSearch.ts. Provider commands work only at the
 * start of the message; skills work anywhere.
 */
export function slashItems(
  commands: ReadonlyArray<ServerProviderSlashCommand>,
  skills: ReadonlyArray<ServerProviderSkill>,
  query: string,
  atPromptStart: boolean,
): IMenuItem[] {
  const menuSkills = getProviderSkillsForSlashMenu(skills, true);
  const entries: ISlashEntry[] = [
    ...(atPromptStart
      ? getProviderSlashCommandsForSlashMenu(commands, menuSkills).map((command): ISlashEntry => ({
          Kind: "command",
          Command: command,
        }))
      : []),
    ...menuSkills.map((skill): ISlashEntry => ({ Kind: "skill", Skill: skill })),
  ];
  const normalized = normalizeSearchQuery(query, { trimLeadingPattern: /^\/+/ });
  let matched = entries;
  if (normalized) {
    const ranked: Array<{ item: ISlashEntry; score: number; tieBreaker: string }> = [];
    for (const entry of entries) {
      const score = scoreSlash(entry, normalized);
      if (score === null) continue;
      insertRankedSearchResult(
        ranked,
        {
          item: entry,
          score,
          tieBreaker:
            entry.Kind === "command"
              ? `1\u0000${entry.Command.name}`
              : `2\u0000${entry.Skill.name}`,
        },
        Number.POSITIVE_INFINITY,
      );
    }
    matched = ranked.map((entry) => entry.item);
  }
  return matched.map((entry) =>
    entry.Kind === "skill"
      ? skillItem(entry.Skill, `/skill:${entry.Skill.name}`)
      : {
          Id: `command:${entry.Command.name}`,
          Kind: "command",
          Label: `/${entry.Command.name}`,
          Description:
            entry.Command.description ?? entry.Command.input?.hint ?? "Run provider command",
          Insert: `/${entry.Command.name} `,
        },
  );
}

/** Replaces the trigger's token with the pick, swallowing one space already after it. */
export function applyMenuItem(
  text: string,
  trigger: IMenuTrigger,
  insert: string,
): { Text: string; Cursor: number } {
  const end =
    insert.endsWith(" ") && text[trigger.rangeEnd] === " "
      ? trigger.rangeEnd + 1
      : trigger.rangeEnd;
  const { text: next, cursor } = replaceTextRange(text, trigger.rangeStart, end, insert);
  return { Text: next, Cursor: cursor };
}

export const MENU_EMPTY: Record<IMenuTrigger["kind"], string> = {
  path: "No matching files or folders.",
  "slash-command": "No matching command.",
  skill: "No skills found. Try / to browse provider commands.",
};
