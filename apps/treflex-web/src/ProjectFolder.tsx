import { planProjectRemoval } from "@t3tools/client-runtime/state/projects";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useInFlight } from "treflex-solid";
import { createMemo, createSignal, Show } from "solid-js";

import { ProjectBadge } from "./brand";
import { copyText } from "./clipboard";
import Environment, { removeProject } from "./Environment";
import {
  ChevronRight,
  Copy,
  Ellipsis,
  EyeOff,
  FolderOpen,
  PenLine,
  Pin,
  PinOff,
  SquarePen,
  Trash2,
} from "./icons";
import type { IProjectCommand } from "./Infrastructure/commandEffects";
import type { IWireProject } from "./Infrastructure/wire";
import Shell, { type IProjectFolder, isBusy, sidebarStatus } from "./Shell";
import { RenameInput } from "./ThreadCard";
import { Button } from "./ui/Button";
import { MenuItem, MenuPopup, MenuSeparator } from "./ui/Menu";
import { toastManager } from "./ui/toastStore";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/AlertDialog";

export function ProjectMenu(props: {
  project: IWireProject;
  x: number;
  y: number;
  onRename: () => void;
  onRemove: () => void;
  onHide: () => void;
  onClose: () => void;
}) {
  const environment = Environment.use();
  const command = (command: IProjectCommand) =>
    environment.projectCommand(props.project.id, command);
  return (
    <MenuPopup
      anchor={{ X: props.x, Y: props.y }}
      side="bottom"
      align="start"
      sideOffset={0}
      label="Project actions"
      onClose={props.onClose}
    >
      <MenuItem onClick={() => environment.newThread(props.project.id)}>
        <SquarePen />
        New thread
      </MenuItem>
      <MenuItem
        onClick={() =>
          void copyText(props.project.workspaceRoot).then((copied) => {
            if (!copied) {
              toastManager.add({
                type: "error",
                title: "Failed to copy path",
                description: "The browser refused the copy.",
              });
            }
          })
        }
      >
        <Copy />
        Copy path
      </MenuItem>
      <Show
        when={props.project.pinnedAt != null}
        fallback={
          <MenuItem onClick={() => command({ Kind: "pin" })}>
            <Pin />
            Pin project
          </MenuItem>
        }
      >
        <MenuItem onClick={() => command({ Kind: "unpin" })}>
          <PinOff />
          Unpin project
        </MenuItem>
      </Show>
      <MenuItem onClick={props.onRename}>
        <PenLine />
        Rename
      </MenuItem>
      <MenuItem onClick={() => environment.openInFileManager(props.project.workspaceRoot)}>
        <FolderOpen />
        Open in file manager
      </MenuItem>
      <MenuItem onClick={props.onHide}>
        <EyeOff />
        Hide project
      </MenuItem>
      <MenuSeparator />
      <MenuItem variant="destructive" onClick={props.onRemove}>
        <Trash2 />
        Remove project
      </MenuItem>
    </MenuPopup>
  );
}

export function RemoveProjectDialog(props: { project: IWireProject; onClose: () => void }) {
  const environment = Environment.use();
  const removing = useInFlight(removeProject, () => environment.state);
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
    <AlertDialog onClose={props.onClose}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy().Title}</AlertDialogTitle>
          <Show when={copy().Description}>
            {(description) => (
              <AlertDialogDescription class="whitespace-pre-line">
                {description()}
              </AlertDialogDescription>
            )}
          </Show>
          <Show when={failure()}>
            {(text) => (
              <p role="alert" class="text-sm text-destructive">
                {text()}
              </p>
            )}
          </Show>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose variant="outline">Cancel</AlertDialogClose>
          <Button variant="destructive" disabled={removing()} onClick={() => void confirm()}>
            Confirm
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
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
        class="group/folder mt-2 flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[13px] font-semibold text-sidebar-foreground select-none hover:bg-sidebar-row-hover"
        data-folder-header
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
        <ChevronRight class={props.open ? "size-3.5 rotate-90" : "size-3.5"} />
        <ProjectBadge project={props.folder.Project} size={12} />
        <Show when={props.renaming} fallback={<span class="truncate">{title()}</span>}>
          <RenameInput title={title()} onDone={props.onRenamed} />
        </Show>
        <Show when={props.folder.Project?.pinnedAt != null}>
          <Pin class="size-3 flex-none text-sidebar-muted-foreground" />
        </Show>
        <Show when={!props.open && needsYou()}>
          <span class="size-1.5 flex-none rounded-full bg-info-foreground" aria-label="Needs you" />
        </Show>
        <span class="ml-auto flex flex-none items-center">
          <span class="tabular-nums group-hover/folder:hidden group-has-[button:focus]/folder:hidden pointer-coarse:hidden">
            {props.folder.Threads.length}
          </span>
          <Show when={props.folder.Project !== undefined}>
            <span class="inline-flex w-0 items-center gap-0.5 overflow-hidden group-hover/folder:-mr-1 group-hover/folder:w-auto group-focus-within/folder:-mr-1 group-focus-within/folder:w-auto pointer-coarse:-mr-1 pointer-coarse:w-auto">
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={`New thread in ${title()}`}
                data-tip="New thread"
                onClick={(event) => {
                  event.stopPropagation();
                  environment.newThread(props.folder.ProjectId);
                }}
              >
                <SquarePen />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label="Project actions"
                data-tip="Project actions"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onMenu(event.clientX, event.clientY);
                }}
              >
                <Ellipsis />
              </Button>
            </span>
          </Show>
        </span>
      </div>
    </li>
  );
}
