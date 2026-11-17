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
  on,
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
import { ADDED_TEXT, DIFF_COUNTS, REMOVED_TEXT } from "./ui/notes";

const COMMIT_DIALOG_TITLE = "Commit changes";
const COMMIT_DIALOG_DESCRIPTION =
  "Review and confirm your commit. Leave the message blank to auto-generate one.";

const TINT = "bg-[color-mix(in_srgb,var(--foreground)_3.5%,transparent)]";
const ROW_BASE =
  "flex h-8 min-w-0 items-center gap-2.5 border border-transparent text-left text-[13px] font-medium text-[color-mix(in_srgb,var(--foreground)_80%,transparent)] [&>svg]:size-4 [&>svg]:flex-none [&>svg.brand-icon]:text-foreground [&>svg:not(.brand-icon)]:text-muted-foreground";
const ACTION =
  "cursor-pointer bg-transparent hover:not-disabled:not-aria-disabled:bg-[color-mix(in_srgb,var(--foreground)_3.5%,transparent)] disabled:cursor-default disabled:opacity-64 aria-disabled:cursor-default aria-disabled:opacity-64";
const ROW = `${ROW_BASE} ${ACTION} w-full rounded-[8px] px-2.5 py-0`;
const INERT_ROW = `${ROW_BASE} w-full cursor-default rounded-[8px] px-2.5 py-0`;
const LABEL = "min-w-0 flex-1 truncate";
const ICON_ACTION =
  "-mr-1.5 inline-flex size-6 flex-none cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted-foreground hover:bg-[color-mix(in_srgb,var(--foreground)_3.5%,transparent)] hover:text-foreground [&_svg]:size-4";
const SECTION = "flex flex-col px-2 pt-2 pb-2.5";
const ERROR = "mx-2.5 mt-0.5 mb-1 text-[12px] text-error-foreground wrap-anywhere";
const NOTE = "m-0 px-2 py-1.5 text-[12px]";
const FIELD_LABEL = "text-[13px] font-medium";
const FIELD =
  "rounded-lg border border-input bg-background px-2 py-1.5 text-[14px] text-foreground";

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
    <div
      class="group/split flex w-full items-center rounded-[8px] hover:bg-[color-mix(in_srgb,var(--foreground)_3.5%,transparent)]"
      role="group"
      ref={group}
    >
      <button
        class={`${ROW_BASE} ${ACTION} w-full flex-1 rounded-[8px_0_0_8px] px-2.5 py-0`}
        aria-disabled={props.disabled === true ? "true" : undefined}
        data-tip={props.tip}
        onClick={() => {
          if (props.disabled !== true) props.onRun();
        }}
      >
        {props.icon}
        <span class={LABEL}>{props.label}</span>
      </button>
      <span
        class="h-4 w-px flex-none bg-transparent group-hover/split:bg-[color-mix(in_srgb,var(--border)_65%,transparent)]"
        aria-hidden="true"
      />
      <button
        class={`${ROW_BASE} ${ACTION} w-8 justify-center rounded-[0_8px_8px_0] p-0`}
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
        <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 rounded-[12px] border border-border bg-[color-mix(in_srgb,var(--muted)_72%,transparent)] p-3 text-[14px]">
          <span class="text-muted-foreground">Branch</span>
          <span class="flex justify-between font-medium">
            {props.status.refName ?? "(detached HEAD)"}
            <Show when={props.status.isDefaultRef}>
              <span class="font-normal text-warning-foreground">Default branch</span>
            </Show>
          </span>
          <span class="text-muted-foreground">Files</span>
          <ul class="col-span-full m-0 flex max-h-48 list-none flex-col gap-0.5 overflow-y-auto p-0">
            <For each={files()}>
              {(file) => (
                <li>
                  <label class="flex items-center gap-2 font-mono text-[12px]">
                    <input
                      type="checkbox"
                      checked={!excluded().has(file.path)}
                      onChange={() => toggle(file.path)}
                    />
                    <span class={LABEL}>{file.path}</span>
                    <span class={DIFF_COUNTS}>
                      <span class={ADDED_TEXT}>+{formatCount(file.insertions)}</span> /{" "}
                      <span class={REMOVED_TEXT}>-{formatCount(file.deletions)}</span>
                    </span>
                  </label>
                </li>
              )}
            </For>
          </ul>
          <span class={`${DIFF_COUNTS} col-span-full justify-self-end`}>
            <span class={ADDED_TEXT}>
              +{formatCount(selected().reduce((sum, file) => sum + file.insertions, 0))}
            </span>
            /
            <span class={REMOVED_TEXT}>
              -{formatCount(selected().reduce((sum, file) => sum + file.deletions, 0))}
            </span>
          </span>
        </div>
        <label class={FIELD_LABEL} for="commit-message">
          Commit message (optional)
        </label>
        <textarea
          id="commit-message"
          class={`${FIELD} resize-y`}
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
          <label class={FIELD_LABEL} for="script-name">
            Name
          </label>
          <input
            id="script-name"
            class={FIELD}
            autofocus
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
          />
          <label class={FIELD_LABEL} for="script-command">
            Command
          </label>
          <input
            id="script-command"
            class={`${FIELD} font-mono`}
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
  /** The thread's branch, which stands in for git status until status arrives. */
  branch: string | null;
  scripts: readonly ProjectScript[];
  running: boolean;
  shown: boolean;
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
  createEffect(
    on(
      () => props.shown,
      (shown) => {
        if (shown) void details.refreshStatus();
        else setMenu(null);
      },
      { defer: true },
    ),
  );

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
  const branchName = () => {
    const status = git();
    return status === null ? props.branch : status.refName;
  };
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
    <div>
      <section class={SECTION} aria-label="Workspace">
        <div class={INERT_ROW} aria-label={`Run context: ${environment.state.Label}`}>
          <Server />
          <span class={LABEL}>{environment.state.Label || "This machine"}</span>
          <button
            class={ICON_ACTION}
            aria-label="Open folder"
            data-tip="Open folder"
            onClick={() => void environment.openInFileManager(props.checkout.Cwd)}
          >
            <Folder />
          </button>
        </div>
        <Show when={(details.state.Editors?.Available.length ?? 1) > 0}>
          <SplitRow
            label={editorLabel()}
            icon={<EditorIcon editor={details.state.Editors?.Preferred ?? ""} />}
            disabled={details.state.Editors === null}
            menuLabel="Choose editor"
            menuDisabled={details.state.Editors === null}
            onRun={() => openEditor(null)}
            onMenu={(anchor) => setMenu({ Kind: "editor", Anchor: anchor })}
          />
        </Show>
        <Show
          when={props.scripts[0]}
          fallback={
            <button class={ROW} onClick={() => setAddingScript(true)}>
              <Plus />
              <span class={LABEL}>Add project script</span>
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
        <Show when={details.state.ScriptError}>{(error) => <p class={ERROR}>{error()}</p>}</Show>
      </section>

      <Show when={git()?.isRepo ?? props.branch !== null}>
        <section
          class={`${SECTION} border-t border-[color-mix(in_srgb,var(--border)_65%,transparent)]`}
          aria-label="Version Control"
        >
          <button
            class={ROW}
            aria-label={`Branch: ${branchName() ?? "detached HEAD"}`}
            disabled={props.running || details.switchingBranch()}
            data-tip={props.running ? "Wait for the turn to finish to switch branches." : undefined}
            onClick={(event) => openBranches(menuAt(event.currentTarget))}
          >
            <GitBranch />
            <span class={LABEL}>
              {details.switchingBranch() ? "Switching…" : (branchName() ?? "Detached HEAD")}
            </span>
            <ChevronDown class="ml-auto" />
          </button>
          <Show when={details.state.BranchError ?? work.state.BranchError}>
            {(error) => <p class={ERROR}>{error()}</p>}
          </Show>
          <Show
            when={!busy() && noticeLabel() === null}
            fallback={
              <div class={`${INERT_ROW} ${TINT}`} role="status">
                <QuickActionIcon action={quick()} status={git()} />
                <span class={LABEL}>{busy() ? "Working…" : noticeLabel()}</span>
                <Show when={!busy() && work.state.Notice?.Url}>
                  {(url) => (
                    <a
                      class={ICON_ACTION}
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
              <div class="flex items-start gap-1 pr-2" role="alert">
                <p class={`${ERROR} flex-1`}>
                  {notice().Title}: {notice().Description}
                </p>
                <button
                  class={ICON_ACTION}
                  aria-label="Dismiss"
                  data-tip="Dismiss"
                  onClick={() => void work.dismissNotice()}
                >
                  <X />
                </button>
              </div>
            )}
          </Show>
          <button class={ROW} onClick={() => void session.openDiff("branch", null)}>
            <FileDiff />
            <span class="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span>Changes</span>
              <Show when={totals()?.BaseRef !== undefined}>
                <span class="min-w-0 truncate font-normal text-muted-foreground">
                  {totals()?.BaseRef === null ? "Uncommitted" : `vs ${totals()?.BaseRef}`}
                </span>
              </Show>
              <span class="ml-auto flex flex-none gap-2 pl-2 font-mono text-muted-foreground tabular-nums">
                <span class={(totals()?.Insertions ?? 0) > 0 ? ADDED_TEXT : undefined}>
                  +{formatCount(totals()?.Insertions ?? 0)}
                </span>
                <span class={(totals()?.Deletions ?? 0) > 0 ? REMOVED_TEXT : undefined}>
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
                class="flex max-w-[calc(100vw-16px)] flex-col"
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
                    <p class={`${NOTE} text-warning-foreground`}>
                      Detached HEAD: create and check out a branch to enable push and{" "}
                      {terminology().singular} actions.
                    </p>
                  </Show>
                </Show>
                <Show when={open().Kind === "branch"}>
                  <input
                    class="-mx-1 -mt-1 mb-1 border-x-0 border-t-0 border-b border-border bg-transparent px-3 py-2 text-[13px] text-foreground outline-none"
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
                  <div class="flex max-h-72 flex-col overflow-y-auto">
                    <Show when={details.loadingBranches() && details.state.Branches === null}>
                      <p class={`${NOTE} text-warning-foreground`}>Loading branches…</p>
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
                      {(error) => <p class={`${NOTE} text-error-foreground`}>{error()}</p>}
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
  shown: boolean;
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
    if (props.inline || !props.shown) return;
    measure();
    onCleanup(
      overlays.push({
        close: () => props.onDismiss(),
        contains: (node) =>
          card()?.contains(node) === true || props.anchor?.contains(node) === true,
      }),
    );
  });
  // A card already pinned open on a thread switch appears once the stage is measured, without
  // sliding in, so motion starts two frames after mount.
  const [motion, setMotion] = createSignal(false);
  onMount(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setMotion(true)));
    measure();
    window.addEventListener("resize", measure);
    onCleanup(() => window.removeEventListener("resize", measure));
  });
  return (
    <aside
      ref={setCard}
      class={`w-[280px] overflow-y-auto rounded-[16px] data-[shown=false]:invisible data-[shown=false]:-translate-y-2 data-[shown=false]:opacity-0 data-motion:motion-safe:transition-[translate,opacity,visibility] data-motion:motion-safe:duration-200 data-motion:motion-safe:ease-in-out border border-[color-mix(in_srgb,var(--foreground)_10%,transparent)] bg-[color-mix(in_srgb,var(--popover)_var(--glass-opacity),transparent)] shadow-[0_10px_25px_-5px_rgb(0_0_0/12%)] backdrop-blur-(--glass-blur) backdrop-saturate-(--glass-saturation) ${props.inline ? "absolute top-3 right-3 z-30 max-h-[calc(100%-24px)]" : "fixed z-70 max-h-[min(calc(100dvh-6.5rem),32rem)] max-w-[calc(100vw-16px)]"}`}
      role="region"
      aria-label="Thread details"
      data-shown={props.shown}
      data-motion={motion() ? "" : undefined}
      inert={!props.shown}
      style={props.inline ? undefined : { top: `${place().Top}px`, right: `${place().Right}px` }}
    >
      {props.children}
    </aside>
  );
}
