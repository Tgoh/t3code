// @effect-diagnostics globalTimers:off -- A view-only height animation, outside any Effect runtime.
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
  splitProps,
  untrack,
} from "solid-js";
import { Dynamic } from "solid-js/web";

import { Check } from "../icons";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  type IPopupProps,
} from "./Dialog";
import { ScrollArea } from "./ScrollArea";

export function WizardPopup(
  props: Omit<IPopupProps, "class"> & {
    size?: "default" | "wide";
    showCloseButton?: boolean;
  },
) {
  const [local, rest] = splitProps(props, ["size", "children"]);
  return (
    <DialogPopup {...rest} size={local.size === "wide" ? "3xl" : "xl"}>
      <ScrollArea class="*:data-[slot=scroll-area-scrollbar]:data-[orientation=vertical]:my-4">
        <div class="flex min-h-0 flex-col">{local.children}</div>
      </ScrollArea>
    </DialogPopup>
  );
}

export function WizardHeader(props: {
  title: JSX.Element;
  description?: JSX.Element;
  identity?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <DialogHeader>
      <DialogTitle class={props.identity === undefined ? undefined : "sr-only"}>
        {props.title}
      </DialogTitle>
      {props.identity}
      <Show when={props.description}>
        <DialogDescription>{props.description}</DialogDescription>
      </Show>
      {props.children}
    </DialogHeader>
  );
}

export function WizardFooter(props: { children: JSX.Element }) {
  return <DialogFooter variant="bare">{props.children}</DialogFooter>;
}

const STEP =
  "flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-sm:justify-center max-sm:px-2";
const STEP_BUTTON =
  "cursor-pointer hover:bg-card disabled:cursor-default disabled:hover:bg-transparent";
const STEP_CURRENT =
  "bg-card text-foreground shadow-xs ring-1 ring-inset ring-black/5 hover:bg-card dark:shadow-none dark:ring-white/5";
const MARKER = "grid size-5 shrink-0 place-items-center rounded-full text-sm font-medium ring-1";
const MARKER_DONE = "bg-primary text-primary-foreground ring-primary";
const MARKER_CURRENT = "bg-primary/10 text-primary ring-primary/30";
const MARKER_NEXT =
  "bg-card text-muted-foreground ring-black/10 dark:bg-white/5 dark:ring-white/10";

export function WizardSteps(props: {
  steps: readonly string[];
  currentStep: number;
  summaries?: readonly (string | null)[];
  showSummaries?: boolean;
  isStepDisabled?: (step: number) => boolean;
  onStepChange?: (step: number) => void;
}) {
  const summary = (index: number) =>
    index < props.currentStep ? (props.summaries?.[index] ?? null) : null;
  return (
    <ol
      class="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-background p-1 ring-1 ring-black/5 dark:bg-white/4 dark:ring-white/5"
      role="list"
      aria-label="Setup progress"
    >
      <For each={props.steps}>
        {(step, index) => {
          const current = () => index() === props.currentStep;
          const button = () => props.onStepChange !== undefined;
          return (
            <li class="min-w-0">
              <Dynamic
                component={button() ? "button" : "div"}
                type={button() ? "button" : undefined}
                disabled={button() ? props.isStepDisabled?.(index()) : undefined}
                class={[STEP, button() ? STEP_BUTTON : "", current() ? STEP_CURRENT : ""]
                  .filter(Boolean)
                  .join(" ")}
                aria-current={current() ? "step" : undefined}
                aria-label={
                  summary(index()) === null
                    ? `${step}, step ${index() + 1}`
                    : `${step}, step ${index() + 1}, ${summary(index())}`
                }
                onClick={button() ? () => props.onStepChange?.(index()) : undefined}
              >
                <span
                  class={`${MARKER} ${
                    index() < props.currentStep
                      ? MARKER_DONE
                      : current()
                        ? MARKER_CURRENT
                        : MARKER_NEXT
                  }`}
                  aria-hidden="true"
                >
                  <Show when={index() < props.currentStep} fallback={index() + 1}>
                    <Check class="size-4 shrink-0" />
                  </Show>
                </span>
                <span
                  class={`min-w-0 truncate text-sm font-medium max-sm:hidden ${
                    current() ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {step}
                  {props.showSummaries === true && summary(index()) !== null
                    ? `: ${summary(index())}`
                    : null}
                </span>
              </Dynamic>
            </li>
          );
        }}
      </For>
    </ol>
  );
}

const HEIGHT_TRANSITION_FALLBACK_MS = 250;

function AnimatedHeight(props: { holdHeight: boolean; children: JSX.Element }) {
  const [content, setContent] = createSignal<HTMLDivElement>();
  const [height, setHeight] = createSignal<number | null>(null);
  const [clipping, setClipping] = createSignal(false);
  createEffect(() => {
    height();
    if (!clipping()) return;
    const timer = setTimeout(() => setClipping(false), HEIGHT_TRANSITION_FALLBACK_MS);
    onCleanup(() => clearTimeout(timer));
  });
  createEffect(() => {
    const element = content();
    if (props.holdHeight || element === undefined) return;
    const frames: number[] = [];
    const update = () => {
      const next = Math.ceil(element.scrollHeight || element.getBoundingClientRect().height);
      const previous = untrack(height);
      if (previous === next) return;
      setClipping(previous !== null);
      setHeight(next);
    };
    const cancel = () => frames.splice(0).forEach((frame) => cancelAnimationFrame(frame));
    const updateAfterPaint = () => {
      cancel();
      update();
      frames.push(
        requestAnimationFrame(() => {
          update();
          frames.push(requestAnimationFrame(update));
        }),
      );
    };
    updateAfterPaint();
    const observer = new ResizeObserver(updateAfterPaint);
    observer.observe(element);
    onCleanup(() => {
      observer.disconnect();
      cancel();
    });
  });
  return (
    <div
      data-slot="animated-height"
      class="transition-[height] duration-200 ease-out motion-reduce:transition-none [overflow-clip-margin:2px]"
      style={
        height() === null
          ? undefined
          : {
              height: `${height()}px`,
              overflow: props.holdHeight || clipping() ? "clip" : "visible",
            }
      }
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget || event.propertyName !== "height") return;
        setClipping(false);
      }}
    >
      <div ref={setContent} style={props.holdHeight ? { height: "100%" } : undefined}>
        {props.children}
      </div>
    </div>
  );
}

export function WizardPanel(props: {
  holdHeight?: boolean;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <div
      data-slot="dialog-panel"
      class={`min-w-0 space-y-4 bg-background/80 px-6 py-5 ring-1 ring-black/5 dark:bg-white/2 dark:ring-white/5 ${props.class ?? ""}`}
    >
      <AnimatedHeight holdHeight={props.holdHeight === true}>{props.children}</AnimatedHeight>
    </div>
  );
}
