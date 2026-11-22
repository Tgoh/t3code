import { createContext, type JSX, splitProps, useContext } from "solid-js";

const GROUPS = {
  subtle: "flex rounded-lg bg-[color-mix(in_srgb,var(--input)_40%,transparent)] p-0.5",
  card: "inline-flex rounded-lg border border-border bg-muted p-0.5",
};

const SEGMENTS = {
  subtle:
    "flex h-6 flex-1 cursor-pointer items-center justify-center gap-1 rounded-md border-0 bg-transparent px-2 py-0 text-[12px] text-muted-foreground hover:text-foreground aria-checked:bg-[color-mix(in_srgb,var(--input)_72%,transparent)] aria-checked:text-foreground aria-pressed:bg-[color-mix(in_srgb,var(--input)_72%,transparent)] aria-pressed:text-foreground",
  card: "h-6 cursor-pointer rounded-md border-0 bg-transparent px-2 py-0 text-[13px] whitespace-nowrap text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-[0_1px_2px_rgb(0_0_0/8%)]",
};

type ISegmentedVariant = keyof typeof GROUPS;

const Variant = createContext<ISegmentedVariant>("subtle");

/** A row of segments. The selected one carries `aria-checked` or `aria-pressed`. */
export function Segmented(
  props: JSX.HTMLAttributes<HTMLDivElement> & { variant?: ISegmentedVariant },
) {
  const [local, rest] = splitProps(props, ["variant", "children"]);
  return (
    <Variant.Provider value={local.variant ?? "subtle"}>
      <div {...rest} class={GROUPS[local.variant ?? "subtle"]}>
        {local.children}
      </div>
    </Variant.Provider>
  );
}

/** `labelled` draws a smaller icon beside the label. */
export function Segment(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { labelled?: boolean },
) {
  const variant = useContext(Variant);
  const [local, rest] = splitProps(props, ["labelled"]);
  return (
    <button
      type="button"
      {...rest}
      class={`${SEGMENTS[variant]} ${local.labelled ? "[&_svg]:size-3" : "[&_svg]:size-3.5"}`}
    />
  );
}
