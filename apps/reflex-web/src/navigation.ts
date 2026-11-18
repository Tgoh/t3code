import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { type Accessor, createContext, useContext } from "solid-js";

import type { ILetterKeys } from "./shortcuts";

export type IPaletteView = "root" | "new-thread-in" | "add-project";

export interface INavigation {
  keybindings: Accessor<ResolvedKeybindingsConfig>;
  /** The command's shortcut label, or null when nothing binds it. */
  shortcut: (command: KeybindingCommand) => string | null;
  palette: Accessor<IPaletteView | null>;
  setPalette: (view: IPaletteView | null) => void;
  /** Selects a thread and, outside the sheet layout, puts the caret in its composer. */
  goToThread: (threadId: string) => void;
  focusComposer: () => void;
  focusSearch: () => void;
  /** Starts renaming the selected thread in the sidebar, and says whether there was one. */
  renameThread: () => boolean;
  /** Hands plain keys to a handler until the returned release, while nothing is open over it. */
  takeLetters: (handler: ILetterKeys) => () => void;
}

export const NavigationContext = createContext<INavigation>({
  keybindings: () => DEFAULT_RESOLVED_KEYBINDINGS,
  shortcut: () => null,
  palette: () => null,
  setPalette: () => {},
  goToThread: () => {},
  focusComposer: () => {},
  focusSearch: () => {},
  renameThread: () => false,
  takeLetters: () => () => {},
});

export const useNavigation = () => useContext(NavigationContext);

export const COMPOSER_SELECTOR = "main .composer-lane textarea";
export const SEARCH_SELECTOR = "[data-sidebar] input[type=search]";

/** Asks the sidebar to start renaming this thread's row. */
export const RENAME_THREAD_EVENT = "reflex:rename-thread";
