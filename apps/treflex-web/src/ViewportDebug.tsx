// @effect-diagnostics globalTimers:off -- A view-only sampling tick and copy label reset, outside any Effect runtime.
import { createSignal, For, onSettled } from "solid-js";

import { copyText } from "./clipboard";
import { clearTrace, setTraceRecording, traceText } from "./scrollTrace";
import { Button } from "./ui/Button";

const SAMPLE_MS = 250;

const px = (value: number | undefined) => (value === undefined ? "–" : `${Math.round(value)}px`);

function readVar(element: Element | null, name: string): string {
  if (element === null) return "–";
  return getComputedStyle(element).getPropertyValue(name).trim() || "–";
}

function sample(probe: HTMLElement): Array<[string, string]> {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  const stage = document.querySelector(".chat-stage");
  const lane = document.querySelector<HTMLElement>(".composer-lane");
  const timeline = document.querySelector<HTMLElement>("[data-timeline]");
  const insets = getComputedStyle(probe);
  // The timeline is bottom-anchored: its scrollTop is 0 at the end and negative above it.
  const toEnd = timeline === null ? undefined : -timeline.scrollTop;
  return [
    ["visual h", px(viewport?.height)],
    ["visual top", px(viewport?.offsetTop)],
    ["scale", viewport === undefined || viewport === null ? "–" : viewport.scale.toFixed(2)],
    ["inner h", px(window.innerHeight)],
    ["root h", px(root.clientHeight)],
    ["keyboard", root.dataset.keyboard ?? "closed"],
    ["safe top", insets.paddingTop],
    ["safe bottom", insets.paddingBottom],
    ["--safe-bottom", readVar(root, "--safe-bottom")],
    ["lane h", px(lane?.offsetHeight)],
    ["--composer-height", readVar(stage, "--composer-height")],
    ["--turn-status-height", readVar(stage, "--turn-status-height")],
    ["timeline h", px(timeline?.clientHeight)],
    ["scroll to end", px(toEnd)],
  ];
}

/** Live layout numbers for diagnosing phone bugs, shown on demand from the thread header. */
export function ViewportDebug() {
  const [rows, setRows] = createSignal<Array<[string, string]>>([]);
  const [copied, setCopied] = createSignal<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    setCopied((await copyText(traceText())) ? "copied" : "failed");
    setTimeout(() => setCopied("idle"), 1500);
  };
  onSettled(() => {
    setTraceRecording(true);
    // Reads the safe-area insets, which only CSS can resolve.
    const probe = document.createElement("div");
    probe.className =
      "pointer-events-none invisible fixed size-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]";
    document.body.append(probe);
    const update = () => setRows(sample(probe));
    update();
    const timer = setInterval(update, SAMPLE_MS);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      setTraceRecording(false);
      clearInterval(timer);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      probe.remove();
    };
  });
  return (
    <div class="pointer-events-none fixed top-[calc(env(safe-area-inset-top)+3.25rem)] left-2 z-50 rounded-md border border-border bg-background/90 px-2 py-1.5 font-mono text-[11px] leading-4 text-foreground shadow-sm">
      <dl class="m-0 grid grid-cols-[auto_auto] gap-x-3">
        <For each={rows()}>
          {([label, value]) => (
            <>
              <dt class="text-muted-foreground">{label}</dt>
              <dd class="m-0 text-right tabular-nums">{value}</dd>
            </>
          )}
        </For>
      </dl>
      <div class="pointer-events-auto mt-1.5 flex gap-1">
        <Button size="xs" variant="outline" onClick={() => void copy()}>
          {copied() === "copied" ? "Copied" : copied() === "failed" ? "Copy failed" : "Copy trace"}
        </Button>
        <Button size="xs" variant="outline" onClick={clearTrace}>
          Clear
        </Button>
      </div>
    </div>
  );
}
