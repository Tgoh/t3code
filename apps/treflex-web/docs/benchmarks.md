# Benchmarks: a streaming turn, treflex against stock

Measured 2026-11-22 on branch `reflex/stream-bench` (based on `44fe103bf4`). The script is in [`bench/stream`](../bench/stream/README.md), and the raw runs are [`bench/stream/data/2026-11-22-typing.json`](../bench/stream/data/2026-11-22-typing.json) and [`2026-11-22-no-typing.json`](../bench/stream/data/2026-11-22-no-typing.json).

## Reading

Treflex is faster on every measure that tracks the stream itself, in both scenarios and at both CPU speeds, and well outside the noise. Each client's range of runs sits apart from the other's except where a row says otherwise.

- **Main-thread work while a turn streams.** Stock spends 3.9–4.7× treflex's scripting time and 2.5–3.4× its total main-thread time. Style recalculation is the widest gap on a short thread (18–20×).
- **Smoothness.** At 4× throttle on a short thread stock drops 264 frames against treflex's 17, and runs 7 long tasks (555 ms) against 1 (59 ms). On the long thread at 4× stock runs 30 long tasks (3.0 s) against treflex's 1 (0.86 s).
- **Typing during the stream.** At 4× throttle, the p95 from keydown to the next frame is 237 ms on stock against 16 ms on treflex (short thread), and 774 ms against 58 ms (long thread). Unthrottled, both are under 40 ms p95, with treflex about 2.7× lower.
- **The gap isn't the composer.** Stock's composer is ProseMirror and treflex's is a textarea. With no typing, stock's scripting is still 3.4–3.9× treflex's, so the stream drives the difference.

Where stock wins:

- **Memory with a whole long thread paged in.** Stock virtualizes its timeline and holds 60 MB of JS heap. Treflex renders every loaded row (about 32,700 DOM nodes) and holds 162 MB until the next turn starts.
- **The first frame of a turn on a long thread.** When a turn starts, treflex collapses its render window back to the tail, removing ~31,000 nodes in one task: 184 ms unthrottled and about 860 ms at 4×. That single task is why treflex's long-task total, long-frame blocking and worst keystroke are higher than stock's on the unthrottled long thread, and why its worst keystroke at 4× (747 ms) is close to stock's (898 ms; the ranges overlap). Afterwards its heap drops to 50 MB, below stock's 64 MB.

Inside the noise: page load to a quiet DOM (2.8–3.0 s for both, ranges overlap on the short thread), and frame interval p95 unthrottled (both 7.1 ms, which is the display's refresh interval).

Paging in the whole long thread took stock 41 s (39 clicks of 75 items) and treflex 7.8 s, but that isn't like for like: treflex's "Load earlier" keeps paging until it reaches a user-authored turn, and these turns were sent from the CLI, so one click loaded everything.

## Setup

- **Machine:** Tam's Windows 11 desktop, 16 logical cores, busy with its usual work; nothing was paused. Chrome 157.0.8103.79, headless, driven over CDP by Playwright (`playwright-core` 1.64.1), viewport 1400×900. Headless Chrome paints at the display's refresh rate here, about 140 Hz (7.1 ms frames).
- **Server:** this worktree's server from source, run from `apps/server` as `node src/bin.ts serve --base-dir ../../.t3 --port 16628 --dev-url http://localhost:5791/`, on its own state in the worktree's `.t3`. The dev URL makes the server register the `Replay (dev)` provider. It ran without `node --watch`: the watcher restarted the server mid-run (see `issues.md`, "reading `packages/` restarts the dev server"), and that run was thrown away.
- **Clients:** production builds of both (`vp build` in `apps/web` and `apps/treflex-web`, no `VITE_HTTP_URL` or `VITE_WS_URL`), each served by `vp preview` proxying `/api`, `/ws` and the other server paths to 16628: stock on 5791, treflex on 5792. Same server, same database, same origin host.
- **Turns:** Replay's `showcase` scenario: a thought, a three-step plan updated four times, a read, an edit with a diff, a command with output, and a markdown reply with a code block and a table. About 7.5 s per turn, 10 turn items. Each measured turn is sent with `t3 thread send` from the CLI, not from the composer, so both clients receive the identical stream and the send path isn't measured.
- **Scenarios:**
  - _Short:_ a new thread per run with one finished showcase turn, then the measured turn.
  - _Long:_ one thread in the Test project seeded with 300 showcase turns (2,701 turn items). Each run opens it, pages in the whole history with the client's own "Load earlier" control, scrolls back to the bottom, then streams the measured turn. The thread gains a turn per run, about 28 over the benchmark, which the alternation spreads over both clients.
- **Each run:** a fresh browser context (no cache, storage or drafts), paired with a new one-time credential, service workers blocked (treflex registers one in production; stock doesn't). After the page goes quiet, the composer is focused, the CPU throttle is applied, garbage is collected and the heap read, and the probes start. The turn is sent, and a character is typed into the composer every 200 ms until the server reports the turn finished. The window ends once the DOM has been still for 1 s. Then the probes are read, the throttle removed, garbage collected and the heap read again.
- **Repetition:** 7 runs per client per scenario and throttle, alternating which client goes first each run. The no-typing check is 3 runs each.

### Metrics

| Metric                          | Source                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scripting, layout, style, tasks | CDP `Performance.getMetrics` deltas over the window, in wall-clock ticks, so throttling counts                                                            |
| Long tasks                      | `longtask` entries (over 50 ms): count and total duration                                                                                                 |
| Long-frame blocking             | Total `blockingDuration` of `long-animation-frame` entries                                                                                                |
| Dropped frames                  | From `requestAnimationFrame` intervals: each interval counts the frames it skipped at the run's median interval. Frame interval p95 is from the same data |
| Key to frame                    | Per keydown, from the event's timestamp to the task after the next animation frame: when the keystroke can be on screen                                   |
| JS heap                         | `Runtime.getHeapUsage` after a forced garbage collection                                                                                                  |
| DOM nodes                       | Elements in the document at the end of the window                                                                                                         |

## Not like for like

- **What a running turn shows.** Treflex deliberately folds the running response under "Working for …" and shows only its latest reply, with the plan and current step in one fixed line above the composer (see the README). Stock renders the live work rows, thinking and the plan in the timeline. So during the stream treflex renders less, by design. That is part of what's being compared, not a fault of the setup.
- **Timeline rendering.** Stock virtualizes the timeline (LegendList); treflex renders a window of rows that grows as you scroll up and collapses to the tail when new rows arrive.
- **History paging.** Stock loads 75 items per click; treflex loads pages until it reaches a user-authored turn, which for CLI-sent turns is the whole thread.
- **Composer.** ProseMirror in stock, a textarea in treflex. The no-typing check shows this isn't the source of the gap.
- **Sidebar.** Treflex's sidebar shows a per-second elapsed timer for a working thread; stock's doesn't. Both show the measured thread's own status.

## Results with typing

Medians, with the min–max of the runs in brackets. "Lower" names the client with the lower median and the ratio, and notes when the ranges overlap (inside the noise).

### Short thread, no throttling (7 runs each)

| Metric                     | Stock            | Treflex          | Lower                         |
| -------------------------- | ---------------- | ---------------- | ----------------------------- |
| Scripting (ms)             | 387 (375–416)    | 82 (81–83)       | treflex 4.70×                 |
| Layout (ms)                | 17 (16–19)       | 12 (12–12)       | treflex 1.42×                 |
| Style recalc (ms)          | 91 (88–100)      | 5 (4–5)          | treflex 20.02×                |
| All main-thread tasks (ms) | 877 (840–953)    | 258 (252–278)    | treflex 3.40×                 |
| Long tasks (count)         | 0 (0–0)          | 0 (0–0)          | both 0                        |
| Long tasks (total ms)      | 0 (0–0)          | 0 (0–0)          | both 0                        |
| Long-frame blocking (ms)   | 0 (0–0)          | 0 (0–0)          | both 0                        |
| Dropped frames             | 13 (10–16)       | 0 (0–1)          | treflex                       |
| Frame interval p95 (ms)    | 7.1 (7.1–7.1)    | 7.1 (7.1–7.1)    | equal                         |
| Key to frame p50 (ms)      | 8.8 (8.5–9.3)    | 5.5 (5.2–7.1)    | treflex 1.60×                 |
| Key to frame p95 (ms)      | 21.7 (16.3–41.3) | 8.0 (7.8–8.5)    | treflex 2.71×                 |
| Key to frame max (ms)      | 27.6 (20.9–43.8) | 8.1 (8.0–9.2)    | treflex 3.41×                 |
| JS heap before (MB)        | 48.6 (45.9–50.9) | 21.9 (21.4–22.6) | treflex 2.22×                 |
| JS heap after (MB)         | 53.7 (50.6–56.2) | 23.2 (22.6–23.8) | treflex 2.32×                 |
| DOM nodes after            | 2219 (1816–2564) | 1291 (1126–1489) | treflex 1.72×                 |
| Load to quiet (ms)         | 2812 (2635–3036) | 2792 (2767–2825) | treflex 1.01×, ranges overlap |
| Measured window (ms)       | 7725 (7693–7955) | 7611 (7589–7656) | treflex 1.01×                 |

### Short thread, 4× CPU throttle (7 runs each)

| Metric                     | Stock               | Treflex          | Lower                         |
| -------------------------- | ------------------- | ---------------- | ----------------------------- |
| Scripting (ms)             | 1844 (1767–1894)    | 392 (366–731)    | treflex 4.71×                 |
| Layout (ms)                | 79 (73–82)          | 54 (50–72)       | treflex 1.47×                 |
| Style recalc (ms)          | 365 (354–369)       | 20 (19–30)       | treflex 17.98×                |
| All main-thread tasks (ms) | 3484 (3355–3586)    | 1072 (1024–2290) | treflex 3.25×                 |
| Long tasks (count)         | 7 (6–10)            | 1 (0–1)          | treflex 7.00×                 |
| Long tasks (total ms)      | 555 (501–696)       | 59 (0–67)        | treflex 9.41×                 |
| Long-frame blocking (ms)   | 266 (230–278)       | 12 (0–20)        | treflex 21.98×                |
| Dropped frames             | 264 (248–287)       | 17 (11–63)       | treflex 15.53×                |
| Frame interval p95 (ms)    | 14.0 (14.0–20.5)    | 7.1 (7.1–7.2)    | treflex 1.97×                 |
| Key to frame p50 (ms)      | 31.1 (26.6–35.6)    | 10.1 (9.8–11.2)  | treflex 3.08×                 |
| Key to frame p95 (ms)      | 236.7 (120.5–266.6) | 16.2 (12.8–39.3) | treflex 14.61×                |
| Key to frame max (ms)      | 269.1 (253.8–309.3) | 22.7 (20.5–72.0) | treflex 11.85×                |
| JS heap before (MB)        | 49.1 (46.5–51.3)    | 22.0 (21.5–22.7) | treflex 2.23×                 |
| JS heap after (MB)         | 54.2 (51.5–56.2)    | 23.3 (22.7–24.2) | treflex 2.33×                 |
| DOM nodes after            | 2281 (1878–2626)    | 1321 (1156–1519) | treflex 1.73×                 |
| Load to quiet (ms)         | 2759 (2571–3245)    | 2789 (2766–3070) | stock 1.01×, ranges overlap   |
| Measured window (ms)       | 7948 (7837–8658)    | 7631 (7568–9879) | treflex 1.04×, ranges overlap |

Treflex's worst run here (run 7: 731 ms scripting, 63 dropped frames) is the only one far from its others; a busy-machine spike is the likely cause, and its median and its other six runs are well clear of stock's range.

### Long thread (2,701+ items, all paged in), no throttling (7 runs each)

| Metric                     | Stock               | Treflex             | Lower                         |
| -------------------------- | ------------------- | ------------------- | ----------------------------- |
| Scripting (ms)             | 773 (742–846)       | 201 (193–228)       | treflex 3.85×                 |
| Layout (ms)                | 23 (18–24)          | 14 (14–16)          | treflex 1.63×                 |
| Style recalc (ms)          | 125 (110–148)       | 60 (55–69)          | treflex 2.09×                 |
| All main-thread tasks (ms) | 1448 (1340–1682)    | 518 (508–587)       | treflex 2.79×                 |
| Long tasks (count)         | 1 (1–1)             | 1 (1–1)             | equal                         |
| Long tasks (total ms)      | 65 (62–80)          | 184 (168–208)       | stock 2.83×                   |
| Long-frame blocking (ms)   | 22 (18–37)          | 135 (119–159)       | stock 6.22×                   |
| Dropped frames             | 69 (62–76)          | 25 (23–30)          | treflex 2.76×                 |
| Frame interval p95 (ms)    | 7.1 (7.1–7.1)       | 7.1 (7.1–7.1)       | equal                         |
| Key to frame p50 (ms)      | 9.4 (8.8–9.7)       | 6.6 (6.2–7.2)       | treflex 1.42×                 |
| Key to frame p95 (ms)      | 36.0 (28.0–66.4)    | 13.8 (13.3–18.7)    | treflex 2.61×                 |
| Key to frame max (ms)      | 47.5 (32.6–77.3)    | 97.0 (64.3–214.6)   | stock 2.04×, ranges overlap   |
| JS heap before (MB)        | 60.4 (57.7–63.6)    | 161.7 (156.5–167.8) | stock 2.68×                   |
| JS heap after (MB)         | 63.8 (62.1–67.0)    | 49.7 (48.4–51.3)    | treflex 1.28×                 |
| DOM nodes after            | 2738 (2356–3125)    | 1973 (1790–2156)    | treflex 1.39×                 |
| Load to quiet (ms)         | 3041 (2902–3179)    | 2800 (2760–2896)    | treflex 1.09×                 |
| History pages loaded       | 39 (38–40)          | 1 (1–1)             | not comparable                |
| Paging in all history (ms) | 41019 (40017–43631) | 7812 (7517–8333)    | not comparable                |
| Measured window (ms)       | 9822 (8569–9910)    | 8535 (8482–8738)    | treflex 1.15×, ranges overlap |

### Long thread, 4× CPU throttle (7 runs each)

| Metric                     | Stock                | Treflex             | Lower                         |
| -------------------------- | -------------------- | ------------------- | ----------------------------- |
| Scripting (ms)             | 3516 (3377–5210)     | 888 (867–1043)      | treflex 3.96×                 |
| Layout (ms)                | 84 (78–123)          | 58 (57–64)          | treflex 1.44×                 |
| Style recalc (ms)          | 393 (357–473)        | 311 (294–378)       | treflex 1.26×, ranges overlap |
| All main-thread tasks (ms) | 5499 (5217–7372)     | 2186 (2154–2490)    | treflex 2.52×                 |
| Long tasks (count)         | 30 (30–35)           | 1 (1–1)             | treflex 30.00×                |
| Long tasks (total ms)      | 3006 (2849–5025)     | 863 (817–1000)      | treflex 3.48×                 |
| Long-frame blocking (ms)   | 1701 (1512–3560)     | 817 (771–955)       | treflex 2.08×                 |
| Dropped frames             | 602 (570–949)        | 168 (161–192)       | treflex 3.58×                 |
| Frame interval p95 (ms)    | 27.9 (21.1–151.2)    | 7.1 (7.1–7.1)       | treflex 3.93×                 |
| Key to frame p50 (ms)      | 55.4 (40.3–486.4)    | 10.3 (9.9–10.6)     | treflex 5.38×                 |
| Key to frame p95 (ms)      | 773.9 (676.0–1861.4) | 57.8 (51.9–60.5)    | treflex 13.39×                |
| Key to frame max (ms)      | 897.8 (795.1–2053.6) | 747.4 (654.6–989.9) | treflex 1.20×, ranges overlap |
| JS heap before (MB)        | 60.5 (57.8–63.6)     | 162.8 (157.4–168.6) | stock 2.69×                   |
| JS heap after (MB)         | 64.0 (61.1–67.0)     | 50.1 (48.9–51.4)    | treflex 1.28×                 |
| DOM nodes after            | 2747 (2358–3134)     | 1973 (1790–2156)    | treflex 1.39×                 |
| Load to quiet (ms)         | 2918 (2898–3229)     | 2802 (2767–2897)    | treflex 1.04×                 |
| History pages loaded       | 39 (38–41)           | 1 (1–1)             | not comparable                |
| Paging in all history (ms) | 41058 (39913–43181)  | 7852 (7596–8107)    | not comparable                |
| Measured window (ms)       | 8748 (8580–9697)     | 8602 (8564–8885)    | treflex 1.02×, ranges overlap |

Stock's run 6 here (5.2 s scripting, 949 dropped frames, 1.9 s key p95) is its outlier; the median sits with its other six runs.

## Results without typing

Three runs each with `--no-typing`, to separate the stream from the composer.

| Scenario           | Scripting, stock | Scripting, treflex | Main-thread tasks, stock | Main-thread tasks, treflex | Dropped frames, stock | Dropped frames, treflex |
| ------------------ | ---------------- | ------------------ | ------------------------ | -------------------------- | --------------------- | ----------------------- |
| Short, no throttle | 271 (263–323)    | 69 (68–70)         | 738 (717–911)            | 197 (185–217)              | 15 (11–34)            | 0 (0–0)                 |
| Short, 4×          | 1316 (1235–5216) | 340 (300–350)      | 2798 (2636–8984)         | 863 (741–957)              | 205 (195–1054)        | 19 (14–20)              |
| Long, no throttle  | 635 (631–701)    | 187 (182–206)      | 1194 (1117–1342)         | 422 (405–446)              | 68 (68–82)            | 27 (26–28)              |
| Long, 4×           | 3016 (2930–3059) | 877 (855–908)      | 4557 (4539–4644)         | 1766 (1761–1802)           | 517 (496–518)         | 149 (147–151)           |

Typing adds about 100–530 ms of scripting to stock and about 10–50 ms to treflex. Without it, stock's scripting is still 3.4–3.9× treflex's.
