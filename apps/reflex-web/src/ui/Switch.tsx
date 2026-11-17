const SWITCH =
  "group relative h-5 w-[34px] flex-none cursor-pointer rounded-full border-0 bg-input p-0.5 disabled:cursor-default disabled:opacity-50 aria-checked:bg-primary";

export function Switch(props: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  class?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      class={`${SWITCH} ${props.class ?? ""}`}
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    >
      <span class="block size-4 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/20%)] transition-transform duration-150 ease-[ease] group-aria-checked:translate-x-[14px]" />
    </button>
  );
}

/** The switch drawn inside a menu row, which itself carries the switch role. */
export function MenuSwitch(props: { on: boolean }) {
  return (
    <span
      class="relative h-4 w-7 flex-none rounded-full bg-input after:absolute after:top-0.5 after:left-0.5 after:size-3 after:rounded-full after:bg-white data-on:bg-primary data-on:after:left-3.5"
      data-on={props.on ? "" : undefined}
    />
  );
}
