import { createEffect } from "solid-js";
import { useDispatch } from "treflex-solid";

import OpenThread from "./OpenThread";
import { type IShell, visitThread } from "./Shell";

/** Follows ThreadVisitWatermark in apps/web: a thread's completions are seen while its view is mounted. */
export const ThreadVisit = OpenThread.provider((props: { shell: IShell }) => {
  const thread = OpenThread.use();
  const dispatch = useDispatch();
  let mounting = true;
  createEffect(() => {
    const due = thread.visitDue();
    if (due !== null || mounting) {
      void dispatch(visitThread, props.shell, thread.state.ThreadId, mounting);
    }
    mounting = false;
  });
  return null;
});
