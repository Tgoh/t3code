import type { JSX } from "@solidjs/web";
import {
  createContext,
  createRenderEffect,
  createSignal,
  createUniqueId,
  omit,
  Show,
  useContext,
} from "solid-js";

const HEIGHT = "--collapsible-panel-height";

interface ICollapsible {
  open: () => boolean;
  setOpen: (open: boolean) => void;
  panelId: string;
}

const CollapsibleContext = createContext<ICollapsible>();

const useCollapsible = () => {
  const context = useContext(CollapsibleContext);
  if (context === undefined) throw new Error("A collapsible part must sit inside a Collapsible.");
  return context;
};

export function Collapsible(
  props: JSX.HTMLAttributes<HTMLDivElement> & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  },
) {
  const rest = omit(props, "open", "onOpenChange");
  const context: ICollapsible = {
    open: () => props.open,
    setOpen: (open) => props.onOpenChange(open),
    panelId: createUniqueId(),
  };
  return (
    <CollapsibleContext value={context}>
      <div
        data-slot="collapsible"
        data-open={props.open ? "" : undefined}
        data-closed={props.open ? undefined : ""}
        {...rest}
      />
    </CollapsibleContext>
  );
}

export function CollapsibleTrigger(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const collapsible = useCollapsible();
  const rest = omit(props, "class");
  return (
    <button
      type="button"
      data-slot="collapsible-trigger"
      {...rest}
      aria-expanded={collapsible.open() ? "true" : "false"}
      aria-controls={collapsible.open() ? collapsible.panelId : undefined}
      data-panel-open={collapsible.open() ? "" : undefined}
      class={["cursor-pointer", props.class].filter(Boolean).join(" ")}
      onClick={() => collapsible.setOpen(!collapsible.open())}
    />
  );
}

async function settled(panel: HTMLElement) {
  for (;;) {
    const running = panel.getAnimations();
    if (running.length === 0) return;
    await Promise.allSettled(running.map((animation) => animation.finished));
  }
}

export function CollapsiblePanel(
  props: JSX.HTMLAttributes<HTMLDivElement> & { animate?: boolean },
) {
  const collapsible = useCollapsible();
  const rest = omit(props, "animate", "class", "children");
  const animate = () => props.animate ?? true;
  const [mounted, setMounted] = createSignal(collapsible.open());
  const [starting, setStarting] = createSignal(false);
  const [ending, setEnding] = createSignal(false);
  const [height, setHeight] = createSignal("auto");
  const [panel, setPanel] = createSignal<HTMLDivElement>();
  let generation = 0;
  const after = (run: number, done: () => void) => {
    const element = panel();
    if (element === undefined) return done();
    void settled(element).then(() => {
      if (run === generation) done();
    });
  };
  createRenderEffect(
    collapsible.open,
    (open) => {
      const run = ++generation;
      if (!animate()) {
        setMounted(open);
        return;
      }
      if (open) {
        if (ending()) {
          setEnding(false);
          after(run, () => setHeight("auto"));
          return;
        }
        setStarting(true);
        setMounted(true);
        queueMicrotask(() => {
          const element = panel();
          if (run !== generation || element === undefined) return;
          // Reading the height also gives the panel its no-height starting style to move from.
          setHeight(`${element.scrollHeight}px`);
          requestAnimationFrame(() => {
            if (run !== generation) return;
            setStarting(false);
            after(run, () => setHeight("auto"));
          });
        });
        return;
      }
      const element = panel();
      if (!mounted() || element === undefined) {
        setMounted(false);
        return;
      }
      setStarting(false);
      setHeight(`${element.scrollHeight}px`);
      queueMicrotask(() => {
        if (run !== generation) return;
        // The measured height must be the transition's start, so it's applied before the ending style.
        void element.offsetHeight;
        setEnding(true);
        after(run, () => {
          setEnding(false);
          setMounted(false);
        });
      });
    },
    { defer: true },
  );
  return (
    <Show when={mounted()}>
      <div
        data-slot="collapsible-panel"
        id={collapsible.panelId}
        data-open={collapsible.open() ? "" : undefined}
        data-closed={collapsible.open() ? undefined : ""}
        data-starting-style={starting() ? "" : undefined}
        data-ending-style={ending() ? "" : undefined}
        style={{ [HEIGHT]: height() }}
        {...rest}
        ref={setPanel}
        class={[
          "overflow-hidden",
          animate() &&
            "h-(--collapsible-panel-height) transition-[height] duration-200 motion-reduce:transition-none data-ending-style:h-0 data-starting-style:h-0 data-open:data-ending-style:[height:var(--collapsible-panel-height)]",
          props.class,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {props.children}
      </div>
    </Show>
  );
}
