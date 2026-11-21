# Working on the reflex client

Read [README.md](./README.md) first. It covers the state model, the logic copied from stock, and how to run a test client beside the daily driver.

- **Never edit the main checkout** (`G:\Sorted\Code\t3code`): the daily driver runs from it. Work in your own worktree. If it has no `.t3/setup-done`, run `node scripts/setup-worktree.ts` from its root with `T3CODE_PROJECT_ROOT=G:/Sorted/Code/t3code`, which installs.
- **Record stock bugs.** Add each bug you find in stock (`apps/web`, `packages/client-runtime` or the server) to [docs/stock-bugs.md](./docs/stock-bugs.md), even when it's off your task. Say where it is, what goes wrong, whether you reproduced it, and whether reflex shares it.
- **Test threads go in the Test project** (`G:\Sorted\Test`). Viewing threads in other projects is fine; creating threads or sending turns there is not.
- **Hand back with screenshots.** When user-visible work is done, open your test client with the T3 preview tools (`preview_open` on your port, `preview_snapshot` with `save=true`) and capture what changed, beside stock web (port 5733, same server) in the same state when the work is parity with stock. Close the tabs you opened. Save the images under `G:\Sorted\Code\t3code-dev-home\screenshots\<your branch>\`, then send a short summary to the thread that launched you, whose id is in your task: what changed, branch and commit, the test URL, and each image's absolute path. Send it with `t3_thread_send` and `mode: "queue"`, never `t3_thread_send_attachments`, which can't queue: a message that arrives mid-turn cuts that thread's reply off. With no launching thread, embed the images in your final reply.
- **Merge only when Tam approves.** Then merge `reflex-main` into your branch, resolve conflicts keeping both sides' behaviour, and rerun `vp run typecheck`, `vp lint`, `vp test run` and `vp build` from `apps/reflex-web`. Fast-forward the main checkout, the one write allowed there, and push:

  ```bash
  cd /g/Sorted/Code/t3code && git status --porcelain && git merge --ff-only <your branch> && git push origin reflex-main
  ```

  If the main checkout isn't clean, stop and report. If the fast-forward fails, `reflex-main` moved: merge it into your branch again, recheck, and retry.

  The driver serves a build, so nothing changes for Tam until it's rebuilt. Rebuild and restart only the driver's client, which keeps the server and its running turns up. If the merge changed `pnpm-lock.yaml` or any `package.json`, install first with `vp i -- --yes` in the main checkout:

  ```bash
  cd /g/Sorted/Code/t3code && chcp.com 65001 >/dev/null; pwsh -NoProfile -File ./dev-stack.ps1 -Restart -Only reflex
  ```

  The merge isn't done until that exits 0 and prints `reflex: serving the build in …`. A failed build exits 1 and leaves the old build serving, with its output in `G:\Sorted\Code\t3code-dev-home\dev-stack\reflex-build.log`. A missing module there means the install was skipped: run `vp i -- --yes` and restart again. A code error means `reflex-main` is broken: fix it on your branch, recheck, fast-forward, and restart again. Never leave `reflex-main` ahead of what 5734 serves without telling Tam.

  Then stop your test client by the task you started it with, and settle your own thread with `t3_thread_organize` (`action: "settle"`, no `threadId`).
