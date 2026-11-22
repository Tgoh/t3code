import { type JSX, splitProps } from "solid-js";

import { Input, type InputProps } from "./Input";
import { overrides } from "./merge";

const BASE =
  "inline-flex min-w-0 items-center border text-base text-foreground ring-ring/24 transition-shadow has-[input:focus-visible,textarea:focus-visible]:has-[input[aria-invalid],textarea[aria-invalid]]:border-destructive/64 has-[input:focus-visible,textarea:focus-visible]:has-[input[aria-invalid],textarea[aria-invalid]]:ring-destructive/16 has-[textarea]:h-auto has-data-[align=block-end]:h-auto has-data-[align=block-start]:h-auto has-data-[align=block-end]:flex-col has-data-[align=block-start]:flex-col has-[input[aria-invalid],textarea[aria-invalid]]:border-destructive/36 has-autofill:bg-foreground/4 has-[input:disabled,textarea:disabled]:opacity-64 has-[input:disabled,textarea:disabled,input:focus-visible,textarea:focus-visible,input[aria-invalid],textarea[aria-invalid]]:shadow-none has-[input:focus-visible,textarea:focus-visible]:ring-inset sm:text-sm dark:has-autofill:bg-foreground/8 dark:has-[input[aria-invalid],textarea[aria-invalid]]:ring-destructive/24 has-data-[align=inline-start]:**:[[data-size=sm]_input]:ps-1.5 has-data-[align=inline-end]:**:[[data-size=sm]_input]:pe-1.5 *:[[data-slot=input-control],[data-slot=textarea-control]]:contents *:[[data-slot=input-control],[data-slot=textarea-control]]:before:hidden has-[[data-align=block-start],[data-align=block-end]]:**:[input]:h-auto has-data-[align=inline-start]:**:[input]:ps-2 has-data-[align=inline-end]:**:[input]:pe-2 has-data-[align=block-end]:**:[input]:pt-1.5 has-data-[align=block-start]:**:[input]:pb-1.5 **:[textarea]:min-h-20.5 **:[textarea]:resize-none **:[textarea]:py-[calc(--spacing(3)-1px)] **:[textarea]:max-sm:min-h-23.5 **:[textarea_button]:rounded-[calc(var(--control-radius)-1px)]";

// Stands in for tailwind-merge: a variant replaces these base classes by name, since two
// utilities for one property resolve by Tailwind's order, not the class order.
const PARTS = {
  radius: "rounded-[var(--control-radius)]",
  focusBorder: "has-[input:focus-visible,textarea:focus-visible]:border-ring",
  focusRing: "has-[input:focus-visible,textarea:focus-visible]:ring-[3px]",
};

type IParts = Partial<Record<keyof typeof PARTS, string>>;

const SIZES = {
  default: "",
  lg: "h-9",
};

const VARIANTS = {
  default: [
    "border-input bg-background not-dark:bg-clip-padding shadow-xs/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--control-radius)-1px)] not-has-[input:disabled,textarea:disabled]:not-has-[input:focus-visible,textarea:focus-visible]:not-has-[input[aria-invalid],textarea[aria-invalid]]:before:shadow-[0_1px_--theme(--color-black/4%)] dark:bg-input/32 dark:not-has-[input:disabled,textarea:disabled]:not-has-[input:focus-visible,textarea:focus-visible]:not-has-[input[aria-invalid],textarea[aria-invalid]]:before:shadow-[0_-1px_--theme(--color-white/6%)]",
  ],
  popover: [
    "dropdown-glass",
    {
      radius: "rounded-2xl",
      focusRing: "has-[input:focus-visible,textarea:focus-visible]:ring-0",
      focusBorder:
        "has-[input:focus-visible,textarea:focus-visible]:border-[color-mix(in_srgb,var(--contrast-foreground)_18%,transparent)]",
    },
  ],
  ghost: [
    "border-transparent bg-transparent shadow-none hover:bg-muted/40 has-[input:focus-visible,textarea:focus-visible]:bg-background",
  ],
} satisfies Record<string, readonly [string, IParts?]>;

type InputGroupVariant = keyof typeof VARIANTS;
type InputGroupSize = keyof typeof SIZES;

function inputGroupVariants(
  options: {
    variant?: InputGroupVariant | undefined;
    size?: InputGroupSize | undefined;
    class?: string | undefined;
  } = {},
) {
  const [variantClass, variantParts] = VARIANTS[options.variant ?? "default"] as readonly [
    string,
    IParts?,
  ];
  return [
    BASE,
    overrides(options.class, "position") ? "" : "relative",
    overrides(options.class, "width") ? "" : "w-full",
    ...Object.values({ ...PARTS, ...variantParts }),
    SIZES[options.size ?? "default"],
    variantClass,
    options.class,
  ]
    .filter(Boolean)
    .join(" ");
}

export function InputGroup(
  props: JSX.HTMLAttributes<HTMLDivElement> & {
    variant?: InputGroupVariant;
    size?: InputGroupSize;
  },
) {
  const [local, rest] = splitProps(props, ["variant", "size", "class"]);
  return (
    <div
      class={inputGroupVariants({ variant: local.variant, size: local.size, class: local.class })}
      data-slot="input-group"
      role="group"
      {...rest}
    />
  );
}

const ADDON_BASE =
  "[&_svg]:-mx-0.5 flex h-auto cursor-text select-none items-center leading-none [&>kbd]:rounded-[calc(var(--radius)-5px)] in-[[data-slot=input-group]:has([data-slot=input-control],[data-slot=textarea-control])]:[&_svg:not([class*='size-'])]:size-4.5 sm:in-[[data-slot=input-group]:has([data-slot=input-control],[data-slot=textarea-control])]:[&_svg:not([class*='size-'])]:size-4 not-has-[button]:**:[svg:not([class*='opacity-'])]:opacity-80";

// Each align carries its own justification, and the pill inset replaces an inline align's gap,
// button margin and padding by name, standing in for tailwind-merge as above.
const ALIGNS = {
  "block-end": [
    "order-last w-full justify-start px-[calc(--spacing(3)-1px)] pb-[calc(--spacing(3)-1px)] [.border-t]:pt-[calc(--spacing(3)-1px)] [[data-size=sm]+&]:px-[calc(--spacing(2.5)-1px)]",
    { gap: "gap-2" },
  ],
  "block-start": [
    "order-first w-full justify-start px-[calc(--spacing(3)-1px)] pt-[calc(--spacing(3)-1px)] [.border-b]:pb-[calc(--spacing(3)-1px)] [[data-size=sm]+&]:px-[calc(--spacing(2.5)-1px)]",
    { gap: "gap-2" },
  ],
  "inline-end": [
    "justify-center has-[>:last-child[data-slot=badge]]:-me-1.5 order-last has-[>kbd:last-child]:me-[-0.35rem]",
    {
      gap: "gap-2",
      button: "has-[>button]:-me-2",
      padding: "pe-[calc(--spacing(3)-1px)]",
      smPadding: "[[data-size=sm]+&]:pe-[calc(--spacing(2.5)-1px)]",
    },
    {
      gap: "gap-0.5",
      button: "has-[>button]:me-0",
      padding: "pe-1",
      smPadding: "[[data-size=sm]+&]:pe-1",
    },
  ],
  "inline-start": [
    "justify-center has-[>:last-child[data-slot=badge]]:-ms-1.5 order-first has-[>kbd:last-child]:ms-[-0.35rem]",
    {
      gap: "gap-2",
      button: "has-[>button]:-ms-2",
      padding: "ps-[calc(--spacing(3)-1px)]",
      smPadding: "[[data-size=sm]+&]:ps-[calc(--spacing(2.5)-1px)]",
    },
    {
      gap: "gap-0.5",
      button: "has-[>button]:ms-0",
      padding: "ps-1",
      smPadding: "[[data-size=sm]+&]:ps-1",
    },
  ],
} satisfies Record<string, readonly [string, Record<string, string>, Record<string, string>?]>;

type InputGroupAddonAlign = keyof typeof ALIGNS;

function inputGroupAddonVariants(
  options: {
    align?: InputGroupAddonAlign | undefined;
    inset?: "default" | "pill" | undefined;
    class?: string | undefined;
  } = {},
) {
  const [alignClass, parts, pillParts] = ALIGNS[options.align ?? "inline-start"] as readonly [
    string,
    Record<string, string>,
    Record<string, string>?,
  ];
  const pill = options.inset === "pill";
  return [
    ADDON_BASE,
    ...Object.values(pill && pillParts !== undefined ? pillParts : parts),
    alignClass,
    pill ? "[&_button]:rounded-full" : "",
    options.class,
  ]
    .filter(Boolean)
    .join(" ");
}

const INTERACTIVE =
  "button, a, input, select, textarea, [role='button'], [role='combobox'], [role='listbox'], [data-slot='select-trigger']";

export function InputGroupAddon(
  props: JSX.HTMLAttributes<HTMLDivElement> & {
    align?: InputGroupAddonAlign;
    inset?: "default" | "pill";
  },
) {
  const [local, rest] = splitProps(props, ["align", "inset", "class"]);
  return (
    <div
      class={inputGroupAddonVariants({
        align: local.align,
        inset: local.inset,
        class: local.class,
      })}
      data-align={local.align ?? "inline-start"}
      data-slot="input-group-addon"
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
        event.preventDefault();
        const parent = event.currentTarget.parentElement;
        const field = parent?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          "input, textarea",
        );
        if (field && !parent?.querySelector("input:focus, textarea:focus")) field.focus();
      }}
      {...rest}
    />
  );
}

export function InputGroupInput(props: Omit<InputProps, "unstyled">) {
  return <Input {...props} unstyled />;
}
