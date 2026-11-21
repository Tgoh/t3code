// @effect-diagnostics globalTimers:off -- Page code, outside any Effect runtime.
// Runs inside the page under test, installed before the stream starts. Kept free of imports and
// closures over module scope, because Playwright serializes it into the page.
export function installProbe(): void {
  type ProbeState = {
    longTasks: Array<number>;
    loafBlocking: Array<number>;
    frames: Array<number>;
    keyLatencies: Array<number>;
    eventDurations: Array<number>;
    running: boolean;
    lastMutation: number;
  };
  const state: ProbeState = {
    longTasks: [],
    loafBlocking: [],
    frames: [],
    keyLatencies: [],
    eventDurations: [],
    running: true,
    lastMutation: performance.now(),
  };
  (window as unknown as { __bench: ProbeState }).__bench = state;

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
  }).observe({ type: "longtask" });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      state.loafBlocking.push((entry as unknown as { blockingDuration: number }).blockingDuration);
    }
  }).observe({ type: "long-animation-frame" });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.name === "keydown") state.eventDurations.push(entry.duration);
    }
  }).observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);

  let last = performance.now();
  const frame = (now: number) => {
    if (!state.running) return;
    state.frames.push(now - last);
    last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame((now) => {
    last = now;
    requestAnimationFrame(frame);
  });

  // Keydown to the frame that can show it: the next animation frame, then the task after it.
  addEventListener(
    "keydown",
    (event) => {
      const start = event.timeStamp;
      requestAnimationFrame(() => {
        setTimeout(() => state.keyLatencies.push(performance.now() - start), 0);
      });
    },
    { capture: true },
  );

  new MutationObserver(() => {
    state.lastMutation = performance.now();
  }).observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
}

/** Scrolls the page's tallest scroller, the timeline in both clients, to its top or bottom. */
export function scrollTimeline(toTop: boolean): number {
  let tallest: Element | undefined;
  for (const element of document.querySelectorAll("*")) {
    const overflow = getComputedStyle(element).overflowY;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    if (element.scrollHeight <= element.clientHeight + 10) continue;
    if (tallest === undefined || element.scrollHeight > tallest.scrollHeight) tallest = element;
  }
  if (tallest === undefined) return 0;
  tallest.scrollTop = toTop ? 0 : tallest.scrollHeight;
  return tallest.scrollHeight;
}

/** Resolves once the page's DOM has been still for `quietMs`, or after `capMs`. */
export function waitForQuiet({
  quietMs,
  capMs,
}: {
  quietMs: number;
  capMs: number;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let last = performance.now();
    const observer = new MutationObserver(() => {
      last = performance.now();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    const started = performance.now();
    const check = () => {
      const now = performance.now();
      if (now - last >= quietMs || now - started >= capMs) {
        observer.disconnect();
        resolve(now - last >= quietMs);
        return;
      }
      setTimeout(check, 100);
    };
    setTimeout(check, 100);
  });
}

export function readProbe() {
  const state = (
    window as unknown as {
      __bench: {
        longTasks: Array<number>;
        loafBlocking: Array<number>;
        frames: Array<number>;
        keyLatencies: Array<number>;
        eventDurations: Array<number>;
        running: boolean;
      };
    }
  ).__bench;
  state.running = false;
  return {
    longTasks: state.longTasks,
    loafBlocking: state.loafBlocking,
    frames: state.frames,
    keyLatencies: state.keyLatencies,
    eventDurations: state.eventDurations,
    domNodes: document.getElementsByTagName("*").length,
  };
}
