import { type JSX, splitProps } from "solid-js";

const BASE =
  "pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded font-medium font-sans text-muted-foreground text-xs [&_svg:not([class*='size-'])]:size-3";

const VARIANTS = {
  default: "px-1 bg-foreground/[0.07]",
  outline: "border border-b-2 border-foreground/15 px-1.5",
};

function kbdClass(variant: keyof typeof VARIANTS = "default", extra?: string) {
  return [BASE, VARIANTS[variant], extra].filter(Boolean).join(" ");
}

export function Kbd(
  props: JSX.HTMLAttributes<HTMLElement> & {
    /** `outline` draws a physical key, so the hint stays distinct inside surrounding text. */
    variant?: keyof typeof VARIANTS;
  },
) {
  const [local, rest] = splitProps(props, ["variant", "class"]);
  return <kbd data-slot="kbd" {...rest} class={kbdClass(local.variant, local.class)} />;
}

export function KbdGroup(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <kbd
      data-slot="kbd-group"
      {...rest}
      class={["inline-flex items-center gap-1", local.class].filter(Boolean).join(" ")}
    />
  );
}
