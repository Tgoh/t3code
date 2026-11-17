// @effect-diagnostics globalTimers:off -- Pointer handling in the view, outside any Effect runtime.
import { createSignal, onCleanup } from "solid-js";

import { dropGap, moveProject } from "./projectOrder";

// Stock's per-project sidebar started its project drag at this distance.
const ACTIVATION_DISTANCE = 6;
const EDGE = 32;
const MAX_SCROLL_STEP = 14;

interface IMeasured {
  Middles: number[];
  Tops: number[];
  End: number;
}

const swallowClick = (event: MouseEvent) => event.stopPropagation();

/**
 * Pointer drag over the folder blocks in `list`, each marked with `data-folder-id`.
 * Positions are measured once per drag, in the list's scroll coordinates, so a move
 * costs a binary search however many folders there are.
 */
export function createProjectDrag(options: {
  list: () => HTMLElement | undefined;
  order: () => string[];
  onDrop: (order: string[]) => void;
}) {
  const [dragging, setDragging] = createSignal<string | null>(null);
  const [gap, setGap] = createSignal<number | null>(null);
  let ghost: HTMLElement | undefined;
  let measured: IMeasured | null = null;
  let stop: (() => void) | null = null;
  onCleanup(() => stop?.());

  const measure = (list: HTMLElement): IMeasured => {
    const base = list.getBoundingClientRect().top - list.scrollTop;
    const blocks = [...list.querySelectorAll<HTMLElement>("[data-folder-id]")];
    const Middles: number[] = [];
    const Tops: number[] = [];
    for (const block of blocks) {
      const header = (block.querySelector("[data-folder-header]") ?? block).getBoundingClientRect();
      Tops.push(block.getBoundingClientRect().top - base);
      Middles.push(header.top + header.height / 2 - base);
    }
    const last = blocks.at(-1)?.getBoundingClientRect();
    return { Middles, Tops, End: last === undefined ? 0 : last.bottom - base };
  };

  const begin = (event: PointerEvent, id: string) => {
    if (event.button !== 0 || event.pointerType === "touch" || stop !== null) return;
    const list = options.list();
    if (list === undefined) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let pointerY = startY;
    let frame = 0;

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
      pointerY = move.clientY;
      if (measured === null) {
        if (Math.hypot(move.clientX - startX, move.clientY - startY) < ACTIVATION_DISTANCE) return;
        measured = measure(list);
        setDragging(id);
        window.getSelection()?.removeAllRanges();
        document.documentElement.style.userSelect = "none";
      }
      if (ghost !== undefined) {
        ghost.style.transform = `translate(${move.clientX + 12}px, ${move.clientY - 10}px)`;
      }
      place();
      if (frame === 0) frame = requestAnimationFrame(scroll);
    };
    const onUp = () => {
      const dropAt = gap();
      const dragged = measured !== null;
      end();
      if (!dragged) return;
      // The click that ends a drag would otherwise toggle the folder under the pointer.
      window.addEventListener("click", swallowClick, true);
      setTimeout(() => window.removeEventListener("click", swallowClick, true));
      if (dropAt === null) return;
      const next = moveProject(options.order(), id, dropAt);
      if (next !== null) options.onDrop(next);
    };
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      end();
    };
    const end = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(frame);
      document.documentElement.style.userSelect = "";
      measured = null;
      setDragging(null);
      setGap(null);
      stop = null;
    };
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
