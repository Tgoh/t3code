import type { JSX } from "@solidjs/web";

import { X } from "../icons";

/** A tab's icon that turns into its close button while the tab (`group/tab`) is hovered. */
export function PanelTabCloseButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      class="group/close relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-64"
      aria-label={props.label}
      data-tip={props.label}
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      <span class="relative flex size-3 items-center justify-center group-hover/tab:hidden group-focus-visible/close:hidden">
        {props.children}
      </span>
      <X class="hidden size-3 group-hover/tab:block group-focus-visible/close:block" />
    </button>
  );
}
