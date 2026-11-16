import {
  projectCloneDisplayName,
  projectCloneProgressSummary,
  type ProjectCloneSnapshot,
} from "@t3tools/contracts";
import { useResource } from "treflex-solid";
import { createMemo, Show } from "solid-js";

import Environment from "./Environment";
import { Download } from "./icons";

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
      class="composer-banner"
      classList={{ warning: cancelled(), error: props.clone.phase === "failed" }}
    >
      <Show
        when={props.clone.phase === "running"}
        fallback={
          <>
            <div class="banner-title">
              <Download />
              <strong>
                {cancelled() ? `Cancelled cloning ${name()}` : `Failed to clone ${name()}`}
              </strong>
            </div>
            <pre class="banner-body">
              {cancelled() ? "Retry to bring in the repository." : props.clone.error}
            </pre>
            <div class="request-actions">
              <button
                class="button"
                onClick={() => environment.projectCommand(projectId(), { Kind: "delete" })}
              >
                Remove project
              </button>
              <button
                class="button"
                disabled={environment.cloneControlling()}
                onClick={() => environment.cloneControl(projectId(), "retry")}
              >
                Retry
              </button>
            </div>
          </>
        }
      >
        <div class="banner-title">
          <Download />
          <strong>Cloning {name()}</strong>
          <button
            class="button"
            disabled={environment.cloneControlling()}
            onClick={() => environment.cloneControl(projectId(), "cancel")}
          >
            Cancel
          </button>
        </div>
        <p class="banner-body">{projectCloneProgressSummary(props.clone)}</p>
      </Show>
    </div>
  );
}
