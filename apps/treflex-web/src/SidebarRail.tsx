import { dragSidebarWidth } from "./sidebarWidth";

interface IRailDrag {
  Pointer: number;
  StartX: number;
  StartWidth: number;
  Width: number;
  Moved: boolean;
}

interface IRailProps {
  width: number;
  onResize: (width: number) => void;
  /** The drag ended, with the width to keep, or null when it never moved. */
  onDone: (width: number | null) => void;
  onReset: () => void;
}

function railDrag(props: IRailProps) {
  const held: { Drag: IRailDrag | null } = { Drag: null };
  const finish = (event: PointerEvent & { currentTarget: HTMLElement }) => {
    const drag = held.Drag;
    if (drag === null || drag.Pointer !== event.pointerId) return;
    held.Drag = null;
    const rail = event.currentTarget;
    if (rail.hasPointerCapture(drag.Pointer)) rail.releasePointerCapture(drag.Pointer);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    props.onDone(drag.Moved ? drag.Width : null);
  };
  return {
    onPointerDown: (event: PointerEvent & { currentTarget: HTMLElement }) => {
      if (event.button !== 0 || held.Drag !== null) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      held.Drag = {
        Pointer: event.pointerId,
        StartX: event.clientX,
        StartWidth: props.width,
        Width: props.width,
        Moved: false,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    onPointerMove: (event: PointerEvent & { currentTarget: HTMLElement }) => {
      const drag = held.Drag;
      if (drag === null || drag.Pointer !== event.pointerId) return;
      event.preventDefault();
      const delta = event.clientX - drag.StartX;
      if (Math.abs(delta) > 2) drag.Moved = true;
      drag.Width = dragSidebarWidth({
        Current: drag.Width,
        Next: drag.StartWidth + delta,
        ViewportWidth: window.innerWidth,
        LayoutWidth: event.currentTarget.parentElement?.clientWidth ?? window.innerWidth,
      });
      props.onResize(drag.Width);
    },
    finish,
  };
}

// Follows SidebarRail in apps/web/src/components/ui/sidebar.tsx and apps/web/src/hooks/useResizeDrag.ts.
/** The sidebar's edge: dragging resizes it and a double-click resets it. Sits in the layout grid. */
export function SidebarRail(props: IRailProps) {
  const drag = railDrag(props);
  return (
    <button
      type="button"
      class="absolute inset-y-0 z-20 -ml-px w-4 -translate-x-1/2 cursor-col-resize touch-none border-0 bg-transparent p-0 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border in-[.sidebar-collapsed]:hidden in-[.sidebar-sheet]:hidden"
      style={{ left: "calc(var(--sidebar-width) + env(safe-area-inset-left))" }}
      aria-label="Resize Sidebar"
      data-tip="Drag to resize sidebar"
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.finish}
      onPointerCancel={drag.finish}
      onLostPointerCapture={drag.finish}
      onDblClick={() => props.onReset()}
    />
  );
}
