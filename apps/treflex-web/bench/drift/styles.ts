export interface IStyledElement {
  Slot: string;
  Text: string;
  Disabled: boolean;
  Style: Record<string, string>;
}

/** Controls with a fixed height in stock's variants; other slots size to their content. */
const SIZED = new Set([
  "button",
  "toggle",
  "input",
  "input-control",
  "select-trigger",
  "switch",
  "checkbox",
  "kbd",
  "badge",
  "sidebar-menu-button",
  "menu-item",
  "menu-checkbox-item",
  "menu-radio-item",
  "select-item",
  "combobox-item",
  "command-item",
  "dialog-action",
  "dialog-close",
  "alert-dialog-close",
]);

export function lookOf(style: Record<string, string>, slot: string): Record<string, string> {
  if (SIZED.has(slot)) return style;
  const { height: _height, ...rest } = style;
  return rest;
}

/** Runs in the page, so it can't reach anything outside its own body. */
export function collectStyles(root: Element): Array<IStyledElement> {
  const properties = [
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "text-transform",
    "color",
    "background-color",
    "background-image",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-top-color",
    "border-top-left-radius",
    "border-bottom-right-radius",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "gap",
    "box-shadow",
    "opacity",
    "backdrop-filter",
  ];
  // Stock and treflex resolve the same token to different color syntaxes, so compare 8-bit sRGB.
  const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const toRgba = (color: string) => {
    canvas.clearRect(0, 0, 1, 1);
    canvas.fillStyle = "#000";
    canvas.fillStyle = color;
    canvas.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
    return `rgba(${r},${g},${b},${a})`;
  };
  const colors = /(?:rgba?|oklch|oklab|lab|lch|color|hsla?)\([^()]*\)/g;
  const normalize = (value: string) => value.replace(colors, toRgba);
  const elements = [root, ...root.querySelectorAll("[data-slot]")].filter((element) =>
    element.hasAttribute("data-slot"),
  );
  const found: Array<IStyledElement> = [];
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    if (rect.width === 0 || rect.height === 0 || computed.visibility === "hidden") continue;
    // An unstyled part owns no look; all it shows is inherited.
    if (!element.getAttribute("class")?.trim()) continue;
    const slot = element.getAttribute("data-slot")!;
    const style: Record<string, string> = {};
    for (const property of properties)
      style[property] = normalize(computed.getPropertyValue(property));
    const bordered = ["top", "right", "bottom", "left"].some(
      (side) => computed.getPropertyValue(`border-${side}-width`) !== "0px",
    );
    if (!bordered) delete style["border-top-color"];
    const shadows = style["box-shadow"]!.split(/,(?![^()]*\))/)
      .map((layer) => layer.trim())
      .filter((layer) => layer !== "none" && !layer.includes("rgba(0,0,0,0)"));
    style["box-shadow"] = shadows.length === 0 ? "none" : shadows.join(", ");
    style.height = `${Math.round(rect.height)}px`;
    found.push({
      Slot: slot,
      Text: (element.textContent?.trim() || element.getAttribute("aria-label")?.trim() || "").slice(
        0,
        48,
      ),
      Disabled: element.matches(":disabled, [aria-disabled='true'], [data-disabled]"),
      Style: style,
    });
  }
  return found;
}
