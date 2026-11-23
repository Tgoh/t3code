import { type ComponentProps, omit } from "solid-js";

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
  const rest = omit(props, "size", "refreshing", "class");
  const animate = observeVisibleAnimation(() => props.refreshing === true);
  return (
    <RefreshCw
      aria-hidden="true"
      ref={animate}
      {...rest}
      class={[
        props.size === undefined ? undefined : SIZES[props.size],
        props.refreshing ? "motion-safe:visible-animate-spin" : undefined,
        props.class,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
