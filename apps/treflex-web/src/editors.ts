import { EDITORS, type EditorId } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";

export interface IEditorChoice {
  Id: string;
  Label: string;
}

export interface IEditors {
  Available: IEditorChoice[];
  Preferred: string | null;
}

// Follows getLocalFileManagerName in apps/web/src/lib/utils.ts.
function fileManagerName(platform: string): string {
  if (isMacPlatform(platform)) return "Finder";
  if (/^win(dows)?/i.test(platform)) return "File Explorer";
  return "Files";
}

// Follows resolveAndPersistPreferredEditor in apps/web/src/editorPreferences.ts; the caller persists.
export function preferredEditor(
  available: ReadonlyArray<EditorId>,
  stored: string | null,
): EditorId | null {
  return (
    available.find((editor) => editor === stored) ??
    EDITORS.find((candidate) => available.includes(candidate.id))?.id ??
    null
  );
}

/** The editors the server reports installed, in stock's order, and the one to open with. */
export function editorChoices(
  available: ReadonlyArray<EditorId>,
  stored: string | null,
  platform: string,
): IEditors {
  return {
    Available: EDITORS.filter((editor) => available.includes(editor.id)).map((editor) => ({
      Id: editor.id,
      Label: editor.id === "file-manager" ? fileManagerName(platform) : editor.label,
    })),
    Preferred: preferredEditor(available, stored),
  };
}
