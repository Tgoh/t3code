import {
  projectCloneDisplayName,
  projectCloneProgressSummary,
  type ProjectCloneSnapshot,
} from "@t3tools/contracts";
import { useInFlight, useResource } from "treflex-solid";
import { createEffect, createMemo, onCleanup, Show } from "solid-js";

import Environment, { cloneControl } from "./Environment";
import { Download } from "./icons";
import { Button } from "./ui/Button";
import { BANNER, BANNER_ACTIONS, BANNER_BODY, BANNER_TITLE } from "./ui/notice";
import { type IToastOptions, stackedThreadToast, toastManager } from "./ui/toastStore";

// Follows useProjectClone in apps/web/src/state/projectClones.ts.
export function useProjectClone(projectId: () => string | null) {
  const environment = Environment.use();
  const clones = useResource(environment.state, "Project/Clones");
  return createMemo((): ProjectCloneSnapshot | null => {
    const id = projectId();
    if (id === null) return null;
    return clones.value()?.find((clone) => clone.projectId === id) ?? null;
  });
}

const cloneRenderKey = (clone: ProjectCloneSnapshot) =>
  `${clone.phase}:${clone.stage}:${clone.percent ?? ""}:${clone.detail ?? ""}:${clone.stalled === true}:${clone.error ?? ""}`;

/** Projects whose clone toasts stopped once their new thread showed the banner. */
const silenced = new Set<string>();

/**
 * Follows apps/web/src/components/ProjectCloneToastCoordinator.tsx: each clone shows as one toast
 * that follows its progress, except while its project's new thread shows the banner instead.
 */
export function CloneToasts() {
  const environment = Environment.use();
  const clones = useResource(environment.state, "Project/Clones");
  const tracked = new Map<string, { Id: string; Key: string; Phase: string }>();
  const viewedProject = () => environment.selectedDraftSession()?.NewThreadProjectId ?? null;
  const close = (projectId: string) => {
    const held = tracked.get(projectId);
    if (held === undefined) return;
    toastManager.close(held.Id);
    tracked.delete(projectId);
  };
  const options = (clone: ProjectCloneSnapshot): IToastOptions => {
    const name = projectCloneDisplayName(clone);
    const projectId = clone.projectId;
    if (clone.phase === "running") {
      return stackedThreadToast({
        type: "loading",
        title: `Cloning ${name}`,
        description: projectCloneProgressSummary(clone),
        timeout: 0,
        actionProps: {
          children: "Cancel",
          onClick: () => void environment.cloneControl(projectId, "cancel"),
        },
        data: { hideCopyButton: true },
      });
    }
    if (clone.phase === "done") {
      return stackedThreadToast({
        type: "success",
        title: `Cloned ${name}`,
        description: clone.destinationPath,
        timeout: 8_000,
        actionProps: {
          children: "Open project",
          onClick: () => {
            close(projectId);
            void environment.newThread(projectId);
          },
        },
        data: { hideCopyButton: true },
      });
    }
    const cancelled = clone.phase === "cancelled";
    return stackedThreadToast({
      type: cancelled ? "info" : "error",
      title: cancelled ? `Cancelled cloning ${name}` : `Failed to clone ${name}`,
      description: cancelled ? clone.destinationPath : (clone.error ?? "The clone failed."),
      timeout: 0,
      actionProps: {
        children: "Retry",
        onClick: () => void environment.cloneControl(projectId, "retry"),
      },
      data: {
        ...(cancelled && { hideCopyButton: true }),
        secondaryActionProps: {
          children: "Remove project",
          onClick: () => void environment.projectCommand(projectId, { Kind: "delete" }),
        },
      },
    });
  };
  createEffect(() => {
    const seen = new Set<string>();
    const viewed = viewedProject();
    for (const clone of clones.value() ?? []) {
      const projectId = clone.projectId;
      seen.add(projectId);
      if (viewed === projectId) {
        silenced.add(projectId);
        close(projectId);
        continue;
      }
      const key = cloneRenderKey(clone);
      const held = tracked.get(projectId);
      if (held?.Key === key) continue;
      if (silenced.has(projectId) && (clone.phase === "running" || clone.phase === "done")) {
        close(projectId);
        continue;
      }
      const next = options(clone);
      if (held === undefined) {
        tracked.set(projectId, { Id: toastManager.add(next), Key: key, Phase: clone.phase });
      } else {
        toastManager.update(held.Id, next);
        tracked.set(projectId, { ...held, Key: key, Phase: clone.phase });
      }
    }
    for (const [projectId, held] of tracked) {
      if (seen.has(projectId)) continue;
      if (held.Phase !== "done") toastManager.close(held.Id);
      tracked.delete(projectId);
    }
  });
  onCleanup(() => {
    for (const held of tracked.values()) toastManager.close(held.Id);
    tracked.clear();
  });
  return null;
}

// Follows projectCloneSendBlockReason in apps/web/src/components/chat/useProjectCloneBanner.tsx.
export function cloneSendBlock(clone: ProjectCloneSnapshot | null): string | null {
  if (clone === null || clone.phase === "done") return null;
  return clone.phase === "running" ? "Cloning repository" : "Repository not cloned";
}

// Follows useProjectCloneBanner in apps/web/src/components/chat/useProjectCloneBanner.tsx.
export function ProjectCloneBanner(props: { clone: ProjectCloneSnapshot }) {
  const environment = Environment.use();
  const controlling = useInFlight(cloneControl, () => environment.state);
  const name = () => projectCloneDisplayName(props.clone);
  const projectId = () => props.clone.projectId;
  const cancelled = () => props.clone.phase === "cancelled";
  return (
    <div
      class={BANNER}
      data-tone={cancelled() ? "warning" : props.clone.phase === "failed" ? "error" : undefined}
    >
      <Show
        when={props.clone.phase === "running"}
        fallback={
          <>
            <div class={BANNER_TITLE}>
              <Download />
              <strong>
                {cancelled() ? `Cancelled cloning ${name()}` : `Failed to clone ${name()}`}
              </strong>
            </div>
            <pre class={BANNER_BODY}>
              {cancelled() ? "Retry to bring in the repository." : props.clone.error}
            </pre>
            <div class={BANNER_ACTIONS}>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => environment.projectCommand(projectId(), { Kind: "delete" })}
              >
                Remove project
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={controlling()}
                onClick={() => environment.cloneControl(projectId(), "retry")}
              >
                Retry
              </Button>
            </div>
          </>
        }
      >
        <div class={BANNER_TITLE}>
          <Download />
          <strong>Cloning {name()}</strong>
          <Button
            size="xs"
            variant="ghost"
            disabled={controlling()}
            onClick={() => environment.cloneControl(projectId(), "cancel")}
          >
            Cancel
          </Button>
        </div>
        <p class={BANNER_BODY}>{projectCloneProgressSummary(props.clone)}</p>
      </Show>
    </div>
  );
}
