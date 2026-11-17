import { type JSX, splitProps } from "solid-js";

const BASE =
  "cursor-pointer rounded-lg border font-medium disabled:cursor-default disabled:opacity-64";

const VARIANTS = {
  default: "border-input bg-popover text-[14px] hover:bg-accent",
  primary:
    "border-transparent bg-primary text-[14px] text-primary-foreground hover:bg-[color-mix(in_srgb,var(--primary)_90%,var(--background))]",
  destructive:
    "border-transparent bg-destructive text-[14px] text-white hover:bg-[color-mix(in_srgb,var(--destructive)_90%,var(--background))]",
  "destructive-outline":
    "border-input bg-popover text-[14px] text-error-foreground enabled:hover:border-[color-mix(in_srgb,var(--destructive)_32%,transparent)] enabled:hover:bg-[color-mix(in_srgb,var(--destructive)_4%,var(--popover))]",
  ghost:
    "border-transparent bg-transparent text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground",
};

const SIZES = {
  default: "h-7 px-2.5 py-0",
  icon: "inline-flex size-7 items-center justify-center p-0",
};

export type IButtonVariant = keyof typeof VARIANTS;
export type IButtonSize = keyof typeof SIZES;

/** The button look, for an element that can't be a `<button>`. A link adds `buttonLink`. */
export const button = (variant: IButtonVariant = "default", size: IButtonSize = "default") =>
  `${BASE} ${VARIANTS[variant]} ${SIZES[size]}`;

export const buttonLink = "inline-flex items-center text-inherit no-underline";

export function Button(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: IButtonVariant;
    size?: IButtonSize;
  },
) {
  const [local, rest] = splitProps(props, ["variant", "size", "class"]);
  return (
    <button
      type="button"
      {...rest}
      class={`${button(local.variant, local.size)}${local.class ? ` ${local.class}` : ""}`}
    />
  );
}
