// @effect-diagnostics globalDate:off globalTimers:off -- A view-only tick for live timers, outside any Effect runtime.
import { isOrchestrationV2WorkActive } from "@t3tools/contracts";
import { deriveSubagentElapsedMs } from "@t3tools/shared/orchestrationTiming";
import { type Accessor, createEffect, createSignal, onCleanup, Show } from "solid-js";

import { compactElapsed, fullElapsed, type ILineageAgent } from "./lineage";

export const SECOND = 1_000;

export function useTick(live: Accessor<boolean>): Accessor<number> {
  const [now, setNow] = createSignal(Date.now());
  createEffect(() => {
    if (!live()) return;
    const tick = setInterval(() => setNow(Date.now()), SECOND);
    onCleanup(() => clearInterval(tick));
  });
  return now;
}

/** A subagent task's run time, ticking each second while it runs. */
export function AgentElapsed(props: { agent: ILineageAgent; full?: boolean }) {
  const now = useTick(() => isOrchestrationV2WorkActive(props.agent.Status as never));
  const elapsed = () =>
    deriveSubagentElapsedMs(
      {
        status: props.agent.Status as never,
        startedAt: props.agent.StartedAt,
        completedAt: props.agent.CompletedAt,
      },
      now(),
    );
  return (
    <Show when={elapsed() !== null}>
      {(props.full === true ? fullElapsed : compactElapsed)(elapsed() ?? 0)}
    </Show>
  );
}
