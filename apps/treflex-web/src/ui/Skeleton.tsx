import type { JSX } from "@solidjs/web";
import { omit } from "solid-js";

const SHAPES = {
  block: "rounded-sm",
  card: "rounded-lg",
  pill: "rounded-full",
};

export function Skeleton(
  props: JSX.HTMLAttributes<HTMLDivElement> & { shape?: keyof typeof SHAPES },
) {
  const rest = omit(props, "shape", "class");
  return (
    <div
      {...rest}
      class={[
        "bg-muted-foreground/15 motion-safe:animate-skeleton",
        SHAPES[props.shape ?? "block"],
        props.class,
      ]
        .filter(Boolean)
        .join(" ")}
      data-slot="skeleton"
    />
  );
}
