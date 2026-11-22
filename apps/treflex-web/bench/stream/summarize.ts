// @effect-diagnostics nodeBuiltinImport:off -- A Node script, outside any Effect runtime.
import * as NodeFS from "node:fs";

import type { RunResult } from "./run.ts";

const METRICS: ReadonlyArray<[keyof RunResult, string, number]> = [
  ["scriptMs", "Scripting (ms)", 0],
  ["layoutMs", "Layout (ms)", 0],
  ["styleMs", "Style recalc (ms)", 0],
  ["taskMs", "All main-thread tasks (ms)", 0],
  ["longTaskCount", "Long tasks (count)", 0],
  ["longTaskMs", "Long tasks (total ms)", 0],
  ["loafBlockingMs", "Long-frame blocking (ms)", 0],
  ["droppedFrames", "Dropped frames", 0],
  ["frameP95Ms", "Frame interval p95 (ms)", 1],
  ["keyP50Ms", "Key to frame p50 (ms)", 1],
  ["keyP95Ms", "Key to frame p95 (ms)", 1],
  ["keyMaxMs", "Key to frame max (ms)", 1],
  ["heapBeforeMb", "JS heap before (MB)", 1],
  ["heapAfterMb", "JS heap after (MB)", 1],
  ["domNodes", "DOM nodes after", 0],
  ["loadMs", "Load to quiet (ms)", 0],
  ["historyPages", "History pages loaded", 0],
  ["historyMs", "Paging in all history (ms)", 0],
  ["windowMs", "Measured window (ms)", 0],
];

const median = (values: ReadonlyArray<number>) => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

const cell = (values: ReadonlyArray<number>, digits: number) =>
  values.length === 0
    ? "-"
    : `${median(values).toFixed(digits)} (${Math.min(...values).toFixed(digits)}–${Math.max(...values).toFixed(digits)})`;

/** Ranges overlapping means the two clients' runs interleave, so the gap is inside the noise. */
function reading(stock: ReadonlyArray<number>, treflex: ReadonlyArray<number>): string {
  const [s, r] = [median(stock), median(treflex)];
  if (s === 0 && r === 0) return "both 0";
  const overlap =
    Math.max(...stock) >= Math.min(...treflex) && Math.max(...treflex) >= Math.min(...stock);
  const ratio = s === 0 || r === 0 ? "" : ` ${(Math.max(s, r) / Math.min(s, r)).toFixed(2)}×`;
  const lower = r < s ? "treflex" : r > s ? "stock" : "equal";
  return `${lower} lower${ratio}${overlap ? ", ranges overlap" : ""}`;
}

export function summarize(results: ReadonlyArray<RunResult>): string {
  const groups = new Map<string, Array<RunResult>>();
  for (const result of results) {
    const key = `${result.scenario} thread, ${result.throttle === 1 ? "no throttling" : `${result.throttle}× CPU throttle`}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  const sections: Array<string> = [];
  for (const [title, group] of groups) {
    const of = (client: string, metric: keyof RunResult) =>
      group.filter((result) => result.client === client).map((result) => Number(result[metric]));
    const runs = of("stock", "run").length;
    const lines = [
      `### ${title} (${runs} runs each; median, min–max)`,
      "",
      "| Metric | Stock | Treflex | Lower |",
      "| --- | --- | --- | --- |",
      ...METRICS.map(
        ([metric, label, digits]) =>
          `| ${label} | ${cell(of("stock", metric), digits)} | ${cell(of("treflex", metric), digits)} | ${reading(of("stock", metric), of("treflex", metric))} |`,
      ),
    ];
    sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}

if (import.meta.main) {
  const files = process.argv.slice(2);
  const results = files.flatMap(
    (file) => JSON.parse(NodeFS.readFileSync(file, "utf8")) as Array<RunResult>,
  );
  console.log(summarize(results));
}
