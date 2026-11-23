import {
  type SideThreadOpenIntent,
  sideThreadOpenIntentOf,
} from "@t3tools/client-runtime/side-thread";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { createSignal, type JSX } from "solid-js";

import { MenuItem, MenuPopup } from "./ui/Menu";
import { Presence } from "./ui/Presence";

export interface ISideThreadTrigger {
  handlers: Pick<
    JSX.HTMLAttributes<HTMLElement>,
    "onClick" | "onMouseDown" | "onAuxClick" | "onKeyDown" | "onContextMenu"
  >;
  menu: () => JSX.Element;
}

// Follows useSideThreadTrigger in apps/web/src/hooks/useSideThreadTrigger.ts, with the menu its
// desktop context menu shows.
/** Click and Enter open where the setting says, the modifier or a middle click the other place. */
export function createSideThreadTrigger(
  open: (intent: SideThreadOpenIntent) => void,
): ISideThreadTrigger {
  const mac = isMacPlatform(navigator.platform);
  const [at, setAt] = createSignal<{ X: number; Y: number } | null>(null);
  return {
    handlers: {
      onClick: (event) => open(sideThreadOpenIntentOf(event, mac)),
      // Keeps the browser's autoscroll from starting under a middle click.
      onMouseDown: (event) => {
        if (event.button === 1) event.preventDefault();
      },
      onAuxClick: (event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        open("alternate");
      },
      onKeyDown: (event) => {
        if (event.key !== "Enter" || sideThreadOpenIntentOf(event, mac) !== "alternate") return;
        event.preventDefault();
        open("alternate");
      },
      onContextMenu: (event) => {
        event.preventDefault();
        event.stopPropagation();
        setAt({ X: event.clientX, Y: event.clientY });
      },
    },
    menu: () => (
      <Presence when={at()}>
        {(point) => (
          <MenuPopup
            anchor={point()}
            side="bottom"
            align="start"
            sideOffset={0}
            label="Open thread"
            onClose={() => setAt(null)}
          >
            <MenuItem onClick={() => open("panel")}>Open in side panel</MenuItem>
            <MenuItem onClick={() => open("main")}>Open in main view</MenuItem>
          </MenuPopup>
        )}
      </Presence>
    ),
  };
}
