import { EDITORS, type EditorId } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";

export interface IEditors {
  Available: EditorId[];
  Preferred: EditorId | null;
}

// Follows getLocalFileManagerName in apps/web/src/lib/utils.ts.
export function fileManagerName(platform: string): string {
  if (isMacPlatform(platform)) return "Finder";
  if (/^win(dows)?/i.test(platform)) return "File Explorer";
  return "Files";
}

export function editorLabel(editor: EditorId, platform: string): string {
  if (editor === "file-manager") return fileManagerName(platform);
  return EDITORS.find((candidate) => candidate.id === editor)?.label ?? editor;
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
export function editorChoices(available: ReadonlyArray<EditorId>, stored: string | null): IEditors {
  return {
    Available: EDITORS.filter((editor) => available.includes(editor.id)).map((editor) => editor.id),
    Preferred: preferredEditor(available, stored),
  };
}

// Follows openInEditorMenuLabel in apps/web/src/editorLabels.ts.
export function openInEditorLabel(editors: IEditors): string {
  const preferred = editors.Preferred;
  return preferred === null || preferred === "file-manager"
    ? "Open in editor"
    : `Open in ${editorLabel(preferred, "")}`;
}

// Follows `revealInFileManager` in markdownServerConfigFields in
// apps/web/src/components/ChatMarkdown.tsx and apps/web/src/components/preview/fileExplorerLabel.ts.
export function revealLabel(
  config: {
    shellRevealInFileManager?: boolean;
    shellRevealInFileManagerKind?: string;
    availableEditors: ReadonlyArray<string>;
    environment: { platform: { os: string } };
  } | null,
): string | null {
  if (
    config?.shellRevealInFileManager !== true ||
    !config.availableEditors.includes("file-manager")
  )
    return null;
  const kind = config.shellRevealInFileManagerKind ?? config.environment.platform.os;
  if (kind === "finder" || kind === "darwin") return "Reveal in Finder";
  if (kind === "file-explorer" || kind === "windows") return "Reveal in File Explorer";
  return "Reveal in Files";
}
