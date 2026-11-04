// @effect-diagnostics globalTimers:off -- A view-only hover delay, outside any Effect runtime.
import {
  type Component,
  createComponent,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";

const COLLISION_PADDING = 5;
const SIDE_OFFSET = 4;
const OPEN_DELAY_MS = 600;
const WARM_MS = 400;

const cards = new WeakMap<Element, () => JSX.Element>();

export const hoverCard =
  <P extends object>(card: Component<P>, props: P) =>
  (element: HTMLElement) => {
    cards.set(element, () => createComponent(card, props));
  };

interface IOpenTip {
  Trigger: HTMLElement;
  Instant: boolean;
}

const clamp = (value: number, size: number, viewport: number): number =>
  Math.max(COLLISION_PADDING, Math.min(value, viewport - size - COLLISION_PADDING));

function place(popup: HTMLElement, trigger: HTMLElement): void {
  const anchor = trigger.getBoundingClientRect();
  // offset sizes, because the entry transition's scale would shrink a bounding rect.
  const width = popup.offsetWidth;
  const height = popup.offsetHeight;
  let left: number;
  let top: number;
  if (trigger.dataset.tipSide === "right") {
    left = anchor.right + SIDE_OFFSET;
    if (left + width > window.innerWidth - COLLISION_PADDING) {
      left = anchor.left - width - SIDE_OFFSET;
    }
    top = anchor.top;
  } else {
    left = anchor.left + (anchor.width - width) / 2;
    top = anchor.top - height - SIDE_OFFSET;
    if (top < COLLISION_PADDING) top = anchor.bottom + SIDE_OFFSET;
  }
  popup.style.left = `${clamp(left, width, window.innerWidth)}px`;
  popup.style.top = `${clamp(top, height, window.innerHeight)}px`;
}

function TipPopup(props: { tip: IOpenTip }) {
  const card = cards.get(props.tip.Trigger);
  return (
    <div
      ref={(popup) => queueMicrotask(() => place(popup, props.tip.Trigger))}
      class="tooltip"
      classList={{ card: card !== undefined }}
      role="tooltip"
      data-instant={props.tip.Instant ? "" : undefined}
    >
      {card === undefined ? props.tip.Trigger.dataset.tip : card()}
    </div>
  );
}

export function TooltipHost() {
  const [open, setOpen] = createSignal<IOpenTip | null>(null);
  let trigger: HTMLElement | null = null;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let cooling: ReturnType<typeof setTimeout> | undefined;
  let warm = false;

  const show = (next: HTMLElement, instant: boolean) => {
    if (next.isConnected && (next.dataset.tip || cards.has(next))) {
      setOpen({ Trigger: next, Instant: instant });
    }
  };
  const hide = () => {
    clearTimeout(pending);
    if (open() === null) return;
    setOpen(null);
    warm = true;
    clearTimeout(cooling);
    cooling = setTimeout(() => {
      warm = false;
    }, WARM_MS);
  };

  const onPointerOver = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    const next = (event.target as Element).closest<HTMLElement>("[data-tip]");
    if (next === trigger) return;
    trigger = next;
    hide();
    if (next === null) return;
    if (warm) show(next, true);
    else {
      pending = setTimeout(() => show(next, false), Number(next.dataset.tipDelay ?? OPEN_DELAY_MS));
    }
  };
  const onFocusIn = (event: FocusEvent) => {
    const next = (event.target as Element).closest<HTMLElement>("[data-tip]");
    if (next === null || !next.matches(":focus-visible")) return;
    trigger = next;
    clearTimeout(pending);
    show(next, true);
  };
  const onFocusOut = (event: FocusEvent) => {
    if (open()?.Trigger === event.target) hide();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") hide();
  };
  const onScroll = (event: Event) => {
    if (trigger !== null && (event.target as Node).contains(trigger)) hide();
  };

  onMount(() => {
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    onCleanup(() => {
      clearTimeout(pending);
      clearTimeout(cooling);
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, { capture: true });
    });
  });

  return (
    <Show when={open()} keyed>
      {(tip) => <TipPopup tip={tip} />}
    </Show>
  );
}
