import { type JSX, splitProps } from "solid-js";

import { Input, type InputProps } from "./Input";

const BASE =
  "peer/menu-button flex cursor-pointer items-center gap-[var(--sidebar-control-gap)] overflow-hidden text-left outline-hidden transition-[width,height,padding] hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset active:bg-sidebar-row-active active:text-sidebar-foreground disabled:pointer-events-none disabled:opacity-64 aria-disabled:pointer-events-none aria-disabled:opacity-64 data-[active=true]:bg-sidebar-row-selected data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground data-[state=open]:hover:bg-sidebar-row-hover data-[state=open]:hover:text-sidebar-foreground group-data-[collapsible=icon]:size-8! [&>span:last-child]:truncate [&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0 [&>svg]:text-[var(--sidebar-icon-color)] hover:[&>svg]:text-sidebar-foreground active:[&>svg]:text-sidebar-foreground data-[active=true]:[&>svg]:text-sidebar-foreground";

// Stands in for tailwind-merge: a size or variant replaces these base classes by name, since two
// utilities for one property resolve by Tailwind's order, not the class order.
const PARTS = {
  width: "w-full",
  ring: "ring-ring",
  collapsedPadding: "group-data-[collapsible=icon]:p-[var(--sidebar-content-inset)]!",
};

type IParts = Partial<Record<keyof typeof PARTS, string>>;

const SIZES = {
  default: [
    "h-8 rounded-[var(--control-radius)] px-[var(--sidebar-row-content-inset)] py-1.5 text-sm",
  ],
  icon: ["size-8 justify-center rounded-[var(--control-radius)] p-0", { width: "" }],
  "icon-sm": ["size-7 justify-center rounded-[var(--control-radius)] p-0", { width: "" }],
  "icon-sm-narrow": ["h-7 w-5 justify-center rounded-[var(--control-radius)] p-0", { width: "" }],
  lg: [
    "h-12 rounded-[var(--control-radius)] px-[var(--sidebar-row-content-inset)] py-2 text-sm",
    { collapsedPadding: "group-data-[collapsible=icon]:p-0!" },
  ],
  sm: ["h-7 rounded-[var(--control-radius)] px-[var(--sidebar-row-content-inset)] py-2 text-xs"],
} satisfies Record<string, readonly [string, IParts?]>;

const VARIANTS = {
  default: ["font-medium text-sidebar-muted-foreground/80"],
  outline: ["bg-sidebar-control-surface ring-1", { ring: "ring-sidebar-border" }],
} satisfies Record<string, readonly [string, IParts?]>;

export type SidebarMenuButtonSize = keyof typeof SIZES;

/** The menu button look, for an element that can't be a `<button>`, such as a label. */
export function sidebarMenuButtonVariants(
  options: {
    variant?: keyof typeof VARIANTS | undefined;
    size?: SidebarMenuButtonSize | undefined;
    class?: string | undefined;
  } = {},
) {
  const [sizeClass, sizeParts] = SIZES[options.size ?? "default"] as readonly [string, IParts?];
  const [variantClass, variantParts] = VARIANTS[options.variant ?? "default"] as readonly [
    string,
    IParts?,
  ];
  return [
    BASE,
    ...Object.values({ ...PARTS, ...sizeParts, ...variantParts }),
    sizeClass,
    variantClass,
    options.class,
  ]
    .filter(Boolean)
    .join(" ");
}

export function SidebarMenuButton(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: keyof typeof VARIANTS;
    size?: SidebarMenuButtonSize;
    isActive?: boolean;
  },
) {
  const [local, rest] = splitProps(props, ["variant", "size", "isActive", "class"]);
  return (
    <button
      type="button"
      data-active={local.isActive === true ? "true" : "false"}
      data-sidebar="menu-button"
      data-size={local.size ?? "default"}
      data-slot="sidebar-menu-button"
      {...rest}
      class={sidebarMenuButtonVariants({
        variant: local.variant,
        size: local.size,
        class: local.class,
      })}
    />
  );
}

export function SidebarInput(props: Omit<InputProps, "unstyled">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <Input
      {...rest}
      class={[
        "[&_[data-slot=input]]:h-auto [&_[data-slot=input]]:p-0 [&_[data-slot=input]]:font-medium [&_[data-slot=input]]:text-sidebar-foreground [&_[data-slot=input]]:text-sm [&_[data-slot=input]]:leading-normal [&_[data-slot=input]]:placeholder:text-sidebar-muted-foreground",
        local.class,
      ]
        .filter(Boolean)
        .join(" ")}
      unstyled
    />
  );
}
