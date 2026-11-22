import { type JSX, splitProps } from "solid-js";

const BASE =
  "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap border outline-none before:pointer-events-none before:absolute before:inset-0 pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none aria-disabled:opacity-64 sm:text-sm [&_svg:not([class*='opacity-'])]:opacity-80 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0";

// Stands in for tailwind-merge: a size or variant replaces these base classes by name, and a
// variant's win over a size's, since two utilities for one property resolve by Tailwind's order.
const PARTS = {
  radius: "rounded-lg",
  beforeRadius: "before:rounded-[calc(var(--radius-lg)-1px)]",
  padding: "",
  font: "font-medium",
  text: "text-base",
  color: "text-foreground",
  transition: "transition-shadow",
  hover: "hover:bg-accent",
  disabled: "disabled:opacity-64",
  pressedBg: "data-pressed:bg-input/64",
  pressedText: "data-pressed:text-accent-foreground",
  svg: "[&_svg:not([class*='size-'])]:size-4.5",
};

type IParts = Partial<Record<keyof typeof PARTS, string>>;

const SIZES = {
  compact: [
    "h-7 min-w-7",
    {
      padding: "px-[calc(--spacing(1)-1px)]",
      radius: "rounded-md",
      beforeRadius: "before:rounded-[calc(var(--radius-md)-1px)]",
      text: "text-xs",
      svg: "[&_svg:not([class*='size-'])]:size-3.5",
    },
  ],
  default: ["h-9 min-w-9 sm:h-8 sm:min-w-8", { padding: "px-[calc(--spacing(2)-1px)]" }],
  lg: ["h-10 min-w-10 sm:h-9 sm:min-w-9", { padding: "px-[calc(--spacing(2.5)-1px)]" }],
  segmented: [
    "h-6 min-w-0",
    {
      padding: "px-2.5",
      radius: "rounded-md",
      beforeRadius: "before:rounded-[calc(var(--radius-md)-1px)]",
      text: "text-xs",
    },
  ],
  sm: ["h-8 min-w-8 sm:h-7 sm:min-w-7", { padding: "px-[calc(--spacing(1.5)-1px)]" }],
  xs: [
    "h-7 min-w-7 sm:h-6 sm:min-w-6",
    { padding: "px-[calc(--spacing(1)-1px)]", radius: "rounded-md" },
  ],
} satisfies Record<string, readonly [string, IParts?]>;

const VARIANTS = {
  default: ["border-transparent"],
  pill: [
    "border-transparent",
    {
      radius: "rounded-full",
      padding: "px-3",
      font: "font-normal",
      color: "text-muted-foreground",
      pressedText: "data-pressed:text-foreground",
    },
  ],
  ghost: [
    "border-transparent shadow-none [:disabled,:active,[data-pressed]]:shadow-none before:shadow-none disabled:text-muted-foreground disabled:[&_svg]:opacity-100",
    {
      color: "text-foreground",
      pressedBg: "data-pressed:bg-accent",
      pressedText: "data-pressed:text-accent-foreground",
      disabled: "disabled:opacity-100",
    },
  ],
  outline: [
    "border-input bg-background not-dark:bg-clip-padding shadow-xs/5 not-disabled:not-active:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:bg-input/32 dark:data-pressed:bg-input dark:hover:bg-input/64 dark:not-disabled:not-active:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] dark:not-disabled:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/2%)] [:disabled,:active,[data-pressed]]:shadow-none",
  ],
  segmented: [
    "border-transparent shadow-none before:shadow-none hover:text-foreground data-pressed:shadow-xs/10 dark:hover:bg-input/32 dark:data-pressed:bg-input/72",
    {
      color: "text-muted-foreground",
      transition: "transition-colors",
      hover: "hover:bg-background/55",
      pressedBg: "data-pressed:bg-background",
      pressedText: "data-pressed:text-foreground",
    },
  ],
} satisfies Record<string, readonly [string, IParts?]>;

export type ToggleVariant = keyof typeof VARIANTS;
export type ToggleSize = keyof typeof SIZES;

export function toggleVariants(
  options: {
    variant?: ToggleVariant | undefined;
    size?: ToggleSize | undefined;
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

export function Toggle(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ToggleVariant;
    size?: ToggleSize;
    pressed?: boolean;
  },
) {
  const [local, rest] = splitProps(props, ["variant", "size", "pressed", "class"]);
  return (
    <button
      type="button"
      data-slot="toggle"
      {...rest}
      aria-pressed={local.pressed === true}
      data-pressed={local.pressed === true ? "" : undefined}
      class={toggleVariants({ variant: local.variant, size: local.size, class: local.class })}
    />
  );
}
