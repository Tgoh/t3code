const CAPACITY = 600;
const SCROLL_GAP_MS = 40;

let recording = false;
const times = new Float64Array(CAPACITY);
const lines: string[] = Array.from({ length: CAPACITY }, () => "");
let next = 0;
let count = 0;
let lastScrollAt = -Infinity;
let skippedScrolls = 0;

function push(text: string) {
  times[next] = performance.now();
  lines[next] = text;
  next = (next + 1) % CAPACITY;
  count = Math.min(count + 1, CAPACITY);
}

/** Recording runs only while the layout debug overlay is open, so the timeline pays nothing otherwise. */
export function setTraceRecording(on: boolean) {
  recording = on;
}

export function isTracing(): boolean {
  return recording;
}

export function trace(text: string) {
  if (recording) push(text);
}

/** A distance from the end as `end+120`, or `end-30` for an overscroll past it. */
export function endText(fromEnd: number): string {
  const distance = Math.round(fromEnd);
  return `end${distance < 0 ? "" : "+"}${distance}`;
}

/** Scroll events come every frame, so they're kept at most one per `SCROLL_GAP_MS`, with a count of the dropped ones. */
export function traceScroll(fromEnd: number, height: number) {
  if (!recording) return;
  const now = performance.now();
  if (now - lastScrollAt < SCROLL_GAP_MS) {
    skippedScrolls += 1;
    return;
  }
  lastScrollAt = now;
  push(
    `scroll ${endText(fromEnd)}/${Math.round(height)}${skippedScrolls > 0 ? ` +${skippedScrolls}` : ""}`,
  );
  skippedScrolls = 0;
}

export function clearTrace() {
  next = 0;
  count = 0;
  skippedScrolls = 0;
  lastScrollAt = -Infinity;
}

export function traceText(): string {
  const start = (next - count + CAPACITY) % CAPACITY;
  const origin = times[start] ?? 0;
  const out = [`trace ${count} ${navigator.userAgent}`];
  for (let index = 0; index < count; index += 1) {
    const at = (start + index) % CAPACITY;
    out.push(`${Math.round(times[at]! - origin)} ${lines[at]}`);
  }
  return out.join("\n");
}
