export const FOCUS_COMPOSER_EVENT = "reflex:focus-composer";

/** The dictation shortcut, for the composer on screen, which alone knows its caret. */
export const TOGGLE_DICTATION_EVENT = "reflex:toggle-dictation";

export const TYPE_INTO_COMPOSER_EVENT = "reflex:type-into-composer";

export interface ITypedText {
  Text: string;
  /** Pasted text, which a long paste folds into an attachment as it would in the prompt. */
  Paste: boolean;
  Bypass: boolean;
}

/** Appends text to the composer on screen and focuses it, and says whether one took it. */
export function typeIntoComposer(typed: ITypedText): boolean {
  return !window.dispatchEvent(
    new CustomEvent(TYPE_INTO_COMPOSER_EVENT, { detail: typed, cancelable: true }),
  );
}

/**
 * Asks the open thread's composer to expand and put the caret at the end, once the restored text
 * has rendered. An event, because a collapsed phone composer hides its prompt and only it can expand.
 */
export function focusComposerAtEnd(): void {
  requestAnimationFrame(() => window.dispatchEvent(new Event(FOCUS_COMPOSER_EVENT)));
}
