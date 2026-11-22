// @effect-diagnostics globalTimers:off -- View-only hover delays, outside any Effect runtime.
import {
  type Component,
  createComponent,
  createRoot,
  createSignal,
  getOwner,
  type JSX,
  onCleanup,
  onMount,
  type Owner,
} from "solid-js";

import { follow, type IAlign, type IPlacement, type ISide } from "./floating";
import { Presence, usePresence } from "./Presence";

type IVariant = "default" | "glass" | "code";

const SIDE_OFFSET = 4;
const OPEN_DELAY_MS = 600;
const REOPEN_WINDOW_MS = 400;
const CLOSE_GRACE_MS = 100;
const POPUP_ID = "tooltip-popup";

const POSITIONER =
  "pointer-events-none z-[140] max-w-(--available-width) transition-[top,left,right,bottom,transform] data-instant:transition-none";

const POPUP =
  "relative flex origin-(--transform-origin) rounded-md text-popover-foreground transition-[scale,opacity] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-md)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 data-instant:duration-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]";

const POPUP_SURFACE: Record<IVariant, string> = {
  default: "border bg-popover not-dark:bg-clip-padding shadow-md/5",
  glass: "dropdown-glass shadow-xl shadow-black/25 before:hidden",
  code: "border bg-popover not-dark:bg-clip-padding shadow-md/5",
};

const POPUP_TEXT: Record<IVariant, string> = {
  default: "text-xs max-w-80 wrap-anywhere whitespace-normal leading-snug",
  glass: "text-xs max-w-80 wrap-anywhere whitespace-normal leading-snug",
  code: "max-w-120 wrap-anywhere text-left font-mono text-[11px] leading-relaxed",
};

const HOVERABLE = "pointer-events-auto";
const CARD = "text-left";

interface ICard {
  Render: () => JSX.Element;
  // The popup mounts under TooltipHost, outside the providers the card reads, so it renders under the trigger's owner.
  Owner: Owner | null;
}

const cards = new WeakMap<Element, ICard>();

/** Shows `card` in a glass popup in place of the trigger's `data-tip` text. */
export const hoverCard =
  <P extends object>(card: Component<P>, props: P) =>
  (element: HTMLElement) => {
    cards.set(element, { Render: () => createComponent(card, props), Owner: getOwner() });
  };

interface IOpenTip {
  Trigger: HTMLElement;
  Instant: boolean;
  Hoverable: boolean;
  Group: Element | null;
}

function describe(trigger: HTMLElement, present: boolean): void {
  const tokens = (trigger.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  const next = present
    ? tokens.includes(POPUP_ID)
      ? tokens
      : [...tokens, POPUP_ID]
    : tokens.filter((token) => token !== POPUP_ID);
  if (next.length > 0) trigger.setAttribute("aria-describedby", next.join(" "));
  else trigger.removeAttribute("aria-describedby");
}

const tipPlacement = (trigger: HTMLElement): IPlacement => ({
  side: (trigger.dataset.tipSide as ISide | undefined) ?? "top",
  align: (trigger.dataset.tipAlign as IAlign | undefined) ?? "center",
  sideOffset: Number(trigger.dataset.tipOffset ?? SIDE_OFFSET),
});

function watchText(trigger: HTMLElement, onText: (text: string | undefined) => void): () => void {
  const observer = new MutationObserver(() => onText(trigger.dataset.tip));
  observer.observe(trigger, { attributes: true, attributeFilter: ["data-tip"] });
  return () => observer.disconnect();
}

function followTip(positioner: HTMLElement, trigger: HTMLElement, onLost: () => void): () => void {
  let placed = false;
  return follow(
    positioner,
    trigger,
    () => tipPlacement(trigger),
    onLost,
    () => {
      if (placed) return;
      placed = true;
      // The first position lands before the first frame; reading layout here commits it, so the
      // top/left transition only plays on later moves instead of sliding in from the corner.
      positioner.getBoundingClientRect();
      positioner.style.removeProperty("transition");
    },
  );
}

function renderCard(card: ICard): JSX.Element {
  let dispose = () => {};
  const view = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    return card.Render();
  }, card.Owner);
  onCleanup(() => dispose());
  return view;
}

function TipPopup(props: { tip: IOpenTip; onLost: () => void }) {
  const presence = usePresence();
  const trigger = props.tip.Trigger;
  const card = cards.get(trigger);
  const variant: IVariant =
    card === undefined
      ? ((trigger.dataset.tipVariant as IVariant | undefined) ?? "default")
      : "glass";
  const classes = [POPUP, POPUP_SURFACE[variant], POPUP_TEXT[variant]];
  if (props.tip.Hoverable) classes.push(HOVERABLE);
  if (card !== undefined) classes.push(CARD);
  const [positioner, setPositioner] = createSignal<HTMLDivElement>();
  const [text, setText] = createSignal(trigger.dataset.tip);
  onMount(() => {
    const element = positioner();
    if (element !== undefined) onCleanup(followTip(element, trigger, () => props.onLost()));
    if (card !== undefined) return;
    onCleanup(
      watchText(trigger, (next) => {
        if (next) setText(next);
        else props.onLost();
      }),
    );
  });
  return (
    <div
      ref={setPositioner}
      class={POSITIONER}
      style={{ position: "fixed", left: "0px", top: "0px", transition: "none" }}
      data-slot="tooltip-positioner"
      data-instant={props.tip.Instant ? "" : undefined}
    >
      <div
        ref={(popup) => presence.track(popup)}
        id={POPUP_ID}
        class={classes.join(" ")}
        role="tooltip"
        data-slot="tooltip-popup"
        data-instant={props.tip.Instant ? "" : undefined}
      >
        <div class="min-w-0 px-2 py-1" data-slot="tooltip-viewport">
          {card === undefined ? text() : renderCard(card)}
        </div>
      </div>
    </div>
  );
}

function tooltipController() {
  const [open, setOpen] = createSignal<IOpenTip | null>(null);
  let hovered: HTMLElement | null = null;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
  let cooling: ReturnType<typeof setTimeout> | undefined;
  let warm: Element | null = null;

  const setTip = (next: IOpenTip | null) => {
    const previous = open();
    if (previous !== null) describe(previous.Trigger, false);
    if (next?.Hoverable === true) describe(next.Trigger, true);
    setOpen(next);
  };
  const tipFor = (trigger: HTMLElement): Omit<IOpenTip, "Instant"> => {
    const hoverable = trigger.closest("[data-tip-hoverable]") !== null;
    return {
      Trigger: trigger,
      Hoverable: hoverable,
      Group: trigger.closest(hoverable ? "[data-tip-shared]" : "[data-tip-group]"),
    };
  };
  /** Whether `tip` opens without its delay or entrance, as a provider's adjacent tooltips do. */
  const instant = (tip: Omit<IOpenTip, "Instant">) =>
    tip.Group !== null && (open()?.Group === tip.Group || warm === tip.Group);
  const show = (tip: Omit<IOpenTip, "Instant">, immediate: boolean) => {
    if (!tip.Trigger.isConnected || !(tip.Trigger.dataset.tip || cards.has(tip.Trigger))) return;
    setTip({ ...tip, Instant: immediate });
  };
  const hide = () => {
    clearTimeout(pending);
    clearTimeout(grace);
    const tip = open();
    if (tip === null) return;
    setTip(null);
    warm = tip.Group;
    clearTimeout(cooling);
    cooling = setTimeout(() => {
      warm = null;
    }, REOPEN_WINDOW_MS);
  };
  const dismiss = () => {
    const popup = open() === null ? null : document.getElementById(POPUP_ID);
    if (popup !== null) {
      popup.dataset.instant = "";
      if (popup.parentElement !== null) popup.parentElement.dataset.instant = "";
    }
    hide();
  };
  const leave = () => {
    clearTimeout(pending);
    if (open()?.Hoverable !== true) {
      hide();
      return;
    }
    clearTimeout(grace);
    grace = setTimeout(hide, CLOSE_GRACE_MS);
  };
  const inPopup = (target: EventTarget | null) =>
    open()?.Hoverable === true &&
    target instanceof Element &&
    target.closest(`#${POPUP_ID}`) !== null;

  const onPointerOver = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    if (inPopup(event.target)) {
      clearTimeout(grace);
      return;
    }
    const next = (event.target as Element).closest<HTMLElement>("[data-tip]");
    if (next === hovered) return;
    hovered = next;
    if (next === null) {
      leave();
      return;
    }
    clearTimeout(pending);
    clearTimeout(grace);
    if (next === open()?.Trigger) return;
    const tip = tipFor(next);
    if (instant(tip)) {
      show(tip, true);
      return;
    }
    hide();
    const delay = next.closest<HTMLElement>("[data-tip-delay]")?.dataset.tipDelay;
    pending = setTimeout(() => show(tip, false), Number(delay ?? OPEN_DELAY_MS));
  };
  const onPointerOut = (event: PointerEvent) => {
    if (event.pointerType === "touch" || event.relatedTarget !== null) return;
    hovered = null;
    leave();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (inPopup(event.target)) return;
    const trigger = open()?.Trigger;
    if (trigger !== undefined && event.target instanceof Node && trigger.contains(event.target)) {
      dismiss();
    } else hide();
  };
  const onFocusIn = (event: FocusEvent) => {
    const next = (event.target as Element).closest<HTMLElement>("[data-tip]");
    if (next === null || !next.matches(":focus-visible")) return;
    clearTimeout(pending);
    clearTimeout(grace);
    if (next !== open()?.Trigger) show(tipFor(next), true);
  };
  const onFocusOut = (event: FocusEvent) => {
    if (open()?.Trigger === event.target) leave();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") dismiss();
  };
  const onScroll = (event: Event) => {
    const trigger = open()?.Trigger ?? hovered;
    if (trigger === null || !(event.target instanceof Element)) return;
    const area = event.target.closest("[data-tip-scroll-dismiss]");
    if (area === null || !area.contains(trigger)) return;
    const focused = document.activeElement;
    if (focused !== null && trigger.contains(focused) && focused.matches(":focus-visible")) return;
    hide();
  };

  onMount(() => {
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    onCleanup(() => {
      clearTimeout(pending);
      clearTimeout(grace);
      clearTimeout(cooling);
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, { capture: true });
    });
  });

  return { open, hide };
}

/**
 * The tooltip for every `data-tip`: `-side`, `-align`, `-offset` and `-variant` on the trigger,
 * `-delay` on it or an ancestor. `data-tip-group` is stock's `TooltipProvider`; `data-tip-shared`
 * its `SharedTooltipProvider`, for `data-tip-hoverable` tips, whose popup takes the pointer.
 * Scrolling a `data-tip-scroll-dismiss` closes the tip.
 */
export function TooltipHost() {
  const { open, hide } = tooltipController();
  return (
    <Presence when={open()} keyed>
      {(tip) => <TipPopup tip={tip()} onLost={hide} />}
    </Presence>
  );
}
