import { onCleanup } from "solid-js";

import { dragSidebarWidth } from "./sidebarWidth";
import { SidebarRail as RailButton } from "./ui/Sidebar";

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
  /** The drag ended, with the width to keep, or null when it never moved or was abandoned. */
  onDone: (width: number | null) => void;
  onReset: () => void;
}

function railDrag(props: IRailProps) {
  const held: { Drag: IRailDrag | null } = { Drag: null };
  const release = () => {
    held.Drag = null;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  };
  // Collapsing the sidebar unmounts the rail mid-drag, which abandons the drag.
  onCleanup(() => {
    if (held.Drag === null) return;
    release();
    props.onDone(null);
  });
  const finish = (event: PointerEvent & { currentTarget: HTMLElement }) => {
    const drag = held.Drag;
    if (drag === null || drag.Pointer !== event.pointerId) return;
    release();
    const rail = event.currentTarget;
    if (rail.hasPointerCapture(drag.Pointer)) rail.releasePointerCapture(drag.Pointer);
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

/**
 * The open sidebar's edge: dragging resizes it and a double-click resets it. Sits in the layout
 * grid, so the caller renders it only while the sidebar is a column.
 */
export function SidebarRail(props: IRailProps) {
  const drag = railDrag(props);
  return (
    <RailButton
      class="-ml-px"
      style={{ left: "calc(var(--sidebar-width) + env(safe-area-inset-left))" }}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.finish}
      onPointerCancel={drag.finish}
      onLostPointerCapture={drag.finish}
      onDblClick={() => props.onReset()}
    />
  );
}
