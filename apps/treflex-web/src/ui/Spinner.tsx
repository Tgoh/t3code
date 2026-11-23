import { type ComponentProps, omit } from "solid-js";

import { LoaderCircle } from "../icons";
import { observeVisibleAnimation } from "./visibleAnimation";

// No default size: inside a Button the parent's svg rule sizes the glyph.
const SIZES = {
  xs: "size-3",
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
};

const TONES = {
  current: "",
  muted: "text-muted-foreground",
};

export function Spinner(
  props: Omit<ComponentProps<typeof LoaderCircle>, "size"> & {
    size?: keyof typeof SIZES;
    tone?: keyof typeof TONES;
  },
) {
  const rest = omit(props, "size", "tone", "class");
  return (
    <LoaderCircle
      aria-label="Loading"
      ref={observeVisibleAnimation}
      role="status"
      {...rest}
      class={[
        "motion-safe:visible-animate-spin",
        props.size === undefined ? undefined : SIZES[props.size],
        TONES[props.tone ?? "current"],
        props.class,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
