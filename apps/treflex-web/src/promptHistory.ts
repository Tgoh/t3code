import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "@t3tools/shared/composerContextReferences";

import { attribution, type ISentMessage } from "./userMessage";

const ULTRATHINK_PREFIX = "Ultrathink:\n";
const PLAN_IMPLEMENTATION_PREFIX = "PLEASE IMPLEMENT THIS PLAN:\n";

export interface IPromptHistoryEntry {
  Id: string;
  Prompt: string;
}

export interface IPromptHistoryPosition {
  EntryId: string;
  Recalled: string;
}

export interface IPromptHistoryStep {
  Position: IPromptHistoryPosition | null;
  Prompt: string;
}

// Follows recallableComposerPrompt in apps/web/src/components/chat/composerPromptHistory.ts.
export function recallablePrompt(text: string): string {
  let prompt = text.trim();
  if (prompt.startsWith(ULTRATHINK_PREFIX)) prompt = prompt.slice(ULTRATHINK_PREFIX.length).trim();
  if (prompt === ATTACHMENT_ONLY_BOOTSTRAP_PROMPT || prompt.startsWith(PLAN_IMPLEMENTATION_PREFIX))
    return "";
  return prompt;
}

// Follows buildComposerPromptHistoryEntries in apps/web/src/components/chat/composerPromptHistory.ts.
export function promptHistoryEntries(
  messages: ReadonlyArray<ISentMessage & { id: string; role: string; createdAt: string }>,
): IPromptHistoryEntry[] {
  const entries: IPromptHistoryEntry[] = [];
  const ordered = [...messages].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
  for (const message of ordered) {
    if (message.role !== "user" || attribution(message) !== null) continue;
    const prompt = recallablePrompt(message.text);
    if (prompt === "") continue;
    const entry = { Id: message.id, Prompt: prompt };
    if (entries.at(-1)?.Prompt === prompt) entries[entries.length - 1] = entry;
    else entries.push(entry);
  }
  return entries;
}

// Follows stepComposerPromptHistory in apps/web/src/components/chat/composerPromptHistory.ts.
export function stepPromptHistory(input: {
  Direction: "backward" | "forward";
  Entries: ReadonlyArray<IPromptHistoryEntry>;
  Position: IPromptHistoryPosition | null;
  Current: string;
}): IPromptHistoryStep | null {
  const { Entries: entries, Position: position, Current: current } = input;
  let active = -1;
  if (position !== null && position.Recalled === current) {
    active = entries.findIndex((entry) => entry.Id === position.EntryId);
    if (active < 0) active = entries.findLastIndex((entry) => entry.Prompt === position.Recalled);
  }
  const recall = (entry: IPromptHistoryEntry): IPromptHistoryStep => ({
    Position: { EntryId: entry.Id, Recalled: entry.Prompt },
    Prompt: entry.Prompt,
  });
  if (input.Direction === "backward") {
    if (active < 0 && current.length > 0) return null;
    const entry = entries[active < 0 ? entries.length - 1 : active - 1];
    return entry === undefined ? null : recall(entry);
  }
  if (active < 0) return null;
  const entry = entries[active + 1];
  return entry === undefined ? { Position: null, Prompt: "" } : recall(entry);
}

/** Whether the caret sits on the textarea's first line (backward) or last line (forward). */
export function caretOnEdge(
  text: string,
  start: number,
  end: number,
  direction: "backward" | "forward",
): boolean {
  if (start !== end) return false;
  return direction === "backward"
    ? !text.slice(0, start).includes("\n")
    : !text.slice(end).includes("\n");
}
