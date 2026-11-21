# Streaming benchmark

Measures the reflex client and stock `apps/web` in Chrome while a Replay turn streams. Results and how to read them are in [docs/benchmarks.md](../../docs/benchmarks.md).

Run from the worktree root unless a step says otherwise, with no `VITE_HTTP_URL` or `VITE_WS_URL` set.

1. Build both clients: `vp build` in `apps/web` and in `apps/reflex-web`.
2. Start a server for this worktree, from `apps/server`: `node src/bin.ts serve --base-dir ../../.t3 --port 16628 --dev-url http://localhost:5791/`. The dev URL is what registers the `Replay (dev)` provider. Don't use `vp run dev:server`: its `node --watch` restarts the server whenever something lists a directory under `src` on Windows (see `docs/issues.md`), which kills the turn being measured.
3. Serve each build with `vp preview`, proxying to that server: in `apps/web`, `T3CODE_PORT=16628 vp preview --port 5791 --strictPort`; in `apps/reflex-web`, the same with `--port 5792`.
4. Add the Test project if the server doesn't have it: `node src/bin.ts project add --base-dir ../../.t3 G:/Sorted/Test` from `apps/server`.
5. From `apps/reflex-web`, seed the long thread once: `node bench/stream/seed.ts`. It runs 300 showcase turns (about 3,000 turn items, 40 minutes) and writes the thread id to `bench/stream/results/long-thread.json`.
6. Run the benchmark: `node bench/stream/run.ts --runs 7`. It prints a line per run and the summary tables, and writes every run to `bench/stream/results/run-<time>.json`. `node bench/stream/summarize.ts <file>…` reprints the tables.

Options: `--scenarios short,long`, `--throttles 1,4`, `--no-typing` to stream without typing into the composer, `--headed`, `--stock`/`--reflex` for other origins, `--base-dir` for another T3 home.

Nothing else may stream on that server during a run: a working thread changes what both clients render.
