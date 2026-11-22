import { type JSX, splitProps } from "solid-js";

const BASE =
  "inline-flex flex-none cursor-pointer items-center justify-center rounded-lg border disabled:cursor-default";

const VARIANTS = {
  ghost:
    "border-transparent bg-transparent text-foreground hover:not-disabled:bg-accent disabled:text-muted-foreground data-pressed:bg-accent [&_svg]:opacity-80",
  outline:
    "border-input bg-transparent text-foreground hover:not-disabled:bg-accent disabled:text-muted-foreground data-pressed:bg-accent [&_svg]:opacity-80",
  "outline-destructive":
    "border-input bg-transparent text-error-foreground hover:not-disabled:bg-[color-mix(in_srgb,var(--destructive)_10%,transparent)] [&_svg]:opacity-80",
  muted:
    "border-transparent bg-transparent text-muted-foreground hover:text-foreground hover:not-disabled:bg-accent data-pressed:bg-accent",
  sidebar:
    "border-transparent bg-transparent text-[color-mix(in_srgb,var(--sidebar-muted-foreground)_85%,var(--sidebar))] hover:bg-sidebar-accent hover:text-sidebar-foreground data-pressed:bg-sidebar-accent data-pressed:text-sidebar-foreground",
  "sidebar-field":
    "border-transparent bg-transparent text-[color-mix(in_srgb,var(--sidebar-muted-foreground)_85%,var(--sidebar))] hover:bg-sidebar-accent hover:text-sidebar-foreground [&_svg]:opacity-80",
  "sidebar-footer":
    "border-transparent bg-transparent text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-foreground [&_svg]:opacity-80",
  brand:
    "border-transparent bg-transparent text-white hover:bg-[rgb(255_255_255/16%)] [&_svg]:opacity-80",
  media:
    "border-transparent bg-[rgb(0_0_0/50%)] text-white hover:bg-[rgb(0_0_0/70%)] [&_svg]:opacity-80",
};

const SIZES = {
  md: "size-7",
  sm: "size-6 [&_svg]:size-3.5",
  xs: "size-6 [&_svg]:size-3",
  narrow: "h-7 w-5",
};

export type IIconButtonVariant = keyof typeof VARIANTS;
export type IIconButtonSize = keyof typeof SIZES;

/** The icon button look, for an element that can't be a `<button>`, such as a link or a label. */
export const iconButton = (variant: IIconButtonVariant = "ghost", size: IIconButtonSize = "md") =>
  `${BASE} ${VARIANTS[variant]} ${SIZES[size]}`;

export function IconButton(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: IIconButtonVariant;
    size?: IIconButtonSize;
    pressed?: boolean;
  },
) {
  const [local, rest] = splitProps(props, ["variant", "size", "pressed", "class"]);
  return (
    <button
      type="button"
      {...rest}
      class={`${iconButton(local.variant, local.size)}${local.class ? ` ${local.class}` : ""}`}
      data-pressed={local.pressed ? "" : undefined}
    />
  );
}
