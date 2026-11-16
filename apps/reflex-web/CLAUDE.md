# Working on the reflex client

Read [README.md](./README.md) first. It covers the state model, the logic copied from stock, and how to run a test client beside the daily driver.

- **Never edit the main checkout** (`G:\Sorted\Code\t3code`): the daily driver runs from it. Work in your own worktree. If it has no `.t3/setup-done`, run `node scripts/setup-worktree.ts` from its root with `T3CODE_PROJECT_ROOT=G:/Sorted/Code/t3code`, which links treflex and installs.
- **Test threads go in the Test project** (`G:\Sorted\Test`). Viewing threads in other projects is fine; creating threads or sending turns there is not.
- **Hand back with screenshots.** When user-visible work is done, open your test client with the T3 preview tools (`preview_open` on your port, `preview_snapshot` with `save=true`) and capture what changed, beside stock web (port 5733, same server) in the same state when the work is parity with stock. Close the tabs you opened. Upload each image with `t3_attachment_prepare_upload` and send them with `t3_thread_send_attachments` to the thread that launched you, whose id is in your task, with a short summary: what changed, branch and commit, and the test URL. With no launching thread, embed them in your final reply.
- **Merge only when Tam approves.** Then merge `reflex-main` into your branch, resolve conflicts keeping both sides' behaviour, and rerun `vp run typecheck`, `vp lint` and `vp test run` from `apps/reflex-web`. Fast-forward the main checkout, the one write allowed there, and push:

  ```bash
  cd /g/Sorted/Code/t3code && git status --porcelain && git merge --ff-only <your branch> && git push origin reflex-main
  ```

  If the main checkout isn't clean, stop and report. If the fast-forward fails, `reflex-main` moved: merge it into your branch again, recheck, and retry. Then stop your test client by the task you started it with, and settle your own thread with `t3_thread_organize` (`action: "settle"`, no `threadId`).
