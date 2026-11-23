import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";

interface IObservedAnimation {
  element: HTMLElement | SVGElement;
  intersecting: boolean;
}

const animations = new Map<Element, IObservedAnimation>();
let observer: IntersectionObserver | null = null;
let reducedMotion: MediaQueryList | null = null;

function updateAnimation(animation: IObservedAnimation) {
  const running =
    animation.intersecting && document.visibilityState === "visible" && !reducedMotion?.matches;
  animation.element.style.setProperty("--visible-animation-state", running ? "running" : "paused");
  animation.element.style.setProperty(
    "--visible-animation-will-change",
    running ? "transform" : "auto",
  );
}

function updateAnimations() {
  for (const animation of animations.values()) updateAnimation(animation);
}

function observe(element: HTMLElement | SVGElement) {
  element.style.setProperty("--visible-animation-state", "paused");
  element.style.setProperty("--visible-animation-will-change", "auto");
  if (typeof IntersectionObserver === "undefined") return;

  if (observer === null) {
    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.addEventListener("change", updateAnimations);
    document.addEventListener("visibilitychange", updateAnimations);
    observer = new IntersectionObserver((entries, source) => {
      if (source !== observer) return;
      for (const entry of entries) {
        const animation = animations.get(entry.target);
        if (!animation) continue;
        animation.intersecting = entry.isIntersecting;
        updateAnimation(animation);
      }
    });
  }

  const animation = { element, intersecting: false };
  animations.set(element, animation);
  observer.observe(element);

  return () => {
    if (animations.get(element) !== animation) return;
    animations.delete(element);
    observer?.unobserve(element);
    element.style.setProperty("--visible-animation-state", "paused");
    element.style.setProperty("--visible-animation-will-change", "auto");
    if (animations.size === 0) {
      observer?.disconnect();
      observer = null;
      reducedMotion?.removeEventListener("change", updateAnimations);
      reducedMotion = null;
      document.removeEventListener("visibilitychange", updateAnimations);
    }
  };
}

/**
 * Runs the element's `visible-animate-*` animation only while it is on screen, the tab is visible
 * and motion isn't reduced, and while `active` holds if given. Call it in a component body and pass
 * the returned ref to the element; it stops with that component.
 */
export function observeVisibleAnimation(active?: Accessor<boolean>) {
  if (active === undefined) {
    let stop: (() => void) | undefined;
    onCleanup(() => stop?.());
    return (element: HTMLElement | SVGElement) => {
      stop = observe(element);
    };
  }
  const [element, setElement] = createSignal<HTMLElement | SVGElement>();
  createEffect(
    () => (active() ? element() : undefined),
    (held) => (held === undefined ? undefined : observe(held)),
  );
  return (held: HTMLElement | SVGElement) => {
    setElement(() => held);
  };
}
