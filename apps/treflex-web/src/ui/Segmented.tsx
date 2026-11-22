import { type JSX, splitProps } from "solid-js";

const SEGMENT =
  "flex h-6 flex-1 cursor-pointer items-center justify-center gap-1 rounded-md border-0 bg-transparent px-2 py-0 text-[12px] text-muted-foreground hover:text-foreground aria-checked:bg-[color-mix(in_srgb,var(--input)_72%,transparent)] aria-checked:text-foreground aria-pressed:bg-[color-mix(in_srgb,var(--input)_72%,transparent)] aria-pressed:text-foreground";

/** A row of segments. The selected one carries `aria-checked` or `aria-pressed`. */
export function Segmented(props: JSX.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      class="flex rounded-lg bg-[color-mix(in_srgb,var(--input)_40%,transparent)] p-0.5"
    />
  );
}

/** `labelled` draws a smaller icon beside the label. */
export function Segment(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { labelled?: boolean },
) {
  const [local, rest] = splitProps(props, ["labelled"]);
  return (
    <button
      type="button"
      {...rest}
      class={`${SEGMENT} ${local.labelled ? "[&_svg]:size-3" : "[&_svg]:size-3.5"}`}
    />
  );
}
