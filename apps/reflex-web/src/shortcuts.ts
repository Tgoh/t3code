import type { IDispatch } from "treflex-solid";

import type { IPanelShortcuts } from "./Environment";
import type { IAppCommand } from "./keybindings";
import type { IOverlayStack } from "./overlays";
import {
  closeDiff,
  openDiff,
  toggleDetails,
  toggleRightPanel,
  toggleTerminal,
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
  resolve: (event: KeyboardEvent) => IAppCommand | null;
  run: (command: IAppCommand) => boolean;
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
        if (input.overlays.escape() || input.closeSheet()) handled(event);
        return;
      }
      if (event.repeat) return;
      const command = input.resolve(event);
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

/** Runs a panel shortcut on the shown thread's session, and says whether it applied. */
export function runPanelShortcut(
  command: IAppCommand,
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
      void dispatch(toggleTerminal, session);
      return true;
    case "rightPanel.toggle":
      void dispatch(toggleRightPanel, session);
      return true;
    case "diff.toggle":
      if (panels.DiffOpen) void dispatch(closeDiff, session);
      else if (panels.Diff) void dispatch(openDiff, session, "thread", null);
      else return false;
      return true;
    default:
      return false;
  }
}
