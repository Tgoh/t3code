// Follows apps/web/src/components/chat/composerFocusRedirect.ts, except that a printable key typed
// on a button or link goes to the composer, where Space stays with it. Callers say whether a layer
// (menu, dialog, popover, the palette, a sheet) covers the composer, since they know without the DOM.

const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
].join(",");

const BUTTON_OR_LINK_SELECTOR = ["button", "a[href]", '[role="button"]'].join(",");

const CONTROL_SELECTOR = [
  "summary",
  '[role="application"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
].join(",");

interface IPathElement {
  closest: (selector: string) => unknown;
  getAttribute: (name: string) => string | null;
}

function pathElements(event: Event): IPathElement[] {
  const path = event.composedPath();
  if (path.length === 0 && event.target) path.push(event.target);
  return path.filter(
    (target): target is EventTarget & IPathElement =>
      typeof (target as Partial<IPathElement>).closest === "function",
  );
}

function pathMatches(event: Event, selector: string): boolean {
  return pathElements(event).some((element) => element.closest(selector) !== null);
}

function isKeyClaimedInPath(event: KeyboardEvent): boolean {
  if (event.shiftKey) return false;
  const key = event.key.toUpperCase();
  return pathElements(event).some(
    (element) => element.getAttribute("aria-keyshortcuts")?.split(/\s+/).includes(key) ?? false,
  );
}

function isOutsideFieldsAndControls(event: Event): boolean {
  if (event.defaultPrevented) return false;
  if (pathMatches(event, EDITABLE_SELECTOR)) return false;
  return !pathMatches(event, CONTROL_SELECTOR);
}

/** Whether a paste outside any field or control should go to the composer instead of being lost. */
export function shouldRedirectInputToComposer(event: Event): boolean {
  return isOutsideFieldsAndControls(event) && !pathMatches(event, BUTTON_OR_LINK_SELECTOR);
}

export function shouldTypeToFocusComposer(event: KeyboardEvent, composerCovered: boolean): boolean {
  if (composerCovered) return false;
  if (event.isComposing) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key.length !== 1) return false;
  if (!isOutsideFieldsAndControls(event)) return false;
  if (event.key === " " && pathMatches(event, BUTTON_OR_LINK_SELECTOR)) return false;
  if (isKeyClaimedInPath(event)) return false;
  return true;
}

export function pasteTextToFocusComposer(event: ClipboardEvent): string | null {
  if (!event.clipboardData || event.clipboardData.files.length > 0) return null;
  if (!shouldRedirectInputToComposer(event)) return null;
  const text = event.clipboardData.getData("text/plain");
  return text.length > 0 ? text : null;
}
