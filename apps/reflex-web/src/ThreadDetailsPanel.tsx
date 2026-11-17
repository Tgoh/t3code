import { changeRequestTerminologyFor } from "@t3tools/client-runtime/state/vcs";
import type { ProjectScript, VcsStatusResult } from "@t3tools/contracts";
import { useResource } from "treflex-solid";
import { Dynamic, Portal } from "solid-js/web";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";

import { editorIcon } from "./editorIcons";
import Environment from "./Environment";
import {
  buildMenuItems,
  defaultBranchDialogCopy,
  featureBranchUnavailableReason,
  type IGitMenuItem,
  type IGitQuickAction,
  menuItemDisabledReason,
  resolveQuickAction,
} from "./gitActions";
import {
  ChevronDown,
  CloudDownload,
  CloudUpload,
  ExternalLink,
  FileDiff,
  Folder,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  Info,
  Play,
  Plus,
  Server,
  X,
} from "./icons";
import GitWork, { type IActionContext } from "./GitWork";
import { useOverlays } from "./overlays";
import ThreadDetails, {
  blockedByWorktree,
  changesTotals,
  getDefaultThreadDetails,
  type ICheckout,
} from "./ThreadDetails";
import { SourceControlIcon } from "./sourceControlIcon";
import ThreadSession from "./ThreadSession";
import { Button } from "./ui/Button";
import { MenuItem, MenuSeparator, Popup } from "./ui/Menu";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/Modal";

const COMMIT_DIALOG_TITLE = "Commit changes";
const COMMIT_DIALOG_DESCRIPTION =
  "Review and confirm your commit. Leave the message blank to auto-generate one.";

const actionContext = (status: VcsStatusResult | null): IActionContext => ({
  RefName: status?.refName ?? null,
  IsDefaultRef: status?.isDefaultRef ?? false,
  HasWorkingTreeChanges: status?.hasWorkingTreeChanges ?? false,
});

const formatCount = (count: number) =>
  count >= 10_000 ? `${Math.round(count / 1000)}k` : String(count);

function menuAt(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return { X: rect.left, Y: rect.bottom + 4, Width: rect.width };
}

interface IMenuAnchor {
  X: number;
  Y: number;
  Width: number;
}

// Follows GitQuickActionIcon and GitActionItemIcon in apps/web/src/components/GitActionsControl.tsx.
function QuickActionIcon(props: { action: IGitQuickAction; status: VcsStatusResult | null }) {
  const kind = () => {
    const action = props.action;
    if (action.kind === "open_publish") return "push";
    if (action.kind === "run_pull") return "pull";
    if (action.kind === "run_action") {
      if (action.action === "commit") return "commit";
      if (action.action === "push" || action.action === "commit_push") return "push";
      return "forge";
    }
    if (action.label === "Commit") return "commit";
    if (action.label === "Push") return "push";
    return "info";
  };
  return (
    <Switch>
      <Match when={kind() === "commit"}>
        <GitCommitHorizontal />
      </Match>
      <Match when={kind() === "push"}>
        <CloudUpload />
      </Match>
      <Match when={kind() === "pull"}>
        <CloudDownload />
      </Match>
      <Match when={kind() === "forge"}>
        <SourceControlIcon status={props.status} />
      </Match>
      <Match when={kind() === "info"}>
        <Info />
      </Match>
    </Switch>
  );
}

function MenuIcon(props: { item: IGitMenuItem; status: VcsStatusResult | null }) {
  return (
    <Switch>
      <Match when={props.item.icon === "commit"}>
        <GitCommitHorizontal />
      </Match>
      <Match when={props.item.icon === "push"}>
        <CloudUpload />
      </Match>
      <Match when={props.item.icon === "pr"}>
        <SourceControlIcon status={props.status} />
      </Match>
    </Switch>
  );
}

function EditorIcon(props: { editor: string }) {
  return (
    <Show when={editorIcon(props.editor, navigator.platform)} fallback={<Folder />}>
      {(icon) => <Dynamic component={icon()} class="brand-icon" />}
    </Show>
  );
}

function SplitRow(props: {
  label: string;
  icon: JSX.Element;
  disabled?: boolean;
  tip?: string;
  menuLabel: string;
  menuDisabled?: boolean;
  onRun: () => void;
  onMenu: (anchor: IMenuAnchor) => void;
}) {
  let group!: HTMLDivElement;
  return (
    <div class="details-split" role="group" ref={group}>
      <button
        class="details-row details-split-primary"
        aria-disabled={props.disabled === true ? "true" : undefined}
        data-tip={props.tip}
        onClick={() => {
          if (props.disabled !== true) props.onRun();
        }}
      >
        {props.icon}
        <span class="details-label">{props.label}</span>
      </button>
      <span class="details-split-rule" aria-hidden="true" />
      <button
        class="details-row details-split-secondary"
        aria-label={props.menuLabel}
        disabled={props.menuDisabled === true}
        onClick={() => props.onMenu(menuAt(group))}
      >
        <ChevronDown />
      </button>
    </div>
  );
}

function CommitDialog(props: {
  status: VcsStatusResult;
  onClose: () => void;
  onCommit: (message: string | null, files: string[] | null, featureBranch: boolean) => void;
}) {
  const [message, setMessage] = createSignal("");
  const [excluded, setExcluded] = createSignal<ReadonlySet<string>>(new Set());
  const files = () => props.status.workingTree.files;
  const selected = () => files().filter((file) => !excluded().has(file.path));
  const submit = (featureBranch: boolean) => {
    const text = message().trim();
    props.onCommit(
      text === "" ? null : text,
      excluded().size === 0 ? null : selected().map((file) => file.path),
      featureBranch,
    );
    props.onClose();
  };
  const toggle = (path: string) =>
    setExcluded((held) => {
      const next = new Set(held);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  return (
    <Dialog aria-labelledby="commit-dialog-title" onClose={props.onClose}>
      <DialogHeader>
        <DialogTitle id="commit-dialog-title">{COMMIT_DIALOG_TITLE}</DialogTitle>
        <DialogDescription>{COMMIT_DIALOG_DESCRIPTION}</DialogDescription>
        <div class="commit-summary">
          <span class="commit-summary-key">Branch</span>
          <span class="commit-summary-value">
            {props.status.refName ?? "(detached HEAD)"}
            <Show when={props.status.isDefaultRef}>
              <span class="commit-default">Default branch</span>
            </Show>
          </span>
          <span class="commit-summary-key">Files</span>
          <ul class="commit-files">
            <For each={files()}>
              {(file) => (
                <li>
                  <label>
                    <input
                      type="checkbox"
                      checked={!excluded().has(file.path)}
                      onChange={() => toggle(file.path)}
                    />
                    <span class="commit-file-path">{file.path}</span>
                    <span class="diff-counts">
                      <span class="added-text">+{formatCount(file.insertions)}</span> /{" "}
                      <span class="removed-text">-{formatCount(file.deletions)}</span>
                    </span>
                  </label>
                </li>
              )}
            </For>
          </ul>
          <span class="commit-total diff-counts">
            <span class="added-text">
              +{formatCount(selected().reduce((sum, file) => sum + file.insertions, 0))}
            </span>
            /
            <span class="removed-text">
              -{formatCount(selected().reduce((sum, file) => sum + file.deletions, 0))}
            </span>
          </span>
        </div>
        <label class="commit-message-label" for="commit-message">
          Commit message (optional)
        </label>
        <textarea
          id="commit-message"
          class="commit-message"
          rows={3}
          placeholder="Leave empty to auto-generate"
          value={message()}
          onInput={(event) => setMessage(event.currentTarget.value)}
        />
      </DialogHeader>
      <DialogFooter>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button disabled={selected().length === 0} onClick={() => submit(true)}>
          Commit on new branch
        </Button>
        <Button variant="primary" disabled={selected().length === 0} onClick={() => submit(false)}>
          Commit
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function AddScriptDialog(props: {
  onClose: () => void;
  onAdd: (name: string, command: string) => void;
}) {
  const [name, setName] = createSignal("");
  const [command, setCommand] = createSignal("");
  const ready = () => name().trim() !== "" && command().trim() !== "";
  return (
    <Dialog aria-labelledby="add-script-title" onClose={props.onClose}>
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready()) return;
          props.onAdd(name().trim(), command().trim());
          props.onClose();
        }}
      >
        <DialogHeader>
          <DialogTitle id="add-script-title">Add project script</DialogTitle>
          <DialogDescription>
            Scripts run in this thread's terminal, from its working folder.
          </DialogDescription>
          <label class="commit-message-label" for="script-name">
            Name
          </label>
          <input
            id="script-name"
            class="commit-message"
            autofocus
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
          />
          <label class="commit-message-label" for="script-command">
            Command
          </label>
          <input
            id="script-command"
            class="commit-message mono"
            value={command()}
            onInput={(event) => setCommand(event.currentTarget.value)}
          />
        </DialogHeader>
        <DialogFooter>
          <Button onClick={props.onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!ready()}>
            Add script
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

const newScriptId = (name: string, scripts: readonly ProjectScript[]) => {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "script";
  let id = base;
  for (let suffix = 2; scripts.some((script) => script.id === id); suffix += 1) {
    id = `${base}-${suffix}`;
  }
  return id;
};

interface IDetailsProps {
  checkout: ICheckout;
  scripts: readonly ProjectScript[];
  running: boolean;
  onClose?: () => void;
}

const Body = (props: IDetailsProps) => {
  const details = ThreadDetails.use();
  const work = GitWork.use();
  const session = ThreadSession.use();
  const environment = Environment.use();
  const status = useResource(() => details.state, "Details/Status");
  const git = () => status.value()?.Status ?? null;
  const [menu, setMenu] = createSignal<
    | { Kind: "editor" | "git" | "scripts"; Anchor: IMenuAnchor }
    | { Kind: "branch"; Anchor: IMenuAnchor }
    | null
  >(null);
  const [committing, setCommitting] = createSignal(false);
  const [addingScript, setAddingScript] = createSignal(false);
  const [branchQuery, setBranchQuery] = createSignal("");
  onMount(() => void details.attach(props.checkout));

  const terminology = () => changeRequestTerminologyFor(git());
  const busy = () => work.gitBusy();
  const quick = createMemo(() =>
    resolveQuickAction(
      git(),
      busy(),
      git()?.isDefaultRef ?? false,
      git()?.hasPrimaryRemote ?? false,
    ),
  );
  const menuItems = createMemo(() =>
    buildMenuItems(git(), busy(), git()?.hasPrimaryRemote ?? false),
  );
  const totals = () => changesTotals(git());
  const editorLabel = () => {
    const editors = details.state.Editors;
    const preferred = editors?.Available.find((editor) => editor.Id === editors.Preferred);
    return preferred === undefined ? "Open in editor" : `Open in ${preferred.Label}`;
  };
  const closeMenu = () => setMenu(null);
  const openEditor = (editor: string | null) => {
    const target = editor ?? details.state.Editors?.Preferred ?? null;
    if (target !== null) void details.preferEditor(target);
    void work.openEditor(props.checkout, target);
  };

  const runQuick = () => {
    const action = quick();
    if (action.kind === "run_pull") return void work.pull(props.checkout);
    if (action.kind === "run_action" && action.action !== undefined) {
      void work.runGitAction(
        props.checkout,
        { Action: action.action, CommitMessage: null, FilePaths: null, FeatureBranch: false },
        actionContext(git()),
        false,
      );
    }
  };
  const runMenuItem = (item: IGitMenuItem) => {
    closeMenu();
    if (item.disabled) return;
    if (item.dialogAction === "commit") return setCommitting(true);
    void work.runGitAction(
      props.checkout,
      {
        Action: item.dialogAction === "push" ? "push" : "create_pr",
        CommitMessage: null,
        FilePaths: null,
        FeatureBranch: false,
      },
      actionContext(git()),
      false,
    );
  };
  const runScript = async (script: ProjectScript) => {
    closeMenu();
    await details.runScript(script, session.state.Terminal.TerminalId);
    if (details.state.ScriptError === null) void session.openTerminal();
  };
  const openBranches = (anchor: IMenuAnchor) => {
    setBranchQuery("");
    setMenu({ Kind: "branch", Anchor: anchor });
    void details.loadBranches("");
  };
  const pendingCopy = () => {
    const pending = work.state.PendingDefaultBranch;
    if (pending === null) return null;
    return defaultBranchDialogCopy({
      action: pending.Action,
      branchName: pending.Branch,
      includesCommit: pending.IncludesCommit,
      terminology: terminology(),
    });
  };
  const featureBranchBlock = () => {
    const pending = work.state.PendingDefaultBranch;
    return pending === null
      ? null
      : featureBranchUnavailableReason({
          action: pending.Action,
          branchName: pending.Branch,
          hasWorkingTreeChanges: git()?.hasWorkingTreeChanges ?? true,
        });
  };
  const noticeLabel = () => {
    const notice = work.state.Notice;
    return notice?.Tone === "success" ? notice.Title : null;
  };

  return (
    <div class="details-content">
      <section class="details-section" aria-label="Workspace">
        <div class="details-row inert" aria-label={`Run context: ${environment.state.Label}`}>
          <Server />
          <span class="details-label">{environment.state.Label || "This machine"}</span>
          <button
            class="details-icon-action"
            aria-label="Open folder"
            data-tip="Open folder"
            onClick={() => void environment.openInFileManager(props.checkout.Cwd)}
          >
            <Folder />
          </button>
        </div>
        <Show when={(details.state.Editors?.Available.length ?? 0) > 0}>
          <SplitRow
            label={editorLabel()}
            icon={<EditorIcon editor={details.state.Editors?.Preferred ?? ""} />}
            menuLabel="Choose editor"
            onRun={() => openEditor(null)}
            onMenu={(anchor) => setMenu({ Kind: "editor", Anchor: anchor })}
          />
        </Show>
        <Show
          when={props.scripts[0]}
          fallback={
            <button class="details-row" onClick={() => setAddingScript(true)}>
              <Plus />
              <span class="details-label">Add project script</span>
            </button>
          }
        >
          {(first) => (
            <SplitRow
              label={first().name}
              icon={<Play />}
              tip={first().command}
              menuLabel="Project scripts"
              onRun={() => void runScript(first())}
              onMenu={(anchor) => setMenu({ Kind: "scripts", Anchor: anchor })}
            />
          )}
        </Show>
        <Show when={details.state.ScriptError}>
          {(error) => <p class="details-error">{error()}</p>}
        </Show>
      </section>

      <Show when={git()?.isRepo}>
        <section class="details-section separated" aria-label="Version Control">
          <button
            class="details-row details-select"
            aria-label={`Branch: ${git()?.refName ?? "detached HEAD"}`}
            disabled={props.running || details.switchingBranch()}
            data-tip={props.running ? "Wait for the turn to finish to switch branches." : undefined}
            onClick={(event) => openBranches(menuAt(event.currentTarget))}
          >
            <GitBranch />
            <span class="details-label">
              {details.switchingBranch() ? "Switching…" : (git()?.refName ?? "Detached HEAD")}
            </span>
            <ChevronDown class="details-chevron" />
          </button>
          <Show when={details.state.BranchError ?? work.state.BranchError}>
            {(error) => <p class="details-error">{error()}</p>}
          </Show>
          <Show
            when={!busy() && noticeLabel() === null}
            fallback={
              <div class="details-row inert progress" role="status">
                <QuickActionIcon action={quick()} status={git()} />
                <span class="details-label">{busy() ? "Working…" : noticeLabel()}</span>
                <Show when={!busy() && work.state.Notice?.Url}>
                  {(url) => (
                    <a
                      class="details-icon-action"
                      href={url()}
                      target="_blank"
                      rel="noopener"
                      aria-label="Open pull request"
                    >
                      <ExternalLink />
                    </a>
                  )}
                </Show>
              </div>
            }
          >
            <SplitRow
              label={quick().label}
              icon={<QuickActionIcon action={quick()} status={git()} />}
              disabled={quick().disabled || quick().kind === "open_publish"}
              tip={
                quick().kind === "open_publish"
                  ? "Publishing a repository is not in this client yet."
                  : quick().disabled
                    ? quick().hint
                    : undefined
              }
              menuLabel="Git action options"
              menuDisabled={busy()}
              onRun={runQuick}
              onMenu={(anchor) => {
                void details.refreshStatus();
                setMenu({ Kind: "git", Anchor: anchor });
              }}
            />
          </Show>
          <Show when={work.state.Notice?.Tone === "error" && work.state.Notice}>
            {(notice) => (
              <div class="details-error-row" role="alert">
                <p class="details-error">
                  {notice().Title}: {notice().Description}
                </p>
                <button
                  class="details-icon-action"
                  aria-label="Dismiss"
                  data-tip="Dismiss"
                  onClick={() => void work.dismissNotice()}
                >
                  <X />
                </button>
              </div>
            )}
          </Show>
          <button class="details-row" onClick={() => void session.openDiff("branch", null)}>
            <FileDiff />
            <span class="details-changes">
              <span>Changes</span>
              <Show when={totals()?.BaseRef !== undefined}>
                <span class="details-muted">
                  {totals()?.BaseRef === null ? "Uncommitted" : `vs ${totals()?.BaseRef}`}
                </span>
              </Show>
              <span class="details-counts">
                <span classList={{ "added-text": (totals()?.Insertions ?? 0) > 0 }}>
                  +{formatCount(totals()?.Insertions ?? 0)}
                </span>
                <span classList={{ "removed-text": (totals()?.Deletions ?? 0) > 0 }}>
                  -{formatCount(totals()?.Deletions ?? 0)}
                </span>
              </span>
            </span>
          </button>
        </section>
      </Show>

      <Show when={menu()}>
        {(open) => (
          <Portal>
            <Popup
              x={open().Anchor.X}
              y={open().Anchor.Y}
              label={
                open().Kind === "editor"
                  ? "Choose editor"
                  : open().Kind === "scripts"
                    ? "Project scripts"
                    : open().Kind === "branch"
                      ? "Branches"
                      : "Git actions"
              }
              onClose={closeMenu}
            >
              <div
                class="details-menu"
                style={{ width: `${Math.max(open().Anchor.Width, 220)}px` }}
              >
                <Show when={open().Kind === "editor"}>
                  <For each={details.state.Editors?.Available ?? []}>
                    {(editor) => (
                      <MenuItem
                        truncate
                        icon={<EditorIcon editor={editor.Id} />}
                        label={editor.Label}
                        onSelect={() => {
                          closeMenu();
                          openEditor(editor.Id);
                        }}
                      />
                    )}
                  </For>
                </Show>
                <Show when={open().Kind === "scripts"}>
                  <For each={props.scripts}>
                    {(script) => (
                      <MenuItem
                        truncate
                        icon={<Play />}
                        label={script.name}
                        data-tip={script.command}
                        onSelect={() => void runScript(script)}
                      />
                    )}
                  </For>
                  <MenuSeparator />
                  <MenuItem
                    truncate
                    icon={<Plus />}
                    label="Add project script"
                    onSelect={() => {
                      closeMenu();
                      setAddingScript(true);
                    }}
                  />
                </Show>
                <Show when={open().Kind === "git"}>
                  <For each={menuItems()}>
                    {(item) => {
                      const reason = () =>
                        menuItemDisabledReason({
                          item,
                          gitStatus: git(),
                          isBusy: busy(),
                          hasPrimaryRemote: git()?.hasPrimaryRemote ?? false,
                        });
                      return (
                        <MenuItem
                          truncate
                          icon={<MenuIcon item={item} status={git()} />}
                          label={item.label}
                          aria-disabled={item.disabled ? "true" : undefined}
                          data-tip={reason() ?? undefined}
                          data-tip-side="right"
                          onSelect={() => runMenuItem(item)}
                        />
                      );
                    }}
                  </For>
                  <Show when={git()?.refName === null}>
                    <p class="details-menu-note">
                      Detached HEAD: create and check out a branch to enable push and{" "}
                      {terminology().singular} actions.
                    </p>
                  </Show>
                </Show>
                <Show when={open().Kind === "branch"}>
                  <input
                    class="details-menu-search"
                    placeholder="Search branches…"
                    autofocus
                    value={branchQuery()}
                    onInput={(event) => {
                      setBranchQuery(event.currentTarget.value);
                      void details.loadBranches(event.currentTarget.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      const exact = details.state.Branches?.find(
                        (ref) => ref.Name === branchQuery().trim(),
                      );
                      closeMenu();
                      if (exact !== undefined) void details.selectBranch(exact);
                      else void details.createBranch(branchQuery());
                    }}
                  />
                  <div class="details-menu-list">
                    <Show when={details.loadingBranches() && details.state.Branches === null}>
                      <p class="details-menu-note">Loading branches…</p>
                    </Show>
                    <For each={details.state.Branches ?? []}>
                      {(ref) => {
                        const blocked = () => blockedByWorktree(ref, props.checkout.Cwd);
                        return (
                          <MenuItem
                            truncate
                            icon={<GitBranch />}
                            label={ref.Name}
                            detail={ref.Current ? "current" : ref.IsDefault ? "default" : undefined}
                            aria-disabled={blocked() ? "true" : undefined}
                            data-tip={blocked() ? `Checked out in ${ref.WorktreePath}` : undefined}
                            onSelect={() => {
                              closeMenu();
                              void details.selectBranch(ref);
                            }}
                          />
                        );
                      }}
                    </For>
                    <Show
                      when={
                        branchQuery().trim() !== "" &&
                        !(details.state.Branches ?? []).some(
                          (ref) => ref.Name === branchQuery().trim(),
                        )
                      }
                    >
                      <MenuItem
                        truncate
                        icon={<GitBranchPlus />}
                        label={`Create branch "${branchQuery().trim()}"`}
                        onSelect={() => {
                          closeMenu();
                          void details.createBranch(branchQuery());
                        }}
                      />
                    </Show>
                    <Show when={details.state.BranchError}>
                      {(error) => <p class="details-menu-note error">{error()}</p>}
                    </Show>
                  </div>
                </Show>
              </div>
            </Popup>
          </Portal>
        )}
      </Show>

      <Show when={committing() && git()}>
        {(held) => (
          <CommitDialog
            status={held()}
            onClose={() => setCommitting(false)}
            onCommit={(message, files, featureBranch) =>
              void work.runGitAction(
                props.checkout,
                {
                  Action: "commit",
                  CommitMessage: message,
                  FilePaths: files,
                  FeatureBranch: featureBranch,
                },
                actionContext(git()),
                false,
              )
            }
          />
        )}
      </Show>

      <Show when={addingScript()}>
        <AddScriptDialog
          onClose={() => setAddingScript(false)}
          onAdd={(name, command) =>
            void details.saveScripts([
              ...props.scripts,
              {
                id: newScriptId(name, props.scripts),
                name,
                command,
                icon: "play",
                runOnWorktreeCreate: false,
              },
            ])
          }
        />
      </Show>

      <Show when={pendingCopy()}>
        {(copy) => (
          <Dialog
            aria-labelledby="default-branch-title"
            onClose={() => void work.cancelDefaultBranch()}
          >
            <DialogHeader>
              <DialogTitle id="default-branch-title">{copy().title}</DialogTitle>
              <DialogDescription>{copy().description}</DialogDescription>
              <Show when={featureBranchBlock()}>
                {(reason) => <p class="m-0 text-[12px] text-muted-foreground">{reason()}</p>}
              </Show>
            </DialogHeader>
            <DialogFooter class="flex-wrap">
              <Button
                class="mr-auto whitespace-nowrap"
                onClick={() => void work.cancelDefaultBranch()}
              >
                Abort
              </Button>
              <Button
                class="whitespace-nowrap"
                onClick={() =>
                  void work.continueDefaultBranch(props.checkout, false, actionContext(git()))
                }
              >
                {copy().continueLabel}
              </Button>
              <Button
                variant="primary"
                class="whitespace-nowrap"
                disabled={featureBranchBlock() !== null}
                onClick={() =>
                  void work.continueDefaultBranch(props.checkout, true, actionContext(git()))
                }
              >
                Check out feature branch & continue
              </Button>
            </DialogFooter>
          </Dialog>
        )}
      </Show>
    </div>
  );
};

const DetailsCard = ThreadDetails.provider(Body, getDefaultThreadDetails);

/** Mounted over the session's `Git`, so a git action's result outlives the card. */
export const ThreadDetailsCard = GitWork.provider<IDetailsProps>((props) => (
  <DetailsCard {...props} />
));

/**
 * The card's frame: pinned in the chat's corner when it fits there, else a popover under the
 * header toggle, as ThreadDetailsCard in apps/web/src/components/chat/ThreadDetailsCard.tsx does.
 */
export function DetailsSurface(props: {
  inline: boolean;
  anchor: HTMLElement | undefined;
  onDismiss: () => void;
  children: JSX.Element;
}) {
  const [place, setPlace] = createSignal({ Top: 0, Right: 0 });
  const measure = () => {
    const rect = props.anchor?.getBoundingClientRect();
    if (rect === undefined) return;
    setPlace({ Top: rect.bottom + 8, Right: Math.max(8, window.innerWidth - rect.right - 4) });
  };
  const [card, setCard] = createSignal<HTMLElement>();
  const overlays = useOverlays();
  createEffect(() => {
    if (props.inline) return;
    onCleanup(
      overlays.push({
        close: () => props.onDismiss(),
        contains: (node) =>
          card()?.contains(node) === true || props.anchor?.contains(node) === true,
      }),
    );
  });
  onMount(() => {
    measure();
    window.addEventListener("resize", measure);
    onCleanup(() => window.removeEventListener("resize", measure));
  });
  return (
    <aside
      ref={setCard}
      class="details-card"
      classList={{ docked: props.inline, popover: !props.inline }}
      role="region"
      aria-label="Thread details"
      style={props.inline ? undefined : { top: `${place().Top}px`, right: `${place().Right}px` }}
    >
      {props.children}
    </aside>
  );
}
