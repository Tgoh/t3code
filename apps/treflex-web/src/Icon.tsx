import type { JSX } from "@solidjs/web";
import type { IconNode } from "lucide";
import { type Component, omit } from "solid-js";

export type IIconProps = JSX.IntrinsicElements["svg"] & {
  size?: number | string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
};

const SVG_NS = "http://www.w3.org/2000/svg";

const isA11yProp = (prop: string) =>
  prop.startsWith("aria-") || prop === "role" || prop === "title";

function glyph(node: IconNode) {
  return node.map(([tag, attrs]) => {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value !== undefined) element.setAttribute(name, String(value));
    }
    return element;
  });
}

export function Icon(props: IIconProps & { name: string; node: IconNode }) {
  const rest = omit(
    props,
    "name",
    "node",
    "size",
    "color",
    "strokeWidth",
    "absoluteStrokeWidth",
    "class",
    "children",
  );
  const strokeWidth = () => {
    const width = Number(props.strokeWidth ?? 2);
    return props.absoluteStrokeWidth ? (width * 24) / Number(props.size) : width;
  };
  return (
    <svg
      xmlns={SVG_NS}
      width={props.size ?? 24}
      height={props.size ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke={props.color ?? "currentColor"}
      stroke-width={strokeWidth()}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={
        props.class ? `lucide lucide-${props.name} ${props.class}` : `lucide lucide-${props.name}`
      }
      aria-hidden={!props.children && !Object.keys(rest).some(isA11yProp) ? "true" : undefined}
      {...rest}
    >
      {glyph(props.node)}
    </svg>
  );
}

export function icon(name: string, node: IconNode): Component<IIconProps> {
  return (props) => <Icon {...props} name={name} node={node} />;
}
