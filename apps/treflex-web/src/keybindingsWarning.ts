// Follows createKeybindingsUpdateToastController in apps/web/src/components/KeybindingsUpdateToast.logic.ts.
const COOLDOWN_MS = 2_000;

export interface IConfigIssue {
  kind: string;
  message: string;
}

/**
 * Takes each `keybindingsUpdated` event's issues and returns the message to warn with, or null.
 * A save and the server's file watcher each publish the same snapshot, so the same outcome
 * inside the cooldown is one change seen twice.
 */
export function keybindingsWarnings(now: () => number) {
  let last: { Key: string; At: number } | null = null;
  return (issues: readonly IConfigIssue[]): string | null => {
    const issue = issues.find((entry) => entry.kind.startsWith("keybindings."));
    const key = issue ? `invalid:${issue.message}` : "success";
    const at = now();
    if (last !== null && last.Key === key && at - last.At < COOLDOWN_MS) return null;
    last = { Key: key, At: at };
    return issue?.message ?? null;
  };
}
