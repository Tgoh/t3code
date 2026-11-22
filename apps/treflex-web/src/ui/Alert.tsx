import { children, createMemo, type JSX, Show, splitProps } from "solid-js";

const BASE = "relative border";

// Stands in for tailwind-merge: a variant replaces these base classes by name, since two
// utilities for one property resolve by Tailwind's order, not the class order.
const PARTS = {
  radius: "rounded-xl",
  padding: "px-3.5 py-3",
  color: "text-card-foreground",
  fontSize: "text-sm",
};

type IParts = Partial<Record<keyof typeof PARTS, string>>;

const SURFACES = {
  default: "",
  glass: "alert-glass",
};

const VARIANTS = {
  default: ["bg-transparent dark:bg-input/32 [&_svg]:text-muted-foreground"],
  sidebar: [
    "border-sidebar-border bg-sidebar-control-surface leading-4 [&_[data-slot=alert-description]]:block [&_[data-slot=alert-description]]:text-sidebar-muted-foreground",
    { radius: "rounded-lg", padding: "px-2 py-1.5", fontSize: "text-[11px]" },
  ],
  error: [
    "border-error/32 bg-error-surface [&_[data-slot=alert-description]]:text-error-foreground/80 [&_svg]:text-error",
    { color: "text-error-foreground" },
  ],
  info: ["border-info/32 bg-info/4 [&_svg]:text-info"],
  success: ["border-success/32 bg-success/4 [&_svg]:text-success"],
  warning: [
    "border-warning/32 bg-warning-surface [&_[data-slot=alert-description]]:text-warning-foreground/80 [&_svg]:text-warning",
    { color: "text-warning-foreground" },
  ],
} satisfies Record<string, readonly [string, IParts?]>;

const join = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(" ");

function alertClass(
  variant: keyof typeof VARIANTS,
  surface: keyof typeof SURFACES,
  callClass: string | undefined,
) {
  const [variantClass, parts] = VARIANTS[variant] as readonly [string, IParts?];
  return join(
    BASE,
    ...Object.values({ ...PARTS, ...parts }),
    SURFACES[surface],
    variantClass,
    callClass,
  );
}

export function Alert(
  props: JSX.HTMLAttributes<HTMLDivElement> & {
    variant?: keyof typeof VARIANTS;
    surface?: keyof typeof SURFACES;
    controlAlignment?: "center" | "first-line";
  },
) {
  const [local, rest] = splitProps(props, [
    "variant",
    "surface",
    "controlAlignment",
    "class",
    "children",
  ]);
  const resolved = children(() => local.children);
  const slots = createMemo(() => {
    const icon: JSX.Element[] = [];
    const content: JSX.Element[] = [];
    const action: JSX.Element[] = [];
    for (const child of resolved.toArray()) {
      if (!(child instanceof Element)) {
        content.push(child);
        continue;
      }
      const slot = child.getAttribute("data-slot");
      if (slot === "alert-action") action.push(child);
      else if (slot === "alert-title" || slot === "alert-description") content.push(child);
      else icon.push(child);
    }
    return { icon, content, action };
  });
  const firstLine = () => local.controlAlignment === "first-line";
  const variant = () => local.variant ?? "default";
  return (
    <div
      data-slot="alert"
      data-variant={variant()}
      role="alert"
      {...rest}
      class={alertClass(variant(), local.surface ?? "default", local.class)}
    >
      <div
        class={join(
          "flex gap-2",
          firstLine() ? "items-start" : "items-center",
          firstLine() && slots().action.length > 0 && "min-h-7 pt-1 sm:min-h-6 sm:pt-0.5",
        )}
      >
        <Show when={slots().icon.length > 0}>
          <div
            class={join(
              "flex shrink-0 items-center justify-center",
              firstLine() ? "h-lh w-4 [&>svg]:size-4" : "size-4 [&>svg]:size-full",
            )}
          >
            {slots().icon}
          </div>
        </Show>
        <Show when={slots().content.length > 0}>
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">{slots().content}</div>
        </Show>
        <Show when={slots().action.length > 0}>
          <div
            class={join(
              "flex shrink-0 items-center",
              firstLine() ? "h-lh self-start" : "self-center",
            )}
          >
            {slots().action}
          </div>
        </Show>
      </div>
    </div>
  );
}

export function AlertTitle(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div data-slot="alert-title" {...rest} class={join("font-medium", local.class)} />;
}

export function AlertDescription(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      data-slot="alert-description"
      {...rest}
      class={join("flex flex-col gap-2.5 text-muted-foreground", local.class)}
    />
  );
}

export function AlertAction(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div data-slot="alert-action" {...rest} class={join("flex gap-1", local.class)} />;
}
