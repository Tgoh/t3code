const GROUPS = {
  position: /^(?:static|fixed|absolute|relative|sticky)$/,
  width: /^(?:w|size)-/,
  minWidth: /^min-w-/,
};

/**
 * Whether a call site's `class` sets this property without a variant prefix. The component then
 * leaves out its own class for it, as tailwind-merge would: two utilities for one property resolve
 * by Tailwind's order, not the class order.
 */
export function overrides(callClass: string | undefined, group: keyof typeof GROUPS): boolean {
  return (
    callClass !== undefined && callClass.split(/\s+/).some((token) => GROUPS[group].test(token))
  );
}
