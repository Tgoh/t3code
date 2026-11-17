import {
  projectCloneDisplayName,
  projectCloneProgressSummary,
  type ProjectCloneSnapshot,
} from "@t3tools/contracts";
import { useResource } from "treflex-solid";
import { createMemo, Show } from "solid-js";

import Environment from "./Environment";
import { Download } from "./icons";
import { Button } from "./ui/Button";
import { BANNER, BANNER_ACTIONS, BANNER_BODY, BANNER_TITLE } from "./ui/notice";

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

// Follows projectCloneSendBlockReason in apps/web/src/components/chat/useProjectCloneBanner.tsx.
export function cloneSendBlock(clone: ProjectCloneSnapshot | null): string | null {
  if (clone === null || clone.phase === "done") return null;
  return clone.phase === "running" ? "Cloning repository" : "Repository not cloned";
}

// Follows useProjectCloneBanner in apps/web/src/components/chat/useProjectCloneBanner.tsx.
export function ProjectCloneBanner(props: { clone: ProjectCloneSnapshot }) {
  const environment = Environment.use();
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
              <Button onClick={() => environment.projectCommand(projectId(), { Kind: "delete" })}>
                Remove project
              </Button>
              <Button
                disabled={environment.cloneControlling()}
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
            disabled={environment.cloneControlling()}
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
