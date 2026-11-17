import { type JSX, splitProps } from "solid-js";

const BASE =
  "flex flex-none items-center gap-3 bg-background pl-5 in-[.sidebar-sheet]:gap-1 in-[.sidebar-sheet]:pr-[calc(8px+env(safe-area-inset-right))] in-[.sidebar-sheet]:pl-[calc(8px+env(safe-area-inset-left))]";

const VARIANTS = {
  thread: "h-(--topbar-height) pr-[13px]",
  page: "h-12 border-b border-border pr-2",
};

/** The bar across the top of the main column: a thread's, or a page's such as settings or usage. */
export function PageHeader(
  props: JSX.HTMLAttributes<HTMLElement> & { variant?: keyof typeof VARIANTS },
) {
  const [local, rest] = splitProps(props, ["variant", "class"]);
  return (
    <header
      {...rest}
      class={`${BASE} ${VARIANTS[local.variant ?? "thread"]}${local.class ? ` ${local.class}` : ""}`}
    />
  );
}

export const BREADCRUMB =
  "flex min-w-0 flex-1 items-center gap-1.5 text-[14px] leading-5 font-medium";
export const CRUMB_TITLE = "m-0 min-w-0 truncate [font:inherit]";
export const CRUMB_MUTED =
  "max-w-40 flex-none truncate text-muted-foreground in-[.sidebar-sheet]:max-w-24";
export const CRUMB_SEPARATOR = "mx-1.5 font-normal text-muted-foreground";
