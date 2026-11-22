import { type JSX, splitProps } from "solid-js";

const SHAPES = {
  block: "rounded-sm",
  card: "rounded-lg",
  pill: "rounded-full",
};

export function Skeleton(
  props: JSX.HTMLAttributes<HTMLDivElement> & { shape?: keyof typeof SHAPES },
) {
  const [local, rest] = splitProps(props, ["shape", "class"]);
  return (
    <div
      {...rest}
      class={[
        "bg-muted-foreground/15 motion-safe:animate-skeleton",
        SHAPES[local.shape ?? "block"],
        local.class,
      ]
        .filter(Boolean)
        .join(" ")}
      data-slot="skeleton"
    />
  );
}
