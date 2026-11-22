import { type JSX, splitProps } from "solid-js";

import { ChevronDown } from "../icons";

const TONES = {
  muted: { label: "text-sidebar-muted-foreground", line: "bg-sidebar-border/50" },
  emphasized: { label: "text-sidebar-foreground/80", line: "bg-sidebar-foreground/25" },
  accent: { label: "text-primary", line: "bg-primary/50" },
};

export function CollapsibleSectionHeader(
  props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "style" | "aria-expanded"> & {
    expanded: boolean;
    tone?: keyof typeof TONES;
    variant?: "default" | "panel";
    accessory?: JSX.Element;
  },
) {
  const [local, rest] = splitProps(props, ["children", "expanded", "tone", "variant", "accessory"]);
  const tone = () => TONES[local.tone ?? "muted"];
  return (
    <button
      {...rest}
      type="button"
      aria-expanded={local.expanded}
      class={[
        "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md text-left text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
        local.variant === "panel" ? "ps-2 pe-2.5" : "px-2",
        tone().label,
      ].join(" ")}
    >
      <span class="min-w-0 truncate">{local.children}</span>
      {/* A header with a trailing count drops its rule so it doesn't read as a leader. */}
      <span
        aria-hidden="true"
        class={["h-px min-w-2 flex-1", tone().line, local.accessory ? "invisible" : ""]
          .filter(Boolean)
          .join(" ")}
      />
      {local.accessory}
      <ChevronDown
        aria-hidden="true"
        class={`size-3 shrink-0 transition-transform${local.expanded ? "" : " -rotate-90"}`}
      />
    </button>
  );
}

export function SectionHeaderStatus(props: { children: JSX.Element }) {
  return (
    <span class="shrink-0 text-3xs leading-none text-destructive-foreground">{props.children}</span>
  );
}
