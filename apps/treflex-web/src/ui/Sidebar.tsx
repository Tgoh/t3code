import { children, type JSX, Show, splitProps } from "solid-js";

import { Input, type InputProps } from "./Input";
import { ScrollArea } from "./ScrollArea";

const join = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(" ");

/**
 * Stock's resizable rail on an open sidebar. Its `group-data-*` classes key on stock's sidebar
 * root, which treflex doesn't have; the caller positions it and unmounts it while collapsed.
 */
export function SidebarRail(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <button
      aria-label="Resize Sidebar"
      data-tip="Drag to resize sidebar"
      data-tip-side="right"
      data-sidebar="rail"
      data-slot="sidebar-rail"
      tabIndex={-1}
      type="button"
      {...rest}
      class={join(
        "-translate-x-1/2 group-data-[side=left]:-right-4 absolute inset-y-0 z-20 hidden w-4 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border group-data-[side=right]:left-0 sm:flex [[data-collapsible=offcanvas][data-state=collapsed]_&]:pointer-events-none",
        "[[data-panel-animations=true]_&]:transition-all [[data-panel-animations=true]_&]:[transition-duration:var(--panel-animation-duration)] [[data-panel-animations=true]_&]:ease-out",
        "touch-none",
        "cursor-col-resize",
        "group-data-[collapsible=offcanvas]:translate-x-0 hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:after:left-full",
        "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
        local.class,
      )}
    />
  );
}

export function SidebarFooter(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      data-sidebar="footer"
      data-slot="sidebar-footer"
      {...rest}
      class={join(
        "flex flex-col gap-2 px-[var(--sidebar-content-inset)] pt-1 pb-[var(--sidebar-content-inset)]",
        local.class,
      )}
    />
  );
}

export function SidebarContent(
  props: JSX.HTMLAttributes<HTMLDivElement> & { fixedHeader?: JSX.Element },
) {
  const [local, rest] = splitProps(props, ["class", "fixedHeader"]);
  const header = children(() => local.fixedHeader);
  return (
    <>
      <Show when={header()}>
        <div class="w-full shrink-0">{header()}</div>
      </Show>
      <ScrollArea
        hideScrollbars
        scrollFade
        scrollFadePadding={false}
        viewportTabIndex={-1}
        class="h-auto min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]]:[--fade-size:0.75rem]"
      >
        <div
          data-sidebar="content"
          data-slot="sidebar-content"
          {...rest}
          class={join(
            "flex w-full min-w-0 flex-col [overflow-anchor:none] group-data-[collapsible=icon]:overflow-hidden [&>[data-sidebar=group]+[data-sidebar=group]]:pt-0",
            header() !== undefined && "[&>[data-sidebar=group]:first-child]:pt-0",
            local.class,
          )}
        />
      </ScrollArea>
    </>
  );
}

export function SidebarGroup(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      data-sidebar="group"
      data-slot="sidebar-group"
      {...rest}
      class={join(
        "relative flex w-full min-w-0 flex-col p-[var(--sidebar-content-inset)]",
        local.class,
      )}
    />
  );
}

const MENU_LAYOUTS = { default: "flex-col", row: "flex-row items-center" };

export function SidebarMenu(
  props: JSX.HTMLAttributes<HTMLUListElement> & { layout?: keyof typeof MENU_LAYOUTS },
) {
  const [local, rest] = splitProps(props, ["class", "layout"]);
  return (
    <ul
      data-sidebar="menu"
      data-slot="sidebar-menu"
      {...rest}
      class={join(
        "flex w-full min-w-0 gap-1",
        MENU_LAYOUTS[local.layout ?? "default"],
        local.class,
      )}
    />
  );
}

export function SidebarMenuItem(props: JSX.LiHTMLAttributes<HTMLLIElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <li
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
      {...rest}
      class={join("group/menu-item relative", local.class)}
    />
  );
}

const BASE =
  "peer/menu-button flex cursor-pointer gap-[var(--sidebar-control-gap)] overflow-hidden text-left outline-hidden transition-[width,height,padding] hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset active:bg-sidebar-row-active active:text-sidebar-foreground disabled:pointer-events-none disabled:opacity-64 aria-disabled:pointer-events-none aria-disabled:opacity-64 data-[active=true]:bg-sidebar-row-selected data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground data-[state=open]:hover:bg-sidebar-row-hover data-[state=open]:hover:text-sidebar-foreground group-data-[collapsible=icon]:size-8! [&>span:last-child]:truncate [&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0 [&>svg]:text-[var(--sidebar-icon-color)] hover:[&>svg]:text-sidebar-foreground active:[&>svg]:text-sidebar-foreground data-[active=true]:[&>svg]:text-sidebar-foreground";

// Stands in for tailwind-merge: a size or variant replaces these base classes by name, since two
// utilities for one property resolve by Tailwind's order, not the class order.
const PARTS = {
  align: "items-center",
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
  "sm-search-result": [
    "h-auto min-h-10 rounded-[var(--control-radius)] px-[var(--sidebar-row-content-inset)] py-2 text-xs",
    { align: "items-start" },
  ],
} satisfies Record<string, readonly [string, IParts?]>;

const VARIANTS = {
  default: ["font-medium text-sidebar-muted-foreground/80"],
  outline: ["bg-sidebar-control-surface ring-1", { ring: "ring-sidebar-border" }],
} satisfies Record<string, readonly [string, IParts?]>;

export type SidebarMenuButtonSize = keyof typeof SIZES;

function sidebarMenuButtonVariants(
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
