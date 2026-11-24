# Working on the treflex client

Read [README.md](./README.md) first. It covers the state model, which logic follows stock, and how to run a test client beside the daily driver.

- **Never edit the main checkout** (`G:\Sorted\Code\t3code`): the daily driver runs from it. Work in your own worktree. T3 installs it in the background: while `.t3/setup-running` exists, wait for `.t3/setup-done` or `.t3/setup-failed` with a Monitor, and never delete the marker or start a second install. Only with no `.t3` marker at all, run `node scripts/setup-worktree.ts` from the worktree root with `T3CODE_PROJECT_ROOT=G:/Sorted/Code/t3code`, in the background.
- **Search the big files, never read them whole.** `src/Model.test.ts` (about 300 KB), [docs/stock-logic.md](./docs/stock-logic.md) (about 150 KB) and [docs/issues.md](./docs/issues.md) stay in your context for every later call once read. `grep -n` for the test, row or heading, then Read that range. Put a new feature's tests in that feature's own test file.
- **Solid 2 traps that got past review.** A read after a write in the same handler sees the old value, in signals, memos and the DOM alike, until the flush: pass the new value along, or call `flush()` before reading. `onCleanup` throws inside a ref callback, `onSettled` and `createTrackedEffect`: give a ref its teardown through `ui/cleanupRef.ts`. An effect that writes a signal its own compute reads is a derived value: use `createSignal((prev) => …)` or a memo. Lint catches the last two (`t3code/no-cleanup-in-ref`, `t3code/no-effect-writes-own-source`), not the first.
- **iPhone-only behaviour needs Tam's phone.** Desktop Chromium at phone width doesn't reproduce iOS touch scrolling, momentum, the bounce at the ends, the keyboard or `visualViewport`. Any change to scroll, touch, focus or keyboard handling, a review's fix included, goes back to Tam before it merges: say what to try, and ask for a **Layout debug** trace (see the README's "Making changes").
- **Prove logic with tests, and look with the preview.** A behaviour check belongs in a test (`*.test.ts`, or `*.test.tsx` in jsdom), which runs again in every later review. Use the preview tools for screenshots and layout. In `preview_evaluate`, wrap the code in an async IIFE (a top-level `const` survives into the next call and fails as "already declared"), guard lookups with `?.` and return what's missing rather than throwing, and keep each call under its 15-second limit: wait with `preview_wait_for`, not `setTimeout`, and don't reload or navigate inside an evaluate. After a navigation, take a fresh snapshot before using its refs. Python here has no PIL, so look at screenshots with Read rather than diffing them in a script.
- **Keep [docs/todo.md](./docs/todo.md) true on `treflex-main` at all times.** It lists everything in the pipeline, in order.
  - When you queue new work or Tam asks for something, add it in the same turn.
  - Don't mark items **In progress**: the T3 thread list shows what's running, and the marks were 18% of the client's commits and the cause of most merge conflicts.
  - When the work merges, its own branch removes the item, or trims it to what's left.
  - When a plan changes or a dependency ships, fix the item.
- **Record stock bugs.** Add each bug you find in stock (`apps/web`, `packages/client-runtime` or the server) to [docs/stock-bugs.md](./docs/stock-bugs.md), even when it's off your task. Say where it is, what goes wrong, whether you reproduced it, and whether treflex shares it.
- **Components don't start main-state work.** Never dispatch into main state from `onSettled`, `createEffect` or `onCleanup`. Start the action from the event behind it, through a handler or a receiver. A component may start work on state it owns, in `useComponentState` or `createComponentFeature`. Work a component kicks off is usually work main state shouldn't hold.
- **Main state or component state:** would a restore from a snapshot bring it back? Judge by what causes the work, not where it's stored now. An open thread, an expanded row, a selected view or a draft would be restored, so whatever they fetch or subscribe to belongs in main state, started by the action that sets them. An open palette, a rendered row or a menu at the caret wouldn't, so their data belongs in component state, even when several components share it. Signed media URLs are an example.
- **Test threads go in the Test project** (`G:\Sorted\Test`), or in a project rooted at a git repo inside it, such as `G:\Sorted\Test\details-git-demo`, when a check needs diffs or checkpoints: `G:\Sorted\Test` itself isn't a repo. Viewing threads in other projects is fine; creating threads or sending turns there is not.
- **Hand back with screenshots.** When user-visible work is done, open your test client with the T3 preview tools (`preview_open` on your port, `preview_snapshot` with `save=true`) and capture what changed, beside stock web (port 5733, same server) in the same state when the work is parity with stock. Close the tabs you opened. Save the images under `G:\Sorted\Code\t3code-dev-home\screenshots\<your branch>\`, then send a short summary to the thread that launched you, whose id is in your task: what changed, branch and commit, the test URL, and each image's absolute path. Send it with `t3_thread_send` and `mode: "queue"`, never `t3_thread_send_attachments`, which can't queue: a message that arrives mid-turn cuts that thread's reply off. With no launching thread, embed the images in your final reply.
- **Merge only when Tam approves.** Then merge `treflex-main` into your branch, resolve conflicts keeping both sides' behaviour, and rerun `vp run typecheck`, `vp lint`, `vp test run` and `vp build` from `apps/treflex-web`. Fast-forward the main checkout, the one write allowed there, and push:

  ```bash
  cd /g/Sorted/Code/t3code && git status --porcelain && git merge --ff-only <your branch> && git push origin treflex-main
  ```

  If the main checkout isn't clean, stop and report. If the fast-forward fails, `treflex-main` moved: merge it into your branch again, recheck, and retry.

  The driver serves a build, so nothing changes for Tam until it's rebuilt. Rebuild and restart only the driver's client, which keeps the server and its running turns up. If the merge changed `pnpm-lock.yaml` or any `package.json`, install first with `vp i -- --yes` in the main checkout:

  ```bash
  cd /g/Sorted/Code/t3code && chcp.com 65001 >/dev/null; pwsh -NoProfile -File ./dev-stack.ps1 -Restart -Only treflex
  ```

  The merge isn't done until that exits 0 and prints `treflex: serving the build in …`. A failed build exits 1 and leaves the old build serving, with its output in `G:\Sorted\Code\t3code-dev-home\dev-stack\treflex-build.log`. A missing module there means the install was skipped: run `vp i -- --yes` and restart again. A code error means `treflex-main` is broken: fix it on your branch, recheck, fast-forward, and restart again. Never leave `treflex-main` ahead of what 5734 serves without telling Tam.

  Then stop your test client by the task you started it with, and settle your own thread with `t3_thread_organize` (`action: "settle"`, no `threadId`).
