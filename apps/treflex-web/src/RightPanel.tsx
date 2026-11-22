import type { JSX } from "solid-js";

import { X } from "./icons";
import { Button } from "./ui/Button";

/** The right panel's top bar, level with the thread header, with whatever it shows and a close button. */
export function PanelHeader(props: {
  children?: JSX.Element;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <header class="flex h-(--workspace-topbar-height) flex-none items-center gap-2.5 pr-[13px] pl-2">
      {props.children}
      <span class="flex-1" />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={props.closeLabel}
        data-tip={props.closeLabel}
        onClick={props.onClose}
      >
        <X />
      </Button>
    </header>
  );
}
