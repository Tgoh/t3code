import { createSignal, type JSX, onCleanup, onMount, Show } from "solid-js";

export function MenuItem(props: {
  icon: JSX.Element;
  label: string;
  detail?: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      class="menu-item"
      classList={{ danger: props.danger === true }}
      role="menuitem"
      onClick={props.onSelect}
    >
      {props.icon}
      <span class="menu-label">{props.label}</span>
      <Show when={props.detail}>
        <span class="menu-detail">{props.detail}</span>
      </Show>
    </button>
  );
}

export function Popup(props: {
  x: number;
  y: number;
  label: string;
  onClose: () => void;
  children: JSX.Element;
}) {
  const [menuElement, setMenuElement] = createSignal<HTMLDivElement>();
  onMount(() => {
    const menu = menuElement();
    if (menu === undefined) return;
    const margin = 8;
    menu.style.left = `${Math.min(props.x, window.innerWidth - menu.offsetWidth - margin)}px`;
    menu.style.top = `${Math.max(margin, Math.min(props.y, window.innerHeight - menu.offsetHeight - margin))}px`;
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) props.onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    });
  });
  return (
    <div class="thread-menu" role="menu" aria-label={props.label} ref={setMenuElement}>
      {props.children}
    </div>
  );
}
