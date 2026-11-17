import { getProviderClient } from "@t3tools/client-runtime/provider-clients";
import type { ProjectIconColor } from "@t3tools/contracts";
import { useResource } from "treflex-solid";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Match,
  on,
  Show,
  Switch,
  untrack,
} from "solid-js";
import { Dynamic } from "solid-js/web";

import Environment from "./Environment";
import { FolderCode } from "./icons";
import type { IWireProject } from "./Infrastructure/wire";
import {
  faviconKey,
  faviconTarget,
  projectColor,
  projectIconFace,
  projectMonogram,
} from "./projectIcon";

export function T3Mark() {
  return (
    <svg class="h-[1cap] w-auto flex-none" viewBox="15.5309 37 94.3941 56.96" aria-label="T3">
      <path
        d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z"
        fill="currentColor"
      />
    </svg>
  );
}

// Each pair is Tailwind's -600 and -400, as in apps/web/src/projectIconColors.ts.
const ICON_COLORS: Record<ProjectIconColor, string> = {
  gray: "var(--muted-foreground)",
  red: "light-dark(oklch(57.7% 0.245 27.325), oklch(70.4% 0.191 22.216))",
  orange: "light-dark(oklch(64.6% 0.222 41.116), oklch(75% 0.183 55.934))",
  amber: "light-dark(oklch(66.6% 0.179 58.318), oklch(82.8% 0.189 84.429))",
  yellow: "light-dark(oklch(68.1% 0.162 75.834), oklch(85.2% 0.199 91.936))",
  lime: "light-dark(oklch(64.8% 0.2 131.684), oklch(84.1% 0.238 128.85))",
  green: "light-dark(oklch(62.7% 0.194 149.214), oklch(79.2% 0.209 151.711))",
  emerald: "light-dark(oklch(59.6% 0.145 163.225), oklch(76.5% 0.177 163.223))",
  teal: "light-dark(oklch(60% 0.118 184.704), oklch(77.7% 0.152 181.912))",
  cyan: "light-dark(oklch(60.9% 0.126 221.723), oklch(78.9% 0.154 211.53))",
  sky: "light-dark(oklch(58.8% 0.158 241.966), oklch(74.6% 0.16 232.661))",
  blue: "light-dark(oklch(54.6% 0.245 262.881), oklch(70.7% 0.165 254.624))",
  indigo: "light-dark(oklch(51.1% 0.262 276.966), oklch(67.3% 0.182 276.935))",
  violet: "light-dark(oklch(54.1% 0.281 293.009), oklch(70.2% 0.183 293.541))",
  purple: "light-dark(oklch(55.8% 0.288 302.321), oklch(71.4% 0.203 305.504))",
  fuchsia: "light-dark(oklch(59.1% 0.293 322.896), oklch(74% 0.238 322.16))",
  pink: "light-dark(oklch(59.2% 0.249 0.584), oklch(71.8% 0.202 349.761))",
  rose: "light-dark(oklch(58.6% 0.253 17.585), oklch(71.2% 0.194 13.428))",
};

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function Monogram(props: { text: string; color: ProjectIconColor }) {
  return (
    <svg
      class="size-full overflow-hidden rounded-[25%] bg-[color-mix(in_srgb,currentcolor_14%,transparent)] font-mono"
      viewBox="0 0 16 16"
      style={{ color: ICON_COLORS[props.color] }}
    >
      <text
        x="8"
        y="10.8"
        text-anchor="middle"
        fill="currentColor"
        font-size="8.25"
        font-weight="700"
        textLength={Array.from(graphemes.segment(props.text)).length === 1 ? 6 : 12}
        lengthAdjust="spacingAndGlyphs"
        text-rendering="geometricPrecision"
      >
        {props.text}
      </text>
    </svg>
  );
}

type ILucideIcons = Record<string, Component<{ class?: string }> | undefined>;
const [lucideIcons, setLucideIcons] = createSignal<ILucideIcons>();
let lucideLoading: Promise<void> | undefined;

// The whole set loads as one chunk, and only once a project uses a lucide override.
function LucideIcon(props: { name: string; color: ProjectIconColor }) {
  lucideLoading ??= import("lucide-solid").then((module) => {
    setLucideIcons(() => module as unknown as ILucideIcons);
  });
  const pascal = () =>
    props.name
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
  return (
    <span class="size-full [&_svg]:size-full" style={{ color: ICON_COLORS[props.color] }}>
      <Dynamic component={lucideIcons()?.[pascal()] ?? FolderCode} />
    </span>
  );
}

// Follows ProjectFavicon in apps/web/src/components/ProjectFavicon.tsx. Every face fills the same
// fixed box, so swapping the monogram for the image, or back on a load error, never shifts layout.
export function ProjectBadge(props: { project: IWireProject | undefined; size?: number }) {
  const environment = Environment.use();
  const favicons = useResource(environment.state, "Project/Favicons");
  const target = createMemo(() => faviconTarget(environment.state.EnvironmentId, props.project));
  const key = createMemo(() => {
    const held = target();
    return held === null ? null : faviconKey(held);
  });
  createEffect(
    on(key, (held) => {
      const asked = target();
      if (held === null || asked === null) return;
      if (untrack(favicons.value)?.[held] !== undefined) return;
      environment.requestProjectFavicon(asked);
    }),
  );
  const [failedSrc, setFailedSrc] = createSignal<string | null>(null);
  const [loadedSrc, setLoadedSrc] = createSignal<string | null>(null);
  const face = createMemo(() => {
    const held = key();
    return projectIconFace(
      props.project,
      held === null ? null : favicons.value()?.[held],
      failedSrc(),
    );
  });
  const title = () => props.project?.title ?? "Unknown project";
  const monogram = () => <Monogram text={projectMonogram(title())} color={projectColor(title())} />;
  return (
    <span
      class="relative inline-flex flex-none items-center justify-center select-none"
      aria-hidden="true"
      style={{ width: `${props.size ?? 16}px`, height: `${props.size ?? 16}px` }}
    >
      <Switch>
        <Match when={face().Kind === "image" && (face() as { Src: string }).Src} keyed>
          {(src) => {
            const shown = () => src.startsWith("data:image/") || loadedSrc() === src;
            return (
              <>
                <Show when={!shown()}>{monogram()}</Show>
                <img
                  class={
                    shown()
                      ? "size-full rounded-[25%] object-contain"
                      : "invisible absolute inset-0 size-full rounded-[25%] object-contain"
                  }
                  src={src}
                  alt=""
                  onLoad={() => setLoadedSrc(src)}
                  onError={() => setFailedSrc(src)}
                />
              </>
            );
          }}
        </Match>
        <Match when={face().Kind === "emoji" && (face() as { Emoji: string }).Emoji}>
          {(emoji) => (
            <span class="leading-none" style={{ "font-size": `${(props.size ?? 16) * 0.8}px` }}>
              {emoji()}
            </span>
          )}
        </Match>
        <Match
          when={face().Kind === "lucide" && (face() as { Name: string; Color: ProjectIconColor })}
        >
          {(icon) => <LucideIcon name={icon().Name} color={icon().Color} />}
        </Match>
        <Match
          when={face().Kind === "monogram" && (face() as { Text: string; Color: ProjectIconColor })}
        >
          {(mono) => <Monogram text={mono().Text} color={mono().Color} />}
        </Match>
      </Switch>
    </span>
  );
}

// Paths copy OpenAI and ClaudeAI in apps/web/src/components/Icons.tsx.
export function ProviderIcon(props: { driver: string | undefined; size?: number | undefined }) {
  const size = () => props.size ?? 16;
  return (
    <>
      <Show when={props.driver === "claudeAgent"}>
        <svg
          class="provider-icon flex-none fill-[#d97757]"
          viewBox="0 0 256 257"
          width={size()}
          height={size()}
          aria-hidden="true"
        >
          <path d="m50.228 170.321 50.357-28.257.843-2.463-.843-1.361h-2.462l-8.426-.518-28.775-.778-24.952-1.037-24.175-1.296-6.092-1.297L0 125.796l.583-3.759 5.12-3.434 7.324.648 16.202 1.101 24.304 1.685 17.629 1.037 26.118 2.722h4.148l.583-1.685-1.426-1.037-1.101-1.037-25.147-17.045-27.22-18.017-14.258-10.37-7.713-5.25-3.888-4.925-1.685-10.758 7-7.713 9.397.649 2.398.648 9.527 7.323 20.35 15.75L94.817 91.9l3.889 3.24 1.555-1.102.195-.777-1.75-2.917-14.453-26.118-15.425-26.572-6.87-11.018-1.814-6.61c-.648-2.723-1.102-4.991-1.102-7.778l7.972-10.823L71.42 0 82.05 1.426l4.472 3.888 6.61 15.101 10.694 23.786 16.591 32.34 4.861 9.592 2.592 8.879.973 2.722h1.685v-1.556l1.36-18.211 2.528-22.36 2.463-28.776.843-8.1 4.018-9.722 7.971-5.25 6.222 2.981 5.12 7.324-.713 4.73-3.046 19.768-5.962 30.98-3.889 20.739h2.268l2.593-2.593 10.499-13.934 17.628-22.036 7.778-8.749 9.073-9.657 5.833-4.601h11.018l8.1 12.055-3.628 12.443-11.342 14.388-9.398 12.184-13.48 18.147-8.426 14.518.778 1.166 2.01-.194 30.46-6.481 16.462-2.982 19.637-3.37 8.88 4.148.971 4.213-3.5 8.62-20.998 5.184-24.628 4.926-36.682 8.685-.454.324.519.648 16.526 1.555 7.065.389h17.304l32.21 2.398 8.426 5.574 5.055 6.805-.843 5.184-12.962 6.611-17.498-4.148-40.83-9.721-14-3.5h-1.944v1.167l11.666 11.406 21.387 19.314 26.767 24.887 1.36 6.157-3.434 4.86-3.63-.518-23.526-17.693-9.073-7.972-20.545-17.304h-1.36v1.814l4.73 6.935 25.017 37.59 1.296 11.536-1.814 3.76-6.481 2.268-7.13-1.297-14.647-20.544-15.1-23.138-12.185-20.739-1.49.843-7.194 77.448-3.37 3.953-7.778 2.981-6.48-4.925-3.436-7.972 3.435-15.749 4.148-20.544 3.37-16.333 3.046-20.285 1.815-6.74-.13-.454-1.49.194-15.295 20.999-23.267 31.433-18.406 19.702-4.407 1.75-7.648-3.954.713-7.064 4.277-6.286 25.47-32.405 15.36-20.092 9.917-11.6-.065-1.686h-.583L44.07 198.125l-12.055 1.555-5.185-4.86.648-7.972 2.463-2.593 20.35-13.999-.064.065Z" />
        </svg>
      </Show>
      <Show when={props.driver === "codex"}>
        <svg
          class="provider-icon flex-none"
          viewBox="100 100 411 411"
          width={size()}
          height={size()}
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M252.794 108.802C289.191 99.0484 326.265 110.305 351.148 135.135C385.113 126.072 422.85 134.862 449.492 161.505C476.136 188.149 484.925 225.888 475.862 259.85V259.854C500.696 284.735 511.95 321.81 502.198 358.207C492.447 394.602 464.161 421.084 430.215 430.217C421.083 464.162 394.603 492.448 358.206 502.199C321.812 511.951 284.734 500.693 259.852 475.864C225.887 484.927 188.15 476.137 161.507 449.495C134.864 422.851 126.073 385.111 135.136 351.149C110.304 326.266 99.0496 289.192 108.801 252.795C118.552 216.4 146.84 189.918 180.784 180.785C189.917 146.841 216.396 118.553 252.794 108.802ZM374.292 407.145C374.292 411.271 372.092 415.086 368.517 417.148L283.723 466.102C302.487 480.585 327.555 486.459 352.217 479.852C386.997 470.532 410.068 439.312 410.555 405.006V317.717C410.555 315.08 409.125 312.621 406.843 311.303L374.292 292.509V407.145ZM251.868 415.897C248.296 417.959 243.893 417.959 240.317 415.897L155.526 366.942C152.366 390.436 159.811 415.08 177.866 433.136H177.863C203.325 458.594 241.896 462.962 271.85 446.232L347.449 402.586C349.735 401.268 351.148 398.8 351.148 396.163V358.579L251.868 415.897ZM368.602 220.628C366.319 219.309 363.474 219.318 361.191 220.637L328.641 239.431L427.921 296.749C431.496 298.811 433.697 302.627 433.697 306.752V404.661C455.622 395.654 473.244 376.881 479.851 352.218C489.169 317.442 473.668 281.85 444.201 264.274L368.602 220.628ZM177.303 206.34C155.377 215.348 137.756 234.122 131.148 258.783C121.832 293.561 137.331 329.153 166.799 346.727L242.398 390.373C244.68 391.692 247.525 391.684 249.807 390.366L282.357 371.572L183.078 314.253C179.504 312.189 177.303 308.375 177.303 304.251V206.34ZM259.849 279.145V331.858L305.5 358.213L351.15 331.858V279.145L305.5 252.789L259.849 279.145ZM327.276 144.9C308.512 130.418 283.445 124.543 258.782 131.15C224.002 140.471 200.931 171.691 200.445 205.995V293.286C200.445 295.923 201.875 298.381 204.158 299.7L236.707 318.493V203.856C236.707 199.731 238.909 195.916 242.483 193.853L327.276 144.9ZM433.137 177.867C407.675 152.407 369.103 148.038 339.149 164.769L263.55 208.415C261.265 209.734 259.852 212.202 259.852 214.838V252.423L359.132 195.105C362.703 193.041 367.108 193.041 370.682 195.105L455.473 244.06C458.635 220.567 451.189 195.922 433.135 177.867H433.137Z"
          />
        </svg>
      </Show>
      <Show when={packageIcon(props.driver)}>
        {(icon) => <PackageIcon icon={icon()} size={size()} />}
      </Show>
    </>
  );
}

/** Whether `ProviderIcon` draws a mark for this driver, rather than nothing. */
export const hasProviderIcon = (driver: string | undefined) =>
  driver === "claudeAgent" || driver === "codex" || packageIcon(driver) !== undefined;

type IPackageIcon = NonNullable<NonNullable<ReturnType<typeof getProviderClient>>["icon"]>;

// Stock draws an ACP Registry agent from the registry's own icon, not the driver's package mark.
const packageIcon = (driver: string | undefined) =>
  driver === "acpRegistry" ? undefined : getProviderClient(driver)?.icon;

// Follows ProviderPackageIcon in apps/web/src/components/chat/ProviderPackageIcon.tsx. The fill
// swaps on the `dark:` variant, which follows the appearance setting, not the OS scheme.
function PackageIcon(props: { icon: IPackageIcon; size: number }) {
  const gradientId = createUniqueId();
  return (
    <svg
      class="provider-icon flex-none fill-(--icon-light) dark:fill-(--icon-dark)"
      viewBox={props.icon.viewBox}
      width={props.size}
      height={props.size}
      fill="none"
      aria-hidden="true"
      style={{ "--icon-light": props.icon.fill.light, "--icon-dark": props.icon.fill.dark }}
    >
      <Show when={props.icon.paths.some((path) => path.gradient)}>
        <defs>
          <For each={props.icon.paths}>
            {(path, index) => (
              <Show when={path.gradient}>
                {(gradient) => (
                  <linearGradient
                    id={`${gradientId}-${index()}`}
                    x1={gradient().x1}
                    y1={gradient().y1}
                    x2={gradient().x2}
                    y2={gradient().y2}
                    gradientUnits="userSpaceOnUse"
                  >
                    <For each={gradient().stops}>
                      {(stop) => <stop offset={stop.offset} stop-color={stop.color} />}
                    </For>
                  </linearGradient>
                )}
              </Show>
            )}
          </For>
        </defs>
      </Show>
      <For each={props.icon.paths}>
        {(path, index) => (
          <path
            d={path.d}
            fill-rule={path.fillRule}
            fill={path.gradient ? `url(#${gradientId}-${index()})` : undefined}
            class={path.fill ? "fill-(--path-light) dark:fill-(--path-dark)" : undefined}
            style={
              path.fill ? { "--path-light": path.fill.light, "--path-dark": path.fill.dark } : {}
            }
          />
        )}
      </For>
    </svg>
  );
}
