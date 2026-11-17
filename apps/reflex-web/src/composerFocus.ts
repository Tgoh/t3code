export const FOCUS_COMPOSER_EVENT = "reflex:focus-composer";

/**
 * Asks the open thread's composer to expand and put the caret at the end, once the restored text
 * has rendered. An event, because a collapsed phone composer hides its prompt and only it can expand.
 */
export function focusComposerAtEnd(): void {
  requestAnimationFrame(() => window.dispatchEvent(new Event(FOCUS_COMPOSER_EVENT)));
}
