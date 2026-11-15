import { createSignal, Show } from "solid-js";

import { ProjectBadge } from "./brand";
import Environment from "./Environment";
import { ChevronRight, Ellipsis, PenLine, Pin, PinOff, SquarePen } from "./icons";
import type { IProjectCommand } from "./Infrastructure/commandEffects";
import type { IWireProject } from "./Infrastructure/wire";
import { MenuItem, Popup } from "./Menu";
import Shell, { type IProjectFolder, sidebarStatus } from "./Shell";
import { RenameInput } from "./ThreadCard";

export function ProjectMenu(props: {
  project: IWireProject;
  x: number;
  y: number;
  onRename: () => void;
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
    </Popup>
  );
}

export function FolderHeader(props: {
  folder: IProjectFolder;
  open: boolean;
  renaming: boolean;
  onToggle: () => void;
  onMenu: (x: number, y: number) => void;
  onRenamed: (title: string | null) => void;
}) {
  const environment = Environment.use();
  const shell = Shell.use();
  const title = () => props.folder.Project?.title ?? "Unknown project";
  const needsYou = () =>
    props.folder.Threads.some((thread) => {
      const status = sidebarStatus(thread, shell.subagentRequests()[thread.id]);
      return status !== null && status !== "working";
    });
  return (
    <li>
      <div
        class="section-header folder-header"
        role="button"
        tabindex="0"
        aria-expanded={props.open}
        onClick={props.onToggle}
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
        <ProjectBadge name={title()} size={12} />
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

function folderTitle(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || path
  );
}

export function AddProjectForm(props: { onClose: () => void }) {
  const environment = Environment.use();
  const [path, setPath] = createSignal("");
  const submit = () => {
    const root = path().trim();
    if (root === "") return;
    environment.projectCommand(null, {
      Kind: "create",
      Title: folderTitle(root),
      WorkspaceRoot: root,
    });
    props.onClose();
  };
  return (
    <form
      class="add-project"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        class="card-rename"
        aria-label="Project folder"
        placeholder="Folder on the server, e.g. E:\Code\app"
        value={path()}
        ref={(input) => queueMicrotask(() => input.focus())}
        onInput={(event) => setPath(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onClose();
        }}
      />
      <button type="submit" class="card-action" disabled={path().trim() === ""}>
        Add
      </button>
    </form>
  );
}
