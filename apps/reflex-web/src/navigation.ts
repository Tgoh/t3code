import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { type Accessor, createContext, useContext } from "solid-js";

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
}

export const NavigationContext = createContext<INavigation>({
  keybindings: () => DEFAULT_RESOLVED_KEYBINDINGS,
  shortcut: () => null,
  palette: () => null,
  setPalette: () => {},
  goToThread: () => {},
  focusComposer: () => {},
  focusSearch: () => {},
});

export const useNavigation = () => useContext(NavigationContext);

export const COMPOSER_SELECTOR = "main .composer-lane textarea";
export const SEARCH_SELECTOR = ".sidebar-search input";
