// @effect-diagnostics globalTimers:off globalDate:off -- View-only toast timing, outside any Effect runtime.
import { type JSX, Portal } from "@solidjs/web";
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onSettled,
  Show,
} from "solid-js";

import { copyText } from "../clipboard";
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  Copy,
  Info,
  TriangleAlert,
  X,
} from "../icons";
import { Button, type ButtonVariant } from "./Button";
import { cleanupRef } from "./cleanupRef";
import { follow } from "./floating";
import { Spinner } from "./Spinner";
import {
  anchoredToastManager,
  buildVisibleToastLayout,
  hasVisibleToastAction,
  type IToast,
  type IToastButtonProps,
  shouldHideCollapsedToastContent,
  shouldRenderThreadScopedToast,
  type ToastStore,
  toastManager,
} from "./toastStore";

export type IActiveThreadRef = { environmentId: string; threadId: string } | null;

type ISwipeDirection = "up" | "down" | "left" | "right";

const SWIPE_THRESHOLD = 40;
const REVERSE_CANCEL_THRESHOLD = 10;
const OPPOSITE_DIRECTION_DAMPING_FACTOR = 0.5;
const SWIPE_IGNORE_SELECTOR = 'button,a,input,textarea,[role="button"],[data-swipe-ignore]';
const COPIED_MS = 1_200;
const ERROR_DESCRIPTION_CLAMP_MIN_CHARS = 180;

const ICON_CLASS =
  "in-data-[type=error]:text-destructive in-data-[type=info]:text-info in-data-[type=success]:text-success in-data-[type=warning]:text-warning in-data-[type=loading]:opacity-80";

const CORNER_DISMISS = "absolute z-20 -top-1.5 -right-1.5";
const CORNER_ORB =
  "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border/60 bg-popover/92 text-muted-foreground shadow-sm outline-none backdrop-blur-sm transition-[color,background-color,box-shadow] hover:bg-popover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";
const EXPANDABLE_PANEL =
  "mt-2 max-h-40 min-h-0 overflow-y-auto overscroll-contain pr-0.5 select-text";
const STACKED_CONTENT = "flex flex-col gap-2 py-2.5 pr-3.5";
const INLINE_CONTENT = "flex items-center justify-between gap-1.5 py-3";

const VIEWPORT =
  "fixed z-100 mx-auto flex w-[calc(100%-var(--toast-inset)*2)] max-w-90 [--toast-header-offset:var(--workspace-topbar-height)] [--toast-inset:--spacing(4)] sm:[--toast-inset:--spacing(8)] data-[position*=top]:top-[calc(var(--toast-inset)+var(--toast-header-offset))] data-[position*=bottom]:bottom-(--toast-inset) data-[position*=left]:left-(--toast-inset) data-[position*=right]:right-(--toast-inset) data-[position*=center]:-translate-x-1/2 data-[position*=center]:left-1/2";

const ROOT =
  "dropdown-glass absolute z-[calc(9999-var(--toast-index))] w-full overflow-visible select-none rounded-lg text-popover-foreground shadow-xl shadow-black/25 [transition:transform_.5s_cubic-bezier(.22,1,.36,1),opacity_.5s,height_.15s] data-[position*=right]:right-0 data-[position*=right]:left-auto data-[position*=left]:right-auto data-[position*=left]:left-0 data-[position*=center]:right-0 data-[position*=center]:left-0 data-[position*=top]:top-0 data-[position*=top]:bottom-auto data-[position*=top]:origin-top data-[position*=bottom]:top-auto data-[position*=bottom]:bottom-0 data-[position*=bottom]:origin-bottom after:absolute after:left-0 after:h-[calc(var(--toast-gap)+1px)] after:w-full data-[position*=top]:after:top-full data-[position*=bottom]:after:bottom-full [--toast-gap:--spacing(3)] [--toast-peek:--spacing(3)] [--toast-scale:calc(max(0,1-(var(--toast-index)*.1)))] [--toast-shrink:calc(1-var(--toast-scale))] data-[position*=top]:[--toast-calc-offset-y:calc(var(--toast-offset-y)+var(--toast-index)*var(--toast-gap)+var(--toast-swipe-movement-y))] data-[position*=bottom]:[--toast-calc-offset-y:calc(var(--toast-offset-y)*-1+var(--toast-index)*var(--toast-gap)*-1+var(--toast-swipe-movement-y))] data-[position*=top]:transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+(var(--toast-index)*var(--toast-peek))+(var(--toast-shrink)*var(--toast-calc-height))))_scale(var(--toast-scale))] data-[position*=bottom]:transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--toast-peek))-(var(--toast-shrink)*var(--toast-calc-height))))_scale(var(--toast-scale))] data-limited:opacity-0 data-position:data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(var(--toast-calc-offset-y))] data-[position*=top]:data-starting-style:transform-[translateY(calc(-100%-var(--toast-inset)))] data-[position*=bottom]:data-starting-style:transform-[translateY(calc(100%+var(--toast-inset)))] data-[position*=top]:data-[position*=right]:data-starting-style:transform-[translateX(calc(100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))] data-ending-style:opacity-0 data-ending-style:not-data-limited:not-data-swipe-direction:transform-[translateY(calc(100%+var(--toast-inset)))] data-[position*=top]:data-[position*=right]:data-ending-style:not-data-limited:not-data-swipe-direction:transform-[translateX(calc(100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))] data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-100%-var(--toast-inset)))_translateY(var(--toast-calc-offset-y))] data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))] data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-100%-var(--toast-inset)))] data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+100%+var(--toast-inset)))] data-expanded:data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-100%-var(--toast-inset)))_translateY(var(--toast-calc-offset-y))] data-expanded:data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))] data-expanded:data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-100%-var(--toast-inset)))] data-expanded:data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+100%+var(--toast-inset)))]";
// Base UI measures with height:auto; --toast-height as min-height would prevent shrinking.
const ROOT_FRONT =
  "[--toast-calc-height:max(var(--toast-frontmost-height,var(--toast-height)),var(--toast-height))] h-auto";
const ROOT_BEHIND =
  "not-data-expanded:[--toast-calc-height:var(--toast-frontmost-height)] data-expanded:[--toast-calc-height:max(var(--toast-frontmost-height,var(--toast-height)),var(--toast-height))] not-data-expanded:h-(--toast-calc-height) data-expanded:h-auto";

// overflow-x:clip keeps vertical overflow visible, where hidden would force overflow-y:auto and
// clip detail panels.
const CONTENT =
  "pointer-events-auto min-h-0 overflow-y-visible pl-3.5 text-sm transition-opacity duration-250 [overflow-x:clip] data-expanded:opacity-100";
const CONTENT_HIDDEN_BEHIND = "not-data-expanded:pointer-events-none not-data-expanded:opacity-0";

const ANCHORED_ROOT =
  "dropdown-glass relative overflow-visible text-balance text-popover-foreground text-xs shadow-xl shadow-black/25 transition-[scale,opacity] data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0";
const ANCHORED_CONTENT =
  "pointer-events-auto min-h-0 overflow-y-visible pl-3.5 text-sm [overflow-x:clip]";

/** Subscribes a view to a toast queue, as Base UI's `useToastManager` does. */
function useToasts(store: ToastStore): Accessor<IToast[]> {
  const [toasts, setToasts] = createSignal(store.toasts, { equals: false });
  onCleanup(store.subscribe(() => setToasts(store.toasts)));
  return toasts;
}

/** Waits for an element's finite transitions to end, as Base UI's `useOpenChangeComplete` does. */
async function animationsFinished(element: HTMLElement): Promise<void> {
  for (;;) {
    const running = element
      .getAnimations({ subtree: true })
      .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
    if (running.length === 0) return;
    await Promise.allSettled(running.map((animation) => animation.finished));
  }
}

function elementTransform(element: HTMLElement): { x: number; y: number; scale: number } {
  const transform = getComputedStyle(element).transform;
  const matrix = transform.match(/matrix(?:3d)?\(([^)]+)\)/);
  if (!matrix?.[1]) return { x: 0, y: 0, scale: 1 };
  const values = matrix[1].split(", ").map(Number.parseFloat);
  if (values.length === 6)
    return { x: values[4]!, y: values[5]!, scale: Math.hypot(values[0]!, values[1]!) };
  return { x: values[12]!, y: values[13]!, scale: values[0]! };
}

function displacement(direction: ISwipeDirection, x: number, y: number): number {
  return direction === "up" ? -y : direction === "down" ? y : direction === "left" ? -x : x;
}

function isFocusVisible(element: Element | null): boolean {
  try {
    return element?.matches(":focus-visible") ?? false;
  } catch {
    return false;
  }
}

/**
 * Base UI's `ToastRoot` behaviour on an element: its height, its entrance and exit attributes,
 * Escape, and swipe to dismiss. Returns the drag styles the root carries.
 */
function createToastRoot(
  store: ToastStore,
  toast: Accessor<IToast>,
  root: Accessor<HTMLElement | undefined>,
  directions: readonly ISwipeDirection[],
) {
  const [swipeDirection, setSwipeDirection] = createSignal<ISwipeDirection>();
  const [swiping, setSwiping] = createSignal(false);
  const [drag, setDrag] = createSignal({ x: 0, y: 0 });
  const [initial, setInitial] = createSignal({ x: 0, y: 0, scale: 1 });
  let pointerId: number | null = null;
  let start = { x: 0, y: 0 };
  let baseline = { x: 0, y: 0 };
  let firstMove = false;
  let realSwipe = false;
  let locked: "horizontal" | "vertical" | null = null;
  let intended: ISwipeDirection | undefined;
  let maxDisplacement = 0;
  let cancelled = false;
  let abort: AbortController | null = null;

  const measure = () => {
    const element = root();
    if (!element) return;
    const previous = element.style.height;
    element.style.height = "auto";
    const height = element.offsetHeight;
    element.style.height = previous;
    const current = toast();
    if (current.height === height && current.transitionStatus !== "starting") return;
    store.updateInternal(current.id, { height, transitionStatus: undefined });
  };

  onSettled(() => {
    // Reading the height lays the toast out with `data-starting-style` on, so clearing it then
    // transitions from there.
    measure();
    const element = root();
    if (!element) return;
    const content = element.querySelector("[data-toast-content]") ?? element;
    const resize = new ResizeObserver(measure);
    const mutation = new MutationObserver(measure);
    resize.observe(content);
    mutation.observe(content, { childList: true, subtree: true, characterData: true });
    const preventTouchMove = (event: TouchEvent) => {
      if (pointerId !== null) event.preventDefault();
    };
    element.addEventListener("touchmove", preventTouchMove, { passive: false });
    return () => {
      resize.disconnect();
      mutation.disconnect();
      element.removeEventListener("touchmove", preventTouchMove);
      abort?.abort();
    };
  });

  let removing = false;
  createEffect(
    () => {
      const element = root();
      if (removing || !element || toast().transitionStatus !== "ending") return undefined;
      return { element, id: toast().id };
    },
    (ending) => {
      if (ending === undefined || removing) return;
      removing = true;
      requestAnimationFrame(
        () => void animationsFinished(ending.element).then(() => store.remove(ending.id)),
      );
    },
  );

  const damp = (delta: number) =>
    delta > 0
      ? delta ** OPPOSITE_DIRECTION_DAMPING_FACTOR
      : -(Math.abs(delta) ** OPPOSITE_DIRECTION_DAMPING_FACTOR);

  const end = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    abort?.abort();
    abort = null;
    setSwiping(false);
    realSwipe = false;
    locked = null;
    const from = initial();
    if (event.type === "pointercancel" || cancelled) {
      setDrag({ x: from.x, y: from.y });
      setSwipeDirection(undefined);
      return;
    }
    const deltaX = drag().x - from.x;
    const deltaY = drag().y - from.y;
    const dismiss = directions.find(
      (direction) => displacement(direction, deltaX, deltaY) > SWIPE_THRESHOLD,
    );
    if (dismiss) {
      setSwipeDirection(dismiss);
      store.close(toast().id);
    } else {
      setDrag({ x: from.x, y: from.y });
      setSwipeDirection(undefined);
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || directions.length === 0) return;
    if (event.pointerType === "touch") store.pauseTimers();
    if (event.target instanceof Element && event.target.closest(SWIPE_IGNORE_SELECTOR)) return;
    const element = event.currentTarget as HTMLElement;
    cancelled = false;
    intended = undefined;
    maxDisplacement = 0;
    pointerId = event.pointerId;
    start = { x: event.clientX, y: event.clientY };
    baseline = start;
    const transform = elementTransform(element);
    setInitial(transform);
    setDrag({ x: transform.x, y: transform.y });
    store.setInteraction({ hovering: true });
    setSwiping(true);
    realSwipe = false;
    locked = null;
    firstMove = true;
    abort?.abort();
    abort = new AbortController();
    document.addEventListener("pointerup", end, { signal: abort.signal });
    document.addEventListener("pointercancel", end, { signal: abort.signal });
    element.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    event.preventDefault();
    if (firstMove) {
      start = { x: event.clientX, y: event.clientY };
      firstMove = false;
    }
    const { clientX, clientY, movementX, movementY } = event;
    if ((movementY < 0 && clientY > baseline.y) || (movementY > 0 && clientY < baseline.y))
      baseline = { x: baseline.x, y: clientY };
    if ((movementX < 0 && clientX > baseline.x) || (movementX > 0 && clientX < baseline.x))
      baseline = { x: clientX, y: baseline.y };
    const deltaX = clientX - start.x;
    const deltaY = clientY - start.y;
    const horizontal = directions.includes("left") || directions.includes("right");
    const vertical = directions.includes("up") || directions.includes("down");
    if (!realSwipe && Math.hypot(deltaX, deltaY) >= 1) {
      realSwipe = true;
      if (horizontal && vertical)
        locked = Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
    }
    if (!intended) {
      let candidate: ISwipeDirection | undefined;
      if (locked === "vertical") candidate = deltaY > 0 ? "down" : deltaY < 0 ? "up" : undefined;
      else if (locked === "horizontal")
        candidate = deltaX > 0 ? "right" : deltaX < 0 ? "left" : undefined;
      else if (Math.abs(deltaX) >= Math.abs(deltaY)) candidate = deltaX > 0 ? "right" : "left";
      else candidate = deltaY > 0 ? "down" : "up";
      if (candidate && directions.includes(candidate)) {
        intended = candidate;
        maxDisplacement = displacement(candidate, deltaX, deltaY);
        setSwipeDirection(candidate);
      }
    } else {
      const current = displacement(intended, clientX - baseline.x, clientY - baseline.y);
      if (current > SWIPE_THRESHOLD) {
        cancelled = false;
        setSwipeDirection(intended);
      } else if (
        !(directions.includes("left") && directions.includes("right")) &&
        !(directions.includes("up") && directions.includes("down")) &&
        maxDisplacement - current >= REVERSE_CANCEL_THRESHOLD
      ) {
        cancelled = true;
      }
    }
    const dampX =
      (deltaX > 0 && !directions.includes("right")) || (deltaX < 0 && !directions.includes("left"));
    const dampY =
      (deltaY > 0 && !directions.includes("down")) || (deltaY < 0 && !directions.includes("up"));
    const from = initial();
    setDrag({
      x: from.x + (locked !== "vertical" && horizontal ? (dampX ? damp(deltaX) : deltaX) : 0),
      y: from.y + (locked !== "horizontal" && vertical ? (dampY ? damp(deltaY) : deltaY) : 0),
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const element = root();
    if (event.key === "Escape" && element?.contains(document.activeElement))
      store.close(toast().id);
  };

  const dragStyle = (): JSX.CSSProperties => {
    const from = initial();
    const offset = drag();
    return {
      ...(swiping() && {
        transition: "none",
        transform: `translateX(${offset.x}px) translateY(${offset.y}px) scale(${from.scale})`,
      }),
      "--toast-swipe-movement-x": `${offset.x - from.x}px`,
      "--toast-swipe-movement-y": `${offset.y - from.y}px`,
    };
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
    onKeyDown,
    dragStyle,
    swipeDirection,
    swiping,
  };
}

function ToastButton(props: { action: IToastButtonProps; variant: ButtonVariant; slot?: string }) {
  return (
    <Button
      size="xs"
      variant={props.variant}
      class={props.action.class ? `shrink-0 ${props.action.class}` : "shrink-0"}
      disabled={props.action.disabled}
      aria-label={props.action["aria-label"]}
      data-slot={props.slot}
      onClick={(event) => props.action.onClick?.(event)}
    >
      {props.action.children}
    </Button>
  );
}

function CopyErrorButton(props: { text: string }) {
  const [copied, setCopied] = createSignal(false);
  const label = () => (copied() ? "Copied error" : "Copy error");
  const copy = async () => {
    if (!(await copyText(props.text))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  };
  return (
    <Button
      size="icon-micro"
      variant="ghost-muted"
      aria-label={label()}
      data-tip={label()}
      data-tip-side="top"
      class="rounded-md [--control-icon-color:currentColor] hover:bg-transparent"
      onClick={() => void copy()}
    >
      <Show when={copied()} fallback={<Copy class="size-3" />}>
        <Check class="size-3 text-success" />
      </Show>
    </Button>
  );
}

function descriptionClamp(toast: IToast): string {
  return toast.type === "error" &&
    typeof toast.description === "string" &&
    toast.description.length >= ERROR_DESCRIPTION_CLAMP_MIN_CHARS
    ? " line-clamp-4"
    : "";
}

function OpenChevron(props: { open: boolean; class: string }) {
  return (
    <Show
      when={props.open}
      fallback={<ChevronDown aria-hidden="true" class={props.class} stroke-width={2.25} />}
    >
      <ChevronUp aria-hidden="true" class={props.class} stroke-width={2.25} />
    </Show>
  );
}

function ToastDescription(props: { toast: IToast }) {
  const [open, setOpen] = createSignal(false);
  const data = () => props.toast.data;
  const expandLabel = () => data()?.expandableLabels?.expand ?? "Show details";
  const collapseLabel = () => data()?.expandableLabels?.collapse ?? "Hide details";
  const label = () => (open() ? collapseLabel() : expandLabel());
  const plain = () => (
    <Show when={props.toast.description}>
      <p
        class={`min-w-0 select-text wrap-break-word text-muted-foreground${descriptionClamp(props.toast)}`}
        data-slot="toast-description"
      >
        {props.toast.description}
      </p>
    </Show>
  );
  return (
    <Show when={data()?.expandableContent} fallback={plain()}>
      <Show
        when={data()?.expandableDescriptionTrigger}
        fallback={
          <>
            {plain()}
            <div class="min-w-0">
              <button
                type="button"
                aria-expanded={open() ? "true" : "false"}
                class="inline-flex cursor-pointer items-center gap-1 rounded-md py-0.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setOpen((value) => !value)}
              >
                <OpenChevron open={open()} class="size-3.5 shrink-0 opacity-80" />
                {label()}
              </button>
              <Show when={open()}>
                <div class={EXPANDABLE_PANEL}>{data()?.expandableContent}</div>
              </Show>
            </div>
          </>
        }
      >
        <div
          role="button"
          tabindex={0}
          aria-label={label()}
          aria-expanded={open() ? "true" : "false"}
          data-tip={label()}
          data-tip-side="top"
          class="group flex w-full min-w-0 cursor-pointer items-start gap-1.5 rounded-sm text-left ring-offset-background outline-none select-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:ring-inset"
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            setOpen((value) => !value);
          }}
        >
          <div class="min-w-0 flex-1">
            <p
              class={`min-w-0 select-none wrap-break-word text-muted-foreground decoration-muted-foreground/60 underline-offset-2 group-hover:underline${descriptionClamp(props.toast)}`}
              data-slot="toast-description"
            >
              {props.toast.description}
            </p>
          </div>
          <OpenChevron
            open={open()}
            class="size-3.5 h-lh shrink-0 text-muted-foreground opacity-80"
          />
        </div>
        <Show when={open()}>
          <div class={EXPANDABLE_PANEL}>{data()?.expandableContent}</div>
        </Show>
      </Show>
    </Show>
  );
}

function ToastIcon(props: { type: IToast["type"] }) {
  return (
    <Show when={props.type}>
      <div
        class="[&_svg]:pointer-events-none [&_svg]:shrink-0 [&>svg]:h-lh [&>svg]:w-4"
        data-slot="toast-icon"
      >
        {props.type === "error" ? (
          <CircleAlert class={ICON_CLASS} />
        ) : props.type === "info" ? (
          <Info class={ICON_CLASS} />
        ) : props.type === "loading" ? (
          <Spinner class={ICON_CLASS} />
        ) : props.type === "success" ? (
          <CircleCheck class={ICON_CLASS} />
        ) : (
          <TriangleAlert class={ICON_CLASS} />
        )}
      </div>
    </Show>
  );
}

function bodyLayout(toast: IToast) {
  const stacked =
    hasVisibleToastAction(toast.actionProps) && toast.data?.actionLayout === "stacked-end";
  const copyErrorText =
    toast.type === "error" && typeof toast.description === "string" && !toast.data?.hideCopyButton
      ? toast.description
      : null;
  const trailing =
    copyErrorText !== null ||
    hasVisibleToastAction(toast.actionProps) ||
    (toast.data?.additionalActions?.length ?? 0) > 0 ||
    toast.data?.secondaryActionProps !== undefined;
  return { stacked, copyErrorText, trailing };
}

function contentClass(toast: IToast): string {
  const layout = bodyLayout(toast);
  if (layout.stacked) return STACKED_CONTENT;
  return `${INLINE_CONTENT} ${layout.trailing ? "pr-6" : "pr-3.5"}`;
}

function ToastBody(props: { toast: IToast }) {
  const layout = createMemo(() => bodyLayout(props.toast));
  const secondaryVariant = () => props.toast.data?.secondaryActionVariant ?? "outline";
  return (
    <>
      <div class={`flex min-h-0 min-w-0 flex-col gap-0.5 ${layout().stacked ? "pr-5" : "flex-1"}`}>
        <div class={`flex min-w-0 gap-2${!layout().stacked && !layout().trailing ? " pr-6" : ""}`}>
          <Show
            when={props.toast.data?.leadingIcon}
            fallback={<ToastIcon type={props.toast.type} />}
          >
            <div class="flex h-lh w-4 shrink-0 items-center justify-center" data-slot="toast-icon">
              {props.toast.data?.leadingIcon}
            </div>
          </Show>
          <h2 class="min-w-0 wrap-break-word font-medium" data-slot="toast-title">
            {props.toast.title}
          </h2>
        </div>
        <ToastDescription toast={props.toast} />
      </div>
      <Show when={layout().trailing}>
        <div
          class={`flex items-center gap-1.5 ${layout().stacked ? "w-full justify-end" : "shrink-0"}`}
        >
          <Show when={layout().copyErrorText}>{(text) => <CopyErrorButton text={text()} />}</Show>
          <For each={props.toast.data?.additionalActions ?? []}>
            {(action) => <ToastButton action={action.props} variant={secondaryVariant()} />}
          </For>
          <Show when={props.toast.data?.secondaryActionProps}>
            {(action) => <ToastButton action={action()} variant={secondaryVariant()} />}
          </Show>
          <Show when={hasVisibleToastAction(props.toast.actionProps) && props.toast.actionProps}>
            {(action) => (
              <ToastButton
                action={action()}
                variant={props.toast.data?.actionVariant ?? "default"}
                slot="toast-action"
              />
            )}
          </Show>
        </div>
      </Show>
    </>
  );
}

function DismissOrb(props: { store: ToastStore; toast: IToast }) {
  return (
    <div class={CORNER_DISMISS}>
      <button
        type="button"
        aria-label="Dismiss notification"
        class={CORNER_ORB}
        data-slot="toast-close"
        onClick={() => {
          props.toast.data?.onClose?.();
          props.store.close(props.toast.id);
        }}
      >
        <X class="size-3" stroke-width={2.25} />
      </button>
    </div>
  );
}

const visibleRemainingMs = new Map<string, number>();

/** Stock's `dismissAfterVisibleMs`: a dismiss timer that only counts time the window is in view and focused. */
function VisibleAutoDismiss(props: { id: string; ms: number }) {
  onSettled(() => {
    let remaining = visibleRemainingMs.get(props.id) ?? props.ms;
    let startedAt: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      visibleRemainingMs.delete(props.id);
      toastManager.close(props.id);
    };
    const pause = () => {
      if (startedAt === null) return;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
      startedAt = null;
      clearTimeout(timer);
      visibleRemainingMs.set(props.id, remaining);
    };
    const resume = () => {
      if (closed || startedAt !== null) return;
      if (remaining <= 0) {
        close();
        return;
      }
      startedAt = Date.now();
      clearTimeout(timer);
      timer = setTimeout(() => {
        remaining = 0;
        startedAt = null;
        close();
      }, remaining);
    };
    const sync = () =>
      document.visibilityState === "visible" && document.hasFocus() ? resume() : pause();
    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      pause();
      clearTimeout(timer);
    };
  });
  return null;
}

type IToastPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

/**
 * Base UI's `ToastViewport` behaviour: hover and keyboard focus expand the stack and pause the
 * timers, a blurred window pauses them, F6 jumps to the toasts and Shift+Tab back out.
 */
function createViewport(store: ToastStore) {
  let viewport: HTMLElement | undefined;
  let readyForMouseLeave = false;
  let touchActive = false;
  const inside = (node: EventTarget | null) => node instanceof Node && !!viewport?.contains(node);

  const flushMouseLeave = () => {
    const ending = store.toasts.some((toast) => toast.transitionStatus === "ending");
    if (ending || touchActive || !readyForMouseLeave) return;
    // Cleared first: the release notifies this same listener.
    readyForMouseLeave = false;
    store.release({ hovering: false });
  };
  onCleanup(store.subscribe(flushMouseLeave));

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "F6" || event.target === viewport || store.toasts.length === 0) return;
    event.preventDefault();
    store.prevFocusElement = document.activeElement;
    viewport?.focus({ preventScroll: true });
    store.pauseTimers();
    store.setInteraction({ focused: true });
  };
  const onWindowBlur = (event: FocusEvent) => {
    if (event.target !== window) return;
    store.setInteraction({ windowFocused: false });
    store.pauseTimers();
  };
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  const onWindowFocus = (event: FocusEvent) => {
    if (event.relatedTarget) return;
    if (event.target === window || !inside(event.target) || !isFocusVisible(document.activeElement))
      store.resumeTimers();
    clearTimeout(focusTimer);
    // Focus moving between elements also fires focus, so the window counts as refocused only
    // once that settles.
    focusTimer = setTimeout(() => store.setInteraction({ windowFocused: true }), 0);
  };
  const onDocumentPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch" || inside(event.target)) return;
    store.resumeTimers();
    store.setInteraction({ hovering: false, focused: false });
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("blur", onWindowBlur, true);
  window.addEventListener("focus", onWindowFocus, true);
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  onCleanup(() => {
    clearTimeout(focusTimer);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("blur", onWindowBlur, true);
    window.removeEventListener("focus", onWindowFocus, true);
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  });

  const onMouseEnter = () => {
    store.pauseTimers();
    if (!store.hovering) store.setInteraction({ hovering: true });
    readyForMouseLeave = false;
  };
  const onFocus = () => {
    if (store.focused || !isFocusVisible(document.activeElement)) return;
    store.setInteraction({ focused: true });
    store.pauseTimers();
  };
  const touchEnd = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return;
    touchActive = false;
    flushMouseLeave();
  };

  return {
    attach: (element: HTMLElement) => {
      viewport = element;
    },
    handlers: {
      onMouseEnter,
      onMouseMove: onMouseEnter,
      onMouseLeave: () => {
        readyForMouseLeave = true;
        flushMouseLeave();
      },
      onFocusIn: onFocus,
      onFocusOut: (event: FocusEvent) => {
        if (!store.focused || inside(event.relatedTarget)) return;
        store.release({ focused: false });
      },
      onClick: onFocus,
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key !== "Tab" || !event.shiftKey || event.target !== viewport) return;
        event.preventDefault();
        if (store.prevFocusElement instanceof HTMLElement)
          store.prevFocusElement.focus({ preventScroll: true });
      },
      onPointerDown: (event: PointerEvent) => {
        if (event.pointerType === "touch") touchActive = true;
      },
      onPointerUp: touchEnd,
      onPointerCancel: touchEnd,
    },
  };
}

/** Stock's `ToastProvider` viewport: the stack of toasts, top right under the header. */
export function Toasts(props: { activeThread: IActiveThreadRef; position?: IToastPosition }) {
  const store = toastManager;
  const toasts = useToasts(store);
  const position = () => props.position ?? "top-right";
  const isTop = () => position().startsWith("top");
  const layout = createMemo(() =>
    buildVisibleToastLayout(
      toasts().filter((toast) => shouldRenderThreadScopedToast(toast.data, props.activeThread)),
    ),
  );
  const ids = createMemo(() => layout().items.map((item) => item.toast.id), {
    equals: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]),
  });
  const item = (id: string) => layout().items.find((entry) => entry.toast.id === id);
  const expanded = () => (toasts(), store.expanded);
  const swipeDirections = (): ISwipeDirection[] =>
    position().includes("center")
      ? [isTop() ? "up" : "down"]
      : position().includes("left")
        ? ["left", isTop() ? "up" : "down"]
        : ["right", isTop() ? "up" : "down"];

  const { attach, handlers } = createViewport(store);

  return (
    <Portal>
      <div
        ref={attach}
        tabindex={-1}
        role="region"
        aria-live="polite"
        aria-atomic="false"
        aria-relevant="additions text"
        aria-label="Notifications"
        class={VIEWPORT}
        data-position={position()}
        data-slot="toast-viewport"
        data-expanded={expanded() ? "" : undefined}
        style={{ "--toast-frontmost-height": `${layout().frontmostHeight}px` }}
        {...handlers}
      >
        <For each={ids()}>
          {(id) => {
            const entry = createMemo(() => item(id));
            return (
              <Show when={entry()}>
                {(current) => (
                  <StackedToast
                    store={store}
                    toast={() => current().toast}
                    visibleIndex={() => current().visibleIndex}
                    offsetY={() => current().offsetY}
                    count={() => layout().items.length}
                    expanded={expanded}
                    position={position()}
                    swipeDirections={swipeDirections()}
                  />
                )}
              </Show>
            );
          }}
        </For>
      </div>
    </Portal>
  );
}

function StackedToast(props: {
  store: ToastStore;
  toast: Accessor<IToast>;
  visibleIndex: Accessor<number>;
  offsetY: Accessor<number>;
  count: Accessor<number>;
  expanded: Accessor<boolean>;
  position: IToastPosition;
  swipeDirections: ISwipeDirection[];
}) {
  const [element, setElement] = createSignal<HTMLElement>();
  const root = createToastRoot(props.store, props.toast, element, props.swipeDirections);
  const toast = props.toast;
  const index = () => props.visibleIndex();
  const hideBehind = () => shouldHideCollapsedToastContent(index(), props.count());
  const ending = () => toast().transitionStatus === "ending";
  const highPriority = () => toast().priority === "high";
  return (
    <div
      ref={(node) => {
        setElement(node);
      }}
      role={highPriority() ? "alertdialog" : "dialog"}
      tabindex={0}
      aria-modal="false"
      aria-hidden={highPriority() && !props.store.focused ? "true" : undefined}
      inert={toast().limited}
      class={`${ROOT} ${index() > 0 ? ROOT_BEHIND : ROOT_FRONT}`}
      data-position={props.position}
      data-type={toast().type}
      data-expanded={props.expanded() ? "" : undefined}
      data-limited={toast().limited ? "" : undefined}
      data-starting-style={toast().transitionStatus === "starting" ? "" : undefined}
      data-ending-style={ending() ? "" : undefined}
      data-swiping={root.swiping() ? "" : undefined}
      data-swipe-direction={root.swipeDirection()}
      style={{
        ...root.dragStyle(),
        "--toast-index": String(index()),
        "--toast-offset-y": `${props.offsetY()}px`,
        ...(toast().height ? { "--toast-height": `${toast().height}px` } : {}),
      }}
      onPointerDown={root.onPointerDown}
      onPointerMove={root.onPointerMove}
      onPointerUp={root.onPointerUp}
      onPointerCancel={root.onPointerCancel}
      onKeyDown={root.onKeyDown}
    >
      <Show when={toast().data?.dismissAfterVisibleMs}>
        {(ms) => <VisibleAutoDismiss id={toast().id} ms={ms()} />}
      </Show>
      <DismissOrb store={props.store} toast={toast()} />
      <div
        class={`${CONTENT} ${contentClass(toast())}${hideBehind() ? ` ${CONTENT_HIDDEN_BEHIND}` : ""}`}
        data-toast-content
        data-expanded={props.expanded() ? "" : undefined}
        data-behind={index() > 0 ? "" : undefined}
      >
        <ToastBody toast={toast()} />
      </div>
    </div>
  );
}

/** Stock's `AnchoredToastProvider` toasts: one beside its anchor, such as a copy button's failure. */
export function AnchoredToasts(props: { activeThread: IActiveThreadRef }) {
  const store = anchoredToastManager;
  const toasts = useToasts(store);
  const ids = createMemo(
    () =>
      toasts()
        .filter(
          (toast) =>
            toast.positionerProps?.anchor !== undefined &&
            shouldRenderThreadScopedToast(toast.data, props.activeThread),
        )
        .map((toast) => toast.id),
    { equals: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]) },
  );
  return (
    <Portal>
      <div class="outline-none" data-slot="toast-viewport-anchored">
        <For each={ids()}>
          {(id) => {
            const toast = createMemo(() => toasts().find((entry) => entry.id === id));
            return (
              <Show when={toast()}>
                {(current) => <AnchoredToast store={store} toast={current} />}
              </Show>
            );
          }}
        </For>
      </div>
    </Portal>
  );
}

function AnchoredToast(props: { store: ToastStore; toast: Accessor<IToast> }) {
  const [element, setElement] = createSignal<HTMLElement>();
  const root = createToastRoot(props.store, props.toast, element, []);
  const toast = props.toast;
  const placeAt = cleanupRef((positioner: HTMLElement) => {
    const anchor = toast().positionerProps?.anchor;
    if (!anchor) return undefined;
    return follow(
      positioner,
      anchor,
      () => ({
        side: "top",
        align: "center",
        sideOffset: toast().positionerProps?.sideOffset ?? 4,
      }),
      () => props.store.close(toast().id),
    );
  });
  const ending = () => toast().transitionStatus === "ending";
  const tooltipStyle = () => toast().data?.tooltipStyle ?? false;
  return (
    <div
      ref={placeAt}
      class="fixed top-0 left-0 z-100 max-w-[min(--spacing(64),var(--available-width))]"
      data-slot="toast-positioner"
    >
      <div
        ref={(node) => {
          setElement(node);
        }}
        role="dialog"
        tabindex={0}
        aria-modal="false"
        class={`${ANCHORED_ROOT} ${tooltipStyle() ? "rounded-md" : "rounded-lg"}`}
        data-slot="toast-popup"
        data-type={toast().type}
        data-starting-style={toast().transitionStatus === "starting" ? "" : undefined}
        data-ending-style={ending() ? "" : undefined}
        onKeyDown={root.onKeyDown}
      >
        <Show
          when={!tooltipStyle()}
          fallback={
            <div class="pointer-events-auto px-2 py-1" data-toast-content>
              <h2 data-slot="toast-title">{toast().title}</h2>
            </div>
          }
        >
          <DismissOrb store={props.store} toast={toast()} />
          <div class={`${ANCHORED_CONTENT} ${contentClass(toast())}`} data-toast-content>
            <ToastBody toast={toast()} />
          </div>
        </Show>
      </div>
    </div>
  );
}

export const ANCHORED_COPY_TOAST_TIMEOUT_MS = 1_000;

/** Stock's `showAnchoredCopyErrorToast`. */
export function showAnchoredCopyErrorToast(anchor: Element | undefined, message: string): void {
  if (!anchor) return;
  anchoredToastManager.add({
    type: "error",
    positionerProps: { anchor },
    title: "Failed to copy",
    description: message,
  });
}
