import type { KeybindingCommand } from "@t3tools/contracts";
import type { IDispatch } from "treflex-solid";

import type { IPanelShortcuts } from "./Environment";
import type { IOverlayStack } from "./overlays";
import { toggleTerminal } from "./Terminal";
import {
  closeDiff,
  closeRightPanel,
  openDiff,
  toggleDetails,
  toggleRightPanel,
} from "./ThreadSession";

/** A handler for plain keys while something on screen takes them, as the surface launcher does. */
export type ILetterKeys = (event: KeyboardEvent) => boolean;

/**
 * The one keydown handler for the app: Escape closes what's on top, a bound shortcut runs its
 * command unless a dialog or the palette holds the screen, and plain keys go to whatever on
 * screen takes them while nothing is open over it, else to the composer.
 */
export function createKeyDispatcher(input: {
  overlays: IOverlayStack;
  paletteOpen: () => boolean;
  resolve: (event: KeyboardEvent) => KeybindingCommand | null;
  run: (command: KeybindingCommand) => boolean;
  /** Closes a sheet once nothing is open over it, and says whether one was open. */
  closeSheet: () => boolean;
  /** Types the key into the composer, and says whether it did. */
  typeIntoComposer: (event: KeyboardEvent) => boolean;
}) {
  let letters: ILetterKeys | null = null;
  const handled = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  return {
    takeLetters: (handler: ILetterKeys) => {
      letters = handler;
      return () => {
        if (letters === handler) letters = null;
      };
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        if (event.isComposing) return;
        if (input.overlays.escape() || input.closeSheet()) handled(event);
        return;
      }
      const command = input.resolve(event);
      // A held shortcut runs once, but its repeats still mustn't reach the browser (Ctrl+R reloads).
      if (event.repeat) {
        if (command !== null) event.preventDefault();
        return;
      }
      if (command !== null) {
        if (input.paletteOpen() ? command !== "commandPalette.toggle" : input.overlays.modal())
          return;
        if (input.run(command)) handled(event);
        return;
      }
      if (input.overlays.open() || input.paletteOpen()) return;
      if (letters?.(event) === true || input.typeIntoComposer(event)) handled(event);
    },
  };
}

export function runPanelShortcut(
  command: KeybindingCommand,
  panels: IPanelShortcuts | null,
  dispatch: IDispatch,
): boolean {
  if (panels === null) return false;
  const session = panels.SessionId;
  switch (command) {
    case "threadPanel.toggle":
      if (!panels.Details) return false;
      void dispatch(toggleDetails, session);
      return true;
    case "terminal.toggle":
      if (!panels.Terminal) return false;
      void dispatch(toggleTerminal, panels.TerminalEntityId);
      return true;
    case "rightPanel.toggle":
      void dispatch(toggleRightPanel, session);
      return true;
    case "rightPanel.close":
      if (!panels.RightPanelOpen) return false;
      void dispatch(closeRightPanel, session);
      return true;
    case "diff.toggle":
      if (panels.DiffOpen) void dispatch(closeDiff, session);
      else if (panels.Diff) void dispatch(openDiff, session, null, null);
      else return false;
      return true;
    default:
      return false;
  }
}
