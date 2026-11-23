// @effect-diagnostics globalTimers:off -- The pool's idle shutdown, a view resource outside any Effect runtime.
import { WorkerPoolManager } from "@pierre/diffs/worker";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";

import { THEME_NAMES } from "./codeHighlighter";

// Follows apps/web/src/components/DiffWorkerPoolProvider.tsx: one pool for every open diff view,
// ended 30 seconds after the last one closes.

type IScheme = keyof typeof THEME_NAMES;

const IDLE_TTL_MS = 30_000;

function poolSize(): number {
  const cores = Math.max(1, navigator.hardwareConcurrency || 4);
  return Math.max(2, Math.min(6, Math.floor(cores / 2)));
}

let shared:
  | { pool: WorkerPoolManager; consumers: number; idle: ReturnType<typeof setTimeout> | undefined }
  | undefined;

function createPool(scheme: IScheme): WorkerPoolManager {
  return new WorkerPoolManager(
    { workerFactory: () => new DiffsWorker(), poolSize: poolSize(), totalASTLRUCacheSize: 240 },
    {
      theme: THEME_NAMES[scheme],
      preferredHighlighter: "highlights",
      tokenizeMaxLineLength: 1_000,
      useTokenTransformer: true,
    },
  );
}

/** Takes the shared pool, made in `scheme`; `release` lets it go. */
export function acquireDiffWorkers(scheme: IScheme): {
  pool: WorkerPoolManager;
  release: () => void;
} {
  const entry = (shared ??= { pool: createPool(scheme), consumers: 0, idle: undefined });
  clearTimeout(entry.idle);
  entry.idle = undefined;
  entry.consumers += 1;
  let released = false;
  return {
    pool: entry.pool,
    release: () => {
      if (released) return;
      released = true;
      entry.consumers -= 1;
      if (entry.consumers !== 0) return;
      entry.idle = setTimeout(() => {
        entry.pool.terminate();
        if (shared === entry) shared = undefined;
      }, IDLE_TTL_MS);
    },
  };
}

/** Moves the pool to the scheme the page now shows. */
export async function followScheme(pool: WorkerPoolManager, scheme: IScheme): Promise<void> {
  const current = pool.getDiffRenderOptions();
  if (current.theme === THEME_NAMES[scheme]) return;
  await pool.setRenderOptions({ ...current, theme: THEME_NAMES[scheme] });
}
