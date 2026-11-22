// @effect-diagnostics globalTimers:off -- Pointer handling in the view, outside any Effect runtime.
import { createSignal, onCleanup } from "solid-js";

import { dropGap, moveProject } from "./projectOrder";

// Stock's per-project sidebar started its project drag at this distance.
const ACTIVATION_DISTANCE = 6;
// The same hold and slop as `longPress` in viewport.ts, which a touch drag takes the place of.
const HOLD_MS = 500;
const HOLD_SLOP = 10;
const EDGE = 32;
const MAX_SCROLL_STEP = 14;

interface IMeasured {
  Ids: string[];
  Middles: number[];
  Tops: number[];
  End: number;
}

const swallow = (event: Event) => {
  event.preventDefault();
  event.stopPropagation();
};

/**
 * Pointer drag that reorders `blocks` inside the scrolling `list`. Touch picks up on a long-press
 * so a swipe still scrolls; a hold released in place calls `onHold`. Positions are measured once
 * per drag, so a move costs a binary search.
 */
export function createListDrag(options: {
  list: () => HTMLElement | undefined;
  /** The blocks the dragged id is reordered among, in their shown order. */
  blocks: (list: HTMLElement, id: string) => HTMLElement[];
  idOf: (block: HTMLElement) => string;
  /** The part of a block whose middle splits the drop gaps, if not the whole block. */
  anchorOf?: (block: HTMLElement) => Element | null;
  onDrop: (id: string, order: string[]) => void;
}) {
  const [dragging, setDragging] = createSignal<string | null>(null);
  const [gap, setGap] = createSignal<number | null>(null);
  let ghost: HTMLElement | undefined;
  let measured: IMeasured | null = null;
  let stop: (() => void) | null = null;
  onCleanup(() => stop?.());

  const measure = (list: HTMLElement, id: string): IMeasured => {
    const base = list.getBoundingClientRect().top - list.scrollTop;
    const blocks = options.blocks(list, id);
    const Middles: number[] = [];
    const Tops: number[] = [];
    for (const block of blocks) {
      const anchor = (options.anchorOf?.(block) ?? block).getBoundingClientRect();
      Tops.push(block.getBoundingClientRect().top - base);
      Middles.push(anchor.top + anchor.height / 2 - base);
    }
    const last = blocks.at(-1)?.getBoundingClientRect();
    return {
      Ids: blocks.map(options.idOf),
      Middles,
      Tops,
      End: last === undefined ? 0 : last.bottom - base,
    };
  };

  const begin = (event: PointerEvent, id: string, onHold?: (x: number, y: number) => void) => {
    if (event.button !== 0 || stop !== null) return;
    const list = options.list();
    if (list === undefined) return;
    const touch = event.pointerType === "touch";
    const startX = event.clientX;
    const startY = event.clientY;
    let pointerX = startX;
    let pointerY = startY;
    let frame = 0;
    let held = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const moveGhost = () => {
      if (ghost !== undefined) {
        ghost.style.transform = `translate(${pointerX + 12}px, ${pointerY - 10}px)`;
      }
    };
    const lift = () => {
      measured = measure(list, id);
      setDragging(id);
      window.getSelection()?.removeAllRanges();
      document.documentElement.style.userSelect = "none";
      queueMicrotask(moveGhost);
    };
    const place = () => {
      if (measured === null) return;
      setGap(
        dropGap(measured.Middles, pointerY - list.getBoundingClientRect().top + list.scrollTop),
      );
    };
    const scroll = () => {
      frame = 0;
      const rect = list.getBoundingClientRect();
      const over =
        pointerY < rect.top + EDGE
          ? pointerY - (rect.top + EDGE)
          : pointerY > rect.bottom - EDGE
            ? pointerY - (rect.bottom - EDGE)
            : 0;
      if (over === 0) return;
      const before = list.scrollTop;
      list.scrollTop += Math.max(-MAX_SCROLL_STEP, Math.min(MAX_SCROLL_STEP, over / 2));
      if (list.scrollTop === before) return;
      place();
      frame = requestAnimationFrame(scroll);
    };
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== event.pointerId) return;
      pointerX = move.clientX;
      pointerY = move.clientY;
      const distance = Math.hypot(move.clientX - startX, move.clientY - startY);
      if (touch && !held) {
        if (distance > HOLD_SLOP) end();
        return;
      }
      if (gap() === null && distance < ACTIVATION_DISTANCE) return;
      if (measured === null) lift();
      moveGhost();
      place();
      if (frame === 0) frame = requestAnimationFrame(scroll);
    };
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== event.pointerId) return;
      const dropAt = gap();
      const ids = measured?.Ids ?? [];
      const wasHeld = held;
      const dragged = dropAt !== null;
      end();
      if (!dragged && !wasHeld) return;
      // The click that ends a drag or a hold would otherwise act on the row under the pointer.
      window.addEventListener("click", swallow, true);
      setTimeout(() => window.removeEventListener("click", swallow, true));
      if (!dragged) {
        onHold?.(startX, startY);
        return;
      }
      const next = moveProject(ids, id, dropAt);
      if (next !== null) options.onDrop(id, next);
    };
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      end();
    };
    const end = () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("touchmove", swallow);
      window.removeEventListener("contextmenu", swallow, true);
      cancelAnimationFrame(frame);
      document.documentElement.style.userSelect = "";
      measured = null;
      setDragging(null);
      setGap(null);
      stop = null;
    };
    if (touch) {
      // Android's own long-press would open the row's menu as the hold starts.
      window.addEventListener("contextmenu", swallow, true);
      timer = setTimeout(() => {
        held = true;
        // Once held, moving the finger drags the row instead of scrolling the list.
        window.addEventListener("touchmove", swallow, { passive: false });
        lift();
      }, HOLD_MS);
    }
    stop = end;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", end);
    window.addEventListener("keydown", onKey, true);
  };

  /** Where the drop line sits, in the list's scroll coordinates. */
  const lineTop = () => {
    const at = gap();
    if (at === null || measured === null) return null;
    return at < measured.Tops.length ? measured.Tops[at]! - 3 : measured.End + 2;
  };

  return {
    dragging,
    lineTop,
    begin,
    setGhost: (element: HTMLElement) => {
      ghost = element;
    },
  };
}
