export type IComposerScrollKey = "PageUp" | "PageDown" | "Home" | "End";

export interface IComposerKey {
  Key: string;
  Alt: boolean;
  Ctrl: boolean;
  Meta: boolean;
  Shift: boolean;
  Composing: boolean;
  KeyCode: number;
  DefaultPrevented: boolean;
}

export interface IComposerEditor {
  Text: string;
  SelectionStart: number;
  SelectionEnd: number;
  ScrollTop: number;
  ScrollHeight: number;
  ClientHeight: number;
}

const BOUNDARY_EPSILON_PX = 1;

function editorCanScroll(editor: IComposerEditor, up: boolean): boolean {
  const max = Math.max(0, editor.ScrollHeight - editor.ClientHeight);
  const top = Math.min(max, Math.max(0, editor.ScrollTop));
  return up ? top > BOUNDARY_EPSILON_PX : top < max - BOUNDARY_EPSILON_PX;
}

/** Ctrl+Home and Ctrl+End scroll the thread only from the matching edge of the text. */
export function jumpsFromCaret(key: "Home" | "End", editor: IComposerEditor): boolean {
  if (editor.SelectionStart !== editor.SelectionEnd) return false;
  return key === "Home" ? editor.SelectionStart === 0 : editor.SelectionEnd === editor.Text.length;
}

/** The thread scroll a key in the composer makes instead of its own, or null to leave it to the editor. */
export function composerScrollKey(
  key: IComposerKey,
  editor: IComposerEditor,
): IComposerScrollKey | null {
  if (key.DefaultPrevented || key.Composing || key.KeyCode === 229) return null;
  if (key.Alt || key.Meta || key.Shift) return null;
  if (key.Key === "PageUp" || key.Key === "PageDown") {
    if (key.Ctrl) return null;
    return editorCanScroll(editor, key.Key === "PageUp") ? null : key.Key;
  }
  if (key.Key === "Home" || key.Key === "End") {
    if (!key.Ctrl) return null;
    return jumpsFromCaret(key.Key, editor) ? key.Key : null;
  }
  return null;
}
