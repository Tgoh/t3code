import type { JSX } from "@solidjs/web";
import { omit } from "solid-js";

export function Label(props: JSX.LabelHTMLAttributes<HTMLLabelElement>) {
  const rest = omit(props, "class");
  return (
    <label
      data-slot="label"
      {...rest}
      class={[
        "inline-flex items-center gap-2 text-base/4.5 sm:text-sm/4 font-medium text-foreground",
        props.class,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
