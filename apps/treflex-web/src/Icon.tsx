import type { JSX } from "@solidjs/web";
import type { IconNode } from "lucide";
import { type Component, omit } from "solid-js";

export type IIconProps = Omit<JSX.IntrinsicElements["svg"], "class"> & {
  class?: string | undefined;
  size?: number | string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
};

const SVG_NS = "http://www.w3.org/2000/svg";

const isA11yProp = (prop: string) =>
  prop.startsWith("aria-") || prop === "role" || prop === "title";

const toPascal = (name: string) => {
  const camel = name.replace(/^([A-Z])|[\s-_]+(\w)/g, (_match, first?: string, next?: string) =>
    next ? next.toUpperCase() : (first ?? "").toLowerCase(),
  );
  return camel.charAt(0).toUpperCase() + camel.slice(1);
};
const toKebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

function classOf(name: string, extra: string | undefined) {
  const classes = [
    "lucide",
    "lucide-icon",
    `lucide-${toKebab(toPascal(name))}`,
    `lucide-${toKebab(name)}`,
    extra ?? "",
  ];
  return classes
    .filter((held, index) => held.trim() !== "" && classes.indexOf(held) === index)
    .join(" ")
    .trim();
}

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
      class={classOf(props.name, props.class)}
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
