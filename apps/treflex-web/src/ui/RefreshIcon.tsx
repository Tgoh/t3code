import { type ComponentProps, createEffect, splitProps } from "solid-js";

import { RefreshCw } from "../icons";
import { observeVisibleAnimation } from "./visibleAnimation";

// No default size: inside a Button the parent's svg rule sizes the glyph.
const SIZES = {
  xs: "size-3",
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
};

export function RefreshIcon(
  props: Omit<ComponentProps<typeof RefreshCw>, "size"> & {
    size?: keyof typeof SIZES;
    refreshing?: boolean;
  },
) {
  const [local, rest] = splitProps(props, ["size", "refreshing", "class"]);
  return (
    <RefreshCw
      aria-hidden="true"
      ref={(icon: SVGSVGElement) =>
        createEffect(() => {
          if (local.refreshing) observeVisibleAnimation(icon);
        })
      }
      {...rest}
      class={[
        local.size === undefined ? undefined : SIZES[local.size],
        local.refreshing ? "motion-safe:visible-animate-spin" : undefined,
        local.class,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
