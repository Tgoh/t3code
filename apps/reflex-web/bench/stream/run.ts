// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- A Node script that drives Chrome, outside any Effect runtime.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { chromium, type BrowserContext, type CDPSession, type Page } from "playwright-core";

import { installProbe, readProbe, scrollTimeline, waitForQuiet } from "./probe.ts";
import { summarize } from "./summarize.ts";
import { defaultBaseDir, pairingCredential, sendTurn, startReplayThread } from "./t3.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    "base-dir": { type: "string", default: defaultBaseDir },
    project: { type: "string", default: "G:/Sorted/Test" },
    stock: { type: "string", default: "http://localhost:5791" },
    reflex: { type: "string", default: "http://localhost:5792" },
    runs: { type: "string", default: "5" },
    scenarios: { type: "string", default: "short,long" },
    throttles: { type: "string", default: "1,4" },
    headed: { type: "boolean", default: false },
    typing: { type: "boolean", default: true },
  },
  allowNegative: true,
});
const baseDir = values["base-dir"];
const resultsDir = NodePath.join(import.meta.dirname, "results");
const longThread = () =>
  (
    JSON.parse(NodeFS.readFileSync(NodePath.join(resultsDir, "long-thread.json"), "utf8")) as {
      threadId: string;
    }
  ).threadId;
const environmentId = NodeFS.readFileSync(
  NodePath.join(baseDir, "userdata", "environment-id"),
  "utf8",
).trim();

export type ClientName = "stock" | "reflex";
export type Scenario = "short" | "long";

export interface RunResult {
  client: ClientName;
  scenario: Scenario;
  throttle: number;
  run: number;
  loadMs: number;
  historyPages: number;
  historyMs: number;
  windowMs: number;
  settled: boolean;
  scriptMs: number;
  layoutMs: number;
  styleMs: number;
  taskMs: number;
  longTaskCount: number;
  longTaskMs: number;
  loafCount: number;
  loafBlockingMs: number;
  frames: number;
  droppedFrames: number;
  frameP95Ms: number;
  keys: number;
  keyP50Ms: number;
  keyP95Ms: number;
  keyMaxMs: number;
  inpMs: number;
  heapBeforeMb: number;
  heapAfterMb: number;
  domNodes: number;
}

// The display's refresh interval, which headless Chrome follows (about 7 ms on a 144 Hz screen).
const frameMs = (frames: ReadonlyArray<number>) => Math.max(percentile(frames, 50), 1);
const TYPED = "the quick brown fox jumps over the lazy dog ";

function threadUrl(client: ClientName, threadId: string): string {
  return client === "stock"
    ? `${values.stock}/${environmentId}/${encodeURIComponent(threadId)}`
    : `${values.reflex}/?thread=${encodeURIComponent(threadId)}`;
}

const composerSelector = (client: ClientName) =>
  client === "stock" ? "div.composer-tiptap[contenteditable='true']" : "textarea";

async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics: list } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(list.map((metric) => [metric.name, metric.value]));
}

async function heapMb(cdp: CDPSession): Promise<number> {
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  return usedSize / 1024 / 1024;
}

const percentile = (values: ReadonlyArray<number>, p: number) => {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
};
const sum = (values: ReadonlyArray<number>) => values.reduce((total, value) => total + value, 0);

async function typeWhile(page: Page, done: () => boolean): Promise<number> {
  let typed = 0;
  while (!done()) {
    if (values.typing) {
      await page.keyboard.type(TYPED[typed % TYPED.length]!);
      typed++;
    }
    await page.waitForTimeout(200);
  }
  return typed;
}

/** Pages in the whole thread with each client's own "Load earlier" control, then returns to the bottom. */
async function loadAllHistory(page: Page): Promise<number> {
  const button = page.getByRole("button", { name: /^Load earlier/ });
  // Reflex keeps paging after one click until it reaches a user-authored turn.
  const loading = page.getByRole("button", { name: /^Loading/ });
  let pages = 0;
  for (let misses = 0; misses < 3;) {
    await page.evaluate(scrollTimeline, true);
    await page.waitForTimeout(300);
    if ((await loading.count()) > 0) continue;
    if ((await button.count()) === 0) {
      misses++;
      continue;
    }
    misses = 0;
    await button.first().click();
    pages++;
    await page.evaluate(waitForQuiet, { quietMs: 500, capMs: 30_000 });
  }
  await page.evaluate(scrollTimeline, false);
  await page.evaluate(waitForQuiet, { quietMs: 1500, capMs: 60_000 });
  await page.evaluate(scrollTimeline, false);
  return pages;
}

async function measure(
  context: BrowserContext,
  client: ClientName,
  scenario: Scenario,
  throttle: number,
  run: number,
): Promise<RunResult> {
  const threadId =
    scenario === "long"
      ? longThread()
      : startReplayThread(baseDir, values.project, `bench short ${client} ${throttle}x #${run}`);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  // Wall-clock ticks: thread ticks leave out the time CPU throttling suspends the main thread.
  await cdp.send("Performance.enable", { timeDomain: "timeTicks" });

  const loadStart = Date.now();
  await page.goto(threadUrl(client, threadId));
  await page.locator(composerSelector(client)).waitFor({ timeout: 120_000 });
  await page.getByText("This turn is a replay.").last().waitFor({ timeout: 120_000 });
  await page.evaluate(waitForQuiet, { quietMs: 1500, capMs: 60_000 });
  const loadMs = Date.now() - loadStart;
  const historyStart = Date.now();
  const historyPages = scenario === "long" ? await loadAllHistory(page) : 0;
  const historyMs = Date.now() - historyStart;

  await page.locator(composerSelector(client)).click();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  const heapBefore = await heapMb(cdp);
  await page.evaluate(installProbe);
  const before = await metrics(cdp);
  const windowStart = Date.now();

  let finished = false;
  const turn = sendTurn(baseDir, threadId).finally(() => {
    finished = true;
  });
  const [keys] = await Promise.all([typeWhile(page, () => finished), turn]);
  const settled = await page.evaluate(waitForQuiet, { quietMs: 1000, capMs: 30_000 });
  const windowMs = Date.now() - windowStart;

  const after = await metrics(cdp);
  const probe = await page.evaluate(readProbe);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const heapAfter = await heapMb(cdp);
  await page.close();

  const delta = (name: string) => ((after[name] ?? 0) - (before[name] ?? 0)) * 1000;
  return {
    client,
    scenario,
    throttle,
    run,
    loadMs,
    historyPages,
    historyMs,
    windowMs,
    settled,
    scriptMs: delta("ScriptDuration"),
    layoutMs: delta("LayoutDuration"),
    styleMs: delta("RecalcStyleDuration"),
    taskMs: delta("TaskDuration"),
    longTaskCount: probe.longTasks.length,
    longTaskMs: sum(probe.longTasks),
    loafCount: probe.loafBlocking.length,
    loafBlockingMs: sum(probe.loafBlocking),
    frames: probe.frames.length,
    droppedFrames: sum(
      probe.frames.map((ms) => Math.max(0, Math.round(ms / frameMs(probe.frames)) - 1)),
    ),
    frameP95Ms: percentile(probe.frames, 95),
    keys,
    keyP50Ms: percentile(probe.keyLatencies, 50),
    keyP95Ms: percentile(probe.keyLatencies, 95),
    keyMaxMs: Math.max(0, ...probe.keyLatencies),
    inpMs: Math.max(0, ...probe.eventDurations),
    heapBeforeMb: heapBefore,
    heapAfterMb: heapAfter,
    domNodes: probe.domNodes,
  };
}

async function main() {
  const runs = Number(values.runs);
  const scenarios = values.scenarios.split(",") as Array<Scenario>;
  const throttles = values.throttles.split(",").map(Number);
  const browser = await chromium.launch({ channel: "chrome", headless: !values.headed });
  const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
  const out = NodePath.join(resultsDir, `run-${stamp}.json`);
  const results: Array<RunResult> = [];
  NodeFS.mkdirSync(resultsDir, { recursive: true });
  try {
    for (let run = 1; run <= runs; run++) {
      for (const scenario of scenarios) {
        for (const throttle of throttles) {
          const order: Array<ClientName> =
            run % 2 === 1 ? ["stock", "reflex"] : ["reflex", "stock"];
          for (const client of order) {
            // A fresh context per run: no cache, storage or drafts carry over.
            const context = await browser.newContext({
              viewport: { width: 1400, height: 900 },
              serviceWorkers: "block",
            });
            const paired = await context.request.post(`${values.stock}/api/auth/browser-session`, {
              data: { credential: pairingCredential(baseDir) },
            });
            if (!paired.ok()) throw new Error(`Pairing failed: HTTP ${paired.status()}`);
            try {
              const result = await measure(context, client, scenario, throttle, run);
              results.push(result);
              NodeFS.writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
              console.log(
                `run ${run} ${scenario} ${throttle}x ${client}: script ${result.scriptMs.toFixed(0)} ms, layout ${result.layoutMs.toFixed(0)} ms, long tasks ${result.longTaskCount}/${result.longTaskMs.toFixed(0)} ms, dropped ${result.droppedFrames}, key p95 ${result.keyP95Ms.toFixed(1)} ms${result.settled ? "" : " (not settled)"}`,
              );
            } finally {
              await context.close();
            }
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`wrote ${out}`);
  console.log(summarize(results));
}

await main();
