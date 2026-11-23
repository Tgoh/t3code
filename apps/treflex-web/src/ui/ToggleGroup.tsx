import type { JSX } from "@solidjs/web";
import { createContext, createSignal, omit, useContext } from "solid-js";

import { createRoving } from "./roving";
import { Toggle as ToggleComponent, type ToggleSize, type ToggleVariant } from "./Toggle";

interface IGroup {
  variant: ToggleVariant;
  size: ToggleSize;
  pressed: (value: string) => boolean;
  press: (value: string, pressed: boolean) => void;
  roving: ReturnType<typeof createRoving>;
}

const Group = createContext<IGroup>();

const BASE =
  "flex w-fit *:focus-visible:z-10 dark:*:[[data-slot=separator]:has(+[data-slot=toggle]:hover)]:before:bg-input/64 dark:*:[[data-slot=separator]:has(+[data-slot=toggle][data-pressed])]:before:bg-input dark:*:[[data-slot=toggle]:hover+[data-slot=separator]]:before:bg-input/64 dark:*:[[data-slot=toggle][data-pressed]+[data-slot=separator]]:before:bg-input";

const JOINED = {
  horizontal:
    "*:not-first:not-data-[slot=separator]:before:-start-[0.5px] *:not-last:not-data-[slot=separator]:before:-end-[0.5px] *:not-first:rounded-s-none *:not-last:rounded-e-none *:not-first:border-s-0 *:not-last:border-e-0 *:not-first:before:rounded-s-none *:not-last:before:rounded-e-none",
  vertical:
    "*:not-first:not-data-[slot=separator]:before:-top-[0.5px] *:not-last:not-data-[slot=separator]:before:-bottom-[0.5px] flex-col *:not-first:rounded-t-none *:not-last:rounded-b-none *:not-first:border-t-0 *:not-last:border-b-0 *:not-first:before:rounded-t-none *:not-last:before:rounded-b-none *:data-[slot=toggle]:not-last:before:hidden dark:*:last:before:hidden dark:*:first:before:block",
};

/**
 * Base UI's toggle group: `value` lists the pressed toggles, and pressing the pressed one of a
 * single-choice group empties it. One tab stop; the arrow keys, Home and End move focus only.
 */
export function ToggleGroup(
  props: JSX.HTMLAttributes<HTMLDivElement> & {
    value: readonly string[];
    onValueChange: (value: string[]) => void;
    multiple?: boolean;
    variant?: ToggleVariant;
    size?: ToggleSize;
    orientation?: "horizontal" | "vertical";
  },
) {
  const rest = omit(
    props,
    "value",
    "onValueChange",
    "multiple",
    "variant",
    "size",
    "orientation",
    "class",
    "children",
  );
  const variant = () => props.variant ?? "segmented";
  const size = () => props.size ?? (variant() === "segmented" ? "segmented" : "default");
  const orientation = () => props.orientation ?? "horizontal";
  const roving = createRoving({ orientation, homeEnd: true });
  const shape = () =>
    variant() === "segmented"
      ? "gap-0.5 rounded-lg bg-input/40 p-0.5"
      : variant() === "default"
        ? "gap-0.5"
        : JOINED[orientation()];
  return (
    <div
      role="group"
      data-slot="toggle-group"
      data-variant={variant()}
      data-size={size()}
      data-orientation={orientation()}
      {...rest}
      class={[
        BASE,
        orientation() === "horizontal"
          ? "*:pointer-coarse:after:min-w-auto"
          : "*:pointer-coarse:after:min-h-auto",
        shape(),
        props.class,
      ]
        .filter(Boolean)
        .join(" ")}
      onFocusIn={roving.onFocusIn}
      onKeyDown={roving.onKeyDown}
    >
      <Group
        value={{
          get variant() {
            return variant();
          },
          get size() {
            return size();
          },
          pressed: (value) => props.value.includes(value),
          press: (value, pressed) => {
            const held = props.value.filter((entry) => entry !== value);
            props.onValueChange(
              pressed ? (props.multiple === true ? [...held, value] : [value]) : held,
            );
          },
          roving,
        }}
      >
        {props.children}
      </Group>
    </div>
  );
}

export function Toggle(
  props: Omit<Parameters<typeof ToggleComponent>[0], "pressed" | "value" | "onClick"> & {
    value: string;
  },
) {
  const group = useContext(Group);
  const rest = omit(props, "variant", "size", "value", "disabled");
  const [element, setElement] = createSignal<HTMLButtonElement>();
  const register = group.roving.register({
    active: () => false,
    disabled: () => props.disabled === true || rest["aria-disabled"] === "true",
  });
  const pressed = () => group.pressed(props.value);
  return (
    <ToggleComponent
      data-variant={props.variant ?? group.variant}
      data-size={props.size ?? group.size}
      variant={props.variant ?? group.variant}
      size={props.size ?? group.size}
      {...rest}
      ref={(item) => {
        setElement(item);
        register(item);
      }}
      tabindex={group.roving.tabIndex(element())}
      disabled={props.disabled}
      pressed={pressed()}
      onClick={() => group.press(props.value, !pressed())}
    />
  );
}
