import { createContext, createSignal, onCleanup, useContext } from "solid-js";

export type ICloseReason = "escape" | "outside";

export interface IOverlay {
  close: (reason: ICloseReason) => void;
  /** Whether the node is part of it, its anchor included, so a press there isn't outside it. */
  contains: (node: Node) => boolean;
  /** A dialog: it holds back app shortcuts, and a press outside it closes nothing. */
  modal?: boolean;
  /** Its backdrop: a press there closes it and nothing under it. */
  backdrop?: (node: Node) => boolean;
}

/** What's open on top of the screen, newest last: menus, popovers and dialogs. */
export interface IOverlayStack {
  open: () => boolean;
  modal: () => boolean;
  push: (overlay: IOverlay) => () => void;
  /** Closes the top overlay, and says whether there was one. */
  escape: () => boolean;
  /**
   * Closes each overlay a press lands outside, from the top down to the first that holds it or is
   * modal, so a press inside a menu leaves the popover under it open.
   */
  press: (target: Node) => void;
}

export function createOverlayStack(): IOverlayStack {
  // Components push from their body as they mount.
  const [stack, setStack] = createSignal<readonly IOverlay[]>([], { ownedWrite: true });
  return {
    open: () => stack().length > 0,
    modal: () => stack().some((overlay) => overlay.modal === true),
    push: (overlay) => {
      setStack((held) => [...held, overlay]);
      return () => setStack((held) => held.filter((entry) => entry !== overlay));
    },
    escape: () => {
      const top = stack().at(-1);
      top?.close("escape");
      return top !== undefined;
    },
    press: (target) => {
      for (const overlay of [...stack()].reverse()) {
        if (overlay.contains(target) || overlay.modal === true) return;
        overlay.close("outside");
        if (overlay.backdrop?.(target) === true) return;
      }
    },
  };
}

export const OverlayContext = createContext<IOverlayStack>(createOverlayStack());

export const useOverlays = () => useContext(OverlayContext);

/** Puts an overlay on the stack while the calling component is mounted. */
export function useOverlay(overlay: IOverlay): void {
  onCleanup(useOverlays().push(overlay));
}
