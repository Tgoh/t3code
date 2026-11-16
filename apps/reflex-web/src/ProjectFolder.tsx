import { planProjectRemoval } from "@t3tools/client-runtime/state/projects";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createMemo, createSignal, Show } from "solid-js";

import { ProjectBadge } from "./brand";
import { copyText } from "./clipboard";
import Environment from "./Environment";
import {
  ChevronRight,
  Copy,
  Ellipsis,
  FolderOpen,
  PenLine,
  Pin,
  PinOff,
  SquarePen,
  Trash2,
} from "./icons";
import type { IProjectCommand } from "./Infrastructure/commandEffects";
import type { IWireProject } from "./Infrastructure/wire";
import { MenuItem, Popup } from "./Menu";
import Shell, { type IProjectFolder, isBusy, sidebarStatus } from "./Shell";
import { RenameInput } from "./ThreadCard";

export function ProjectMenu(props: {
  project: IWireProject;
  x: number;
  y: number;
  onRename: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const environment = Environment.use();
  const command = (command: IProjectCommand) =>
    environment.projectCommand(props.project.id, command);
  const choose = (act: () => void) => {
    act();
    props.onClose();
  };
  return (
    <Popup x={props.x} y={props.y} label="Project actions" onClose={props.onClose}>
      <MenuItem
        icon={<SquarePen />}
        label="New thread"
        onSelect={() => choose(() => environment.newThread(props.project.id))}
      />
      <MenuItem
        icon={<Copy />}
        label="Copy path"
        onSelect={() => choose(() => void copyText(props.project.workspaceRoot))}
      />
      <Show
        when={props.project.pinnedAt != null}
        fallback={
          <MenuItem
            icon={<Pin />}
            label="Pin project"
            onSelect={() => choose(() => command({ Kind: "pin" }))}
          />
        }
      >
        <MenuItem
          icon={<PinOff />}
          label="Unpin project"
          onSelect={() => choose(() => command({ Kind: "unpin" }))}
        />
      </Show>
      <MenuItem icon={<PenLine />} label="Rename" onSelect={() => choose(props.onRename)} />
      <MenuItem
        icon={<FolderOpen />}
        label="Open in file manager"
        onSelect={() => choose(() => environment.openInFileManager(props.project.workspaceRoot))}
      />
      <div class="menu-separator" />
      <MenuItem
        icon={<Trash2 />}
        label="Remove project"
        danger
        onSelect={() => choose(props.onRemove)}
      />
    </Popup>
  );
}

// Follows removeMembers in apps/web/src/components/settings/ProjectSettingsPanel.tsx and the
// title and description split in apps/web/src/components/ConfirmDialogHost.tsx.
export function RemoveProjectDialog(props: { project: IWireProject; onClose: () => void }) {
  const environment = Environment.use();
  const shell = Shell.use();
  const [failure, setFailure] = createSignal<string | null>(null);
  const copy = createMemo(() => {
    const environmentId = EnvironmentId.make(environment.state.EnvironmentId);
    const { confirmationMessage } = planProjectRemoval({
      members: [
        {
          id: ProjectId.make(props.project.id),
          environmentId,
          title: props.project.title,
          workspaceRoot: props.project.workspaceRoot,
          environmentLabel: environment.state.Label || null,
        },
      ],
      groupMemberCount: 1,
      hasOtherMembers: false,
      displayName: props.project.title,
      threads: Object.values(shell.state.Threads).map((thread) => ({
        environmentId,
        projectId: ProjectId.make(thread.projectId),
        lineage: thread.lineage,
      })),
    });
    const [title = "", ...rest] = confirmationMessage.split("\n");
    return { Title: title, Description: rest.join("\n") };
  });
  const confirm = async () => {
    setFailure(null);
    const error = await environment.removeProject(props.project.id);
    if (error === null) props.onClose();
    else setFailure(`Failed to remove "${props.project.title}": ${error}`);
  };
  return (
    <dialog
      class="confirm-dialog"
      aria-labelledby="remove-project-title"
      ref={(dialog) => queueMicrotask(() => dialog.showModal())}
      onClose={props.onClose}
    >
      <div class="confirm-header">
        <h2 id="remove-project-title" class="confirm-title">
          {copy().Title}
        </h2>
        <p class="confirm-description">{copy().Description}</p>
        <Show when={failure()}>{(text) => <p class="confirm-error">{text()}</p>}</Show>
      </div>
      <div class="confirm-actions">
        <button class="button" autofocus onClick={props.onClose}>
          Cancel
        </button>
        <button
          class="button destructive"
          disabled={environment.removingProject()}
          onClick={() => void confirm()}
        >
          Confirm
        </button>
      </div>
    </dialog>
  );
}

export function FolderHeader(props: {
  folder: IProjectFolder;
  open: boolean;
  renaming: boolean;
  draggable: boolean;
  onToggle: () => void;
  onMenu: (x: number, y: number) => void;
  onRenamed: (title: string | null) => void;
  onDragStart: (event: PointerEvent) => void;
}) {
  const environment = Environment.use();
  const shell = Shell.use();
  const title = () => props.folder.Project?.title ?? "Unknown project";
  const needsYou = () =>
    props.folder.Threads.some((thread) => {
      const status = sidebarStatus(thread, shell.subagentRequests()[thread.id]);
      return status !== null && status !== "waiting" && !isBusy(status);
    });
  return (
    <li>
      <div
        class="section-header folder-header"
        classList={{ draggable: props.draggable }}
        role="button"
        tabindex="0"
        aria-expanded={props.open}
        onClick={props.onToggle}
        onPointerDown={(event) => {
          if (!props.draggable || props.renaming) return;
          if ((event.target as Element).closest("button, input")) return;
          props.onDragStart(event);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          props.onToggle();
        }}
        onContextMenu={(event) => {
          if (props.folder.Project === undefined) return;
          event.preventDefault();
          props.onMenu(event.clientX, event.clientY);
        }}
      >
        <ChevronRight class="section-chevron" classList={{ open: props.open }} />
        <ProjectBadge project={props.folder.Project} size={12} />
        <Show when={props.renaming} fallback={<span class="folder-title">{title()}</span>}>
          <RenameInput title={title()} onDone={props.onRenamed} />
        </Show>
        <Show when={props.folder.Project?.pinnedAt != null}>
          <Pin class="folder-pin" />
        </Show>
        <Show when={!props.open && needsYou()}>
          <span class="folder-dot" aria-label="Needs you" />
        </Show>
        <span class="section-count">{props.folder.Threads.length}</span>
        <Show when={props.folder.Project !== undefined}>
          <span class="card-actions folder-actions">
            <button
              type="button"
              class="card-action"
              aria-label={`New thread in ${title()}`}
              data-tip="New thread"
              onClick={(event) => {
                event.stopPropagation();
                environment.newThread(props.folder.ProjectId);
              }}
            >
              <SquarePen />
            </button>
            <button
              type="button"
              class="card-action"
              aria-label="Project actions"
              data-tip="Project actions"
              onClick={(event) => {
                event.stopPropagation();
                props.onMenu(event.clientX, event.clientY);
              }}
            >
              <Ellipsis />
            </button>
          </span>
        </Show>
      </div>
    </li>
  );
}
