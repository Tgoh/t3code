import { changeRequestTerminologyFor } from "@t3tools/client-runtime/state/vcs";
import type { ProjectScript, VcsStatusResult } from "@t3tools/contracts";
import type { IAskId } from "treflex";
import { useInFlight, useResource } from "treflex-solid";
import { Dynamic } from "solid-js/web";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  splitProps,
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
  ArrowRight,
  Bot,
  ChevronDown,
  CloudDownload,
  CloudUpload,
  CornerLeftUp,
  ExternalLink,
  FileDiff,
  Folder,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  GitFork,
  GitMerge,
  Info,
  Play,
  Plus,
  Server,
  X,
} from "./icons";
import GitWork, { GitRunning, type IActionContext, type IDefaultBranchChoice } from "./GitWork";
import {
  type ILineage,
  type ILineageRelation,
  type ILineageRow,
  lineageStatusLabel,
  threadLineage,
} from "./lineage";
import { lineageTitles } from "./lineageTitles";
import { useOverlays } from "./overlays";
import ThreadDetails, {
  blockedByWorktree,
  changesTotals,
  type IThreadDetails,
  loadBranches,
  SwitchingBranch,
} from "./ThreadDetails";
import { SourceControlIcon } from "./sourceControlIcon";
import ThreadSession, { mergeBack } from "./ThreadSession";
import { AgentElapsed } from "./AgentElapsed";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";
import { Input } from "./ui/Input";
import { Label } from "./ui/Label";
import {
  MenuItem,
  MenuItemDetail,
  MenuItemLabel,
  MenuPopup,
  MenuSearchInput,
  MenuSeparator,
  openMenuFromKeys,
} from "./ui/Menu";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/Dialog";
import { Presence } from "./ui/Presence";
import { Spinner } from "./ui/Spinner";
import { Textarea } from "./ui/Textarea";
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

const actionContext = (status: VcsStatusResult | null): IActionContext => ({
  RefName: status?.refName ?? null,
  IsDefaultRef: status?.isDefaultRef ?? false,
  HasWorkingTreeChanges: status?.hasWorkingTreeChanges ?? false,
});

const formatCount = (count: number) =>
  count >= 10_000 ? `${Math.round(count / 1000)}k` : String(count);

interface IMenuAnchor {
  /** The row the menu opens under, as wide as it. */
  Row: HTMLElement;
  Trigger: HTMLElement;
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
  tip?: string | undefined;
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
        class="h-4 w-px flex-none bg-transparent group-hover/split:bg-[color-mix(in_srgb,var(--border)_65%,transparent)] group-has-[[data-popup-open]]/split:bg-[color-mix(in_srgb,var(--border)_65%,transparent)]"
        aria-hidden="true"
      />
      <button
        class={`${ROW_BASE} ${ACTION} w-8 justify-center rounded-[0_8px_8px_0] p-0`}
        aria-label={props.menuLabel}
        aria-haspopup="menu"
        aria-expanded="false"
        disabled={props.menuDisabled === true}
        onClick={(event) => props.onMenu({ Row: group, Trigger: event.currentTarget })}
        onKeyDown={(event) => {
          const trigger = event.currentTarget;
          openMenuFromKeys(event, () => props.onMenu({ Row: group, Trigger: trigger }));
        }}
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
    <Dialog onClose={props.onClose}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{COMMIT_DIALOG_TITLE}</DialogTitle>
          <DialogDescription>{COMMIT_DIALOG_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
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
                      <Checkbox
                        aria-label={`Include ${file.path}`}
                        checked={!excluded().has(file.path)}
                        onCheckedChange={() => toggle(file.path)}
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
          <div class="space-y-1">
            <p class="text-sm font-medium">Commit message (optional)</p>
            <Textarea
              aria-label="Commit message (optional)"
              size="sm"
              placeholder="Leave empty to auto-generate"
              value={message()}
              onInput={(event) => setMessage(event.currentTarget.value)}
            />
          </div>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" size="sm" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={selected().length === 0}
            onClick={() => submit(true)}
          >
            Commit on new branch
          </Button>
          <Button size="sm" disabled={selected().length === 0} onClick={() => submit(false)}>
            Commit
          </Button>
        </DialogFooter>
      </DialogPopup>
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
  const formId = createUniqueId();
  return (
    <Dialog onClose={props.onClose}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Add project script</DialogTitle>
          <DialogDescription>
            Scripts run in this thread's terminal, from its working folder.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            class="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!ready()) return;
              props.onAdd(name().trim(), command().trim());
              props.onClose();
            }}
          >
            <div class="space-y-1.5">
              <Label for="script-name">Name</Label>
              <Input
                id="script-name"
                value={name()}
                onInput={(event) => setName(event.currentTarget.value)}
              />
            </div>
            <div class="space-y-1.5">
              <Label for="script-command">Command</Label>
              <Textarea
                id="script-command"
                value={command()}
                onInput={(event) => setCommand(event.currentTarget.value)}
              />
            </div>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button form={formId} type="submit" disabled={!ready()}>
            Add script
          </Button>
        </DialogFooter>
      </DialogPopup>
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

const RELATIONS: Record<ILineageRelation, { Icon: Component; Name: string; Untitled: string }> = {
  parent: { Icon: CornerLeftUp, Name: "parent thread", Untitled: "Parent thread" },
  parentAgent: { Icon: CornerLeftUp, Name: "parent agent", Untitled: "Parent agent" },
  fork: { Icon: GitFork, Name: "fork", Untitled: "Fork" },
  transfer: { Icon: GitFork, Name: "context transfer", Untitled: "Context transfer" },
  subagent: { Icon: Bot, Name: "subagent", Untitled: "Subagent" },
  remote: { Icon: Bot, Name: "subagent", Untitled: "Subagent" },
};

const LINEAGE_INITIAL_COUNT = 6;
const LINEAGE_PAGE_COUNT = 12;
const STATUS_TEXT =
  "flex-none text-[11px] font-normal text-muted-foreground tabular-nums group-data-failed/lineage:text-destructive";

const isFailed = (status: string | null) => status === "failed" || status === "error";

function LineageRow(props: {
  row: ILineageRow;
  onMerge?: (() => void) | undefined;
  merging?: boolean;
}) {
  const environment = Environment.use();
  const session = ThreadSession.use();
  const relation = () => RELATIONS[props.row.Relation];
  const title = () => props.row.Title ?? relation().Untitled;
  const remote = () => props.row.Remote;
  const agent = () => {
    const held = props.row.Agent;
    return held !== null && !isFailed(props.row.Status) && held.StartedAt !== null ? held : null;
  };
  const canMerge = () => session.mergeBackRunId() !== null;
  return (
    <li
      class="group/lineage flex items-center"
      data-failed={isFailed(props.row.Status) ? "" : undefined}
    >
      <button
        class={ROW}
        aria-disabled={remote() !== null || undefined}
        data-tip={
          remote() !== null
            ? `${title()}: runs on ${remote()}`
            : `Open ${relation().Name}: ${title()}`
        }
        onClick={() => {
          if (remote() === null) void environment.selectThread(props.row.ThreadId);
        }}
      >
        <Dynamic component={relation().Icon} />
        <span class={LABEL}>{title()}</span>
        <Show when={remote() === null && props.row.Agent === null}>
          <ArrowRight class="size-3! flex-none opacity-0 group-hover/lineage:opacity-100" />
        </Show>
        <Show when={remote()}>
          {(label) => (
            <span class="max-w-1/2 flex-none truncate text-[11px] font-normal text-muted-foreground">
              on {label()}
            </span>
          )}
        </Show>
        <Show when={!props.onMerge}>
          <span class={STATUS_TEXT}>
            <Show when={agent()} fallback={lineageStatusLabel(props.row.Status)}>
              {(held) => <AgentElapsed agent={held()} />}
            </Show>
          </span>
        </Show>
      </button>
      <Show when={props.onMerge}>
        {(onMerge) => (
          <>
            <button
              class={ICON_ACTION}
              aria-label={`Merge back to ${title()}`}
              aria-disabled={!canMerge() || props.merging || undefined}
              data-tip={
                canMerge()
                  ? `Merge this conversation back into ${title()}`
                  : "Complete a run in this fork before merging it back"
              }
              onClick={() => {
                if (canMerge() && !props.merging) onMerge()();
              }}
            >
              <Show when={props.merging} fallback={<GitMerge />}>
                <Spinner size="xs" />
              </Show>
            </button>
            <span class={`${STATUS_TEXT} pr-2.5 pl-2`}>{lineageStatusLabel(props.row.Status)}</span>
          </>
        )}
      </Show>
    </li>
  );
}

function LineageList(props: { rows: ILineageRow[]; label: string }) {
  const session = ThreadSession.use();
  const merging = useInFlight(mergeBack, () => session.state);
  const [shown, setShown] = createSignal(LINEAGE_INITIAL_COUNT);
  const hidden = () => props.rows.length - Math.min(shown(), props.rows.length);
  return (
    <Show when={props.rows.length > 0}>
      <ul class="m-0 max-h-[13.5rem] list-none overflow-y-auto p-0" aria-label={props.label}>
        <For each={props.rows.slice(0, shown())}>
          {(row) => (
            <LineageRow
              row={row}
              merging={merging()}
              onMerge={row.MergeTarget ? () => void session.mergeBack(row.ThreadId) : undefined}
            />
          )}
        </For>
      </ul>
      <Show when={hidden() > 0}>
        <button class={ROW} onClick={() => setShown((count) => count + LINEAGE_PAGE_COUNT)}>
          <Plus />
          <span class="text-muted-foreground">
            Show {Math.min(hidden(), LINEAGE_PAGE_COUNT)} more
          </span>
        </button>
      </Show>
    </Show>
  );
}

function LineageGroups(props: { lineage: ILineage }) {
  const [previousOpen, setPreviousOpen] = createSignal(false);
  const previousFailed = () => props.lineage.Previous.filter((row) => isFailed(row.Status)).length;
  return (
    <>
      <LineageList
        rows={[...props.lineage.Related, ...props.lineage.Active]}
        label="Related threads"
      />
      <Show when={props.lineage.Previous.length > 0}>
        <button
          class={ROW}
          aria-expanded={previousOpen()}
          onClick={() => setPreviousOpen(!previousOpen())}
        >
          <Bot />
          <span class={LABEL}>Previous agents</span>
          <Show when={previousFailed() > 0}>
            <span class="flex-none text-[11px] font-normal text-destructive">
              {previousFailed()} failed
            </span>
          </Show>
          <Show when={!previousOpen()}>
            <span class="flex-none text-[11px] font-normal text-muted-foreground tabular-nums">
              {props.lineage.Previous.length}
            </span>
          </Show>
          <ChevronDown
            class={`size-3.5! transition-transform ${previousOpen() ? "" : "-rotate-90"}`}
          />
        </button>
        <Show when={previousOpen()}>
          <LineageList rows={props.lineage.Previous} label="Previous agents" />
        </Show>
      </Show>
    </>
  );
}

// Follows ThreadRelationshipsPanel in apps/web/src/components/chat/ThreadRelationshipsControl.tsx.
function LineageSection(props: { threadId: string }) {
  const environment = Environment.use();
  const session = ThreadSession.use();
  const input = createMemo(() => {
    const open = environment.state.Replica.OpenThreads[props.threadId];
    if (open?.Thread == null) return null;
    return {
      thread: open.Thread,
      subagents: Object.values(open.Subagents),
      contextTransfers: Object.values(open.ContextTransfers),
      shells: Object.values(environment.state.Replica.Shell.Threads),
    };
  });
  const untitled = createMemo(
    () => {
      const held = input();
      return held === null ? [] : threadLineage({ ...held, titles: null }).Lookup;
    },
    [],
    { equals: (left, right) => left.join(",") === right.join(",") },
  );
  const lineage = createMemo(() => {
    const held = input();
    const open = environment.state.Replica.OpenThreads[props.threadId];
    if (held === null || open === undefined) return null;
    return threadLineage({ ...held, titles: lineageTitles(open, untitled()) });
  });
  const visible = () => {
    const held = lineage();
    return (
      held !== null &&
      (held.Related.length > 0 ||
        held.Active.length > 0 ||
        held.Previous.length > 0 ||
        held.Running > 0)
    );
  };
  return (
    <Show when={visible() && lineage()}>
      {(held) => (
        <section
          class={`${SECTION} border-t border-[color-mix(in_srgb,var(--border)_65%,transparent)]`}
          aria-label="Lineage"
        >
          {/* A lone "Previous agents" row names itself, as stock's does. */}
          <Show when={held().Running > 0 || held().Related.length > 0 || held().Active.length > 0}>
            <h3 class="m-0 mb-1 flex min-h-8 items-center px-2.5 text-[11px] font-medium text-muted-foreground select-none">
              {held().Running > 0 ? `Lineage · ${held().Running} running` : "Lineage"}
            </h3>
          </Show>
          <Show when={session.state.MergeError}>
            {(error) => <p class={ERROR}>Couldn't merge back: {error()}</p>}
          </Show>
          <Show when={props.threadId} keyed>
            {(_threadId: string) => <LineageGroups lineage={held()} />}
          </Show>
        </section>
      )}
    </Show>
  );
}

interface IDetailsProps {
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
  const switchingBranch = useInFlight(SwitchingBranch, () => details.state);
  const loadingBranches = useInFlight(loadBranches, () => details.state);
  const busy = useInFlight(GitRunning, () => work.state);
  const git = () => status.value()?.Status ?? null;
  const cwd = () => details.state.Cwd;
  const [menu, setMenu] = createSignal<
    | { Kind: "editor" | "git" | "scripts"; Anchor: IMenuAnchor }
    | { Kind: "branch"; Anchor: IMenuAnchor }
    | null
  >(null);
  const [committing, setCommitting] = createSignal(false);
  const [addingScript, setAddingScript] = createSignal(false);
  const [branchQuery, setBranchQuery] = createSignal("");
  createEffect(
    on(
      () => props.shown,
      (shown) => {
        if (!shown) setMenu(null);
      },
      { defer: true },
    ),
  );

  const terminology = () => changeRequestTerminologyFor(git());
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
    const editors = environment.editors();
    const preferred = editors.Available.find((editor) => editor.Id === editors.Preferred);
    return preferred === undefined ? "Open in editor" : `Open in ${preferred.Label}`;
  };
  const closeMenu = () => setMenu(null);
  const toggleMenu = (kind: "editor" | "git" | "scripts" | "branch", anchor: IMenuAnchor) => {
    if (menu()?.Anchor.Trigger === anchor.Trigger) closeMenu();
    else setMenu({ Kind: kind, Anchor: anchor });
  };
  const openEditor = (editor: string | null) => {
    const target = editor ?? environment.editors().Preferred;
    if (target !== null) void environment.preferEditor(target);
    void work.openEditor(target);
  };

  const runQuick = () => {
    const action = quick();
    if (action.kind === "run_pull") return void work.pull();
    if (action.kind === "run_action" && action.action !== undefined) {
      void work.runGitAction(
        { Action: action.action, CommitMessage: null, FilePaths: null, FeatureBranch: false },
        actionContext(git()),
      );
    }
  };
  const runMenuItem = (item: IGitMenuItem) => {
    closeMenu();
    if (item.disabled) return;
    if (item.dialogAction === "commit") return setCommitting(true);
    void work.runGitAction(
      {
        Action: item.dialogAction === "push" ? "push" : "create_pr",
        CommitMessage: null,
        FilePaths: null,
        FeatureBranch: false,
      },
      actionContext(git()),
    );
  };
  const runScript = (script: ProjectScript) => {
    closeMenu();
    void session.runScript(script);
  };
  const openBranches = (anchor: IMenuAnchor) => {
    if (menu()?.Anchor.Trigger === anchor.Trigger) return closeMenu();
    setBranchQuery("");
    setMenu({ Kind: "branch", Anchor: anchor });
    void details.loadBranches("");
  };
  const pendingCopy = () => {
    const pending = work.defaultBranchConfirm()?.Request;
    if (pending === undefined) return null;
    return defaultBranchDialogCopy({
      action: pending.Action,
      branchName: pending.Branch,
      includesCommit: pending.IncludesCommit,
      terminology: terminology(),
    });
  };
  const featureBranchBlock = () => {
    const pending = work.defaultBranchConfirm()?.Request;
    return pending === undefined
      ? null
      : featureBranchUnavailableReason({
          action: pending.Action,
          branchName: pending.Branch,
          hasWorkingTreeChanges: git()?.hasWorkingTreeChanges ?? true,
        });
  };
  const chooseDefaultBranch = (choice?: IDefaultBranchChoice) => {
    const entry = work.defaultBranchConfirm();
    if (entry !== null)
      void work.chooseDefaultBranch(entry.Id as IAskId<IDefaultBranchChoice>, choice);
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
            onClick={() => void environment.openInFileManager(cwd())}
          >
            <Folder />
          </button>
        </div>
        <Show when={environment.editors().Available.length > 0}>
          <SplitRow
            label={editorLabel()}
            icon={<EditorIcon editor={environment.editors().Preferred ?? ""} />}
            menuLabel="Choose editor"
            onRun={() => openEditor(null)}
            onMenu={(anchor) => toggleMenu("editor", anchor)}
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
              onRun={() => runScript(first())}
              onMenu={(anchor) => toggleMenu("scripts", anchor)}
            />
          )}
        </Show>
        <Show when={session.state.ScriptError}>{(error) => <p class={ERROR}>{error()}</p>}</Show>
      </section>

      <Show when={git()?.isRepo ?? props.branch !== null}>
        <section
          class={`${SECTION} border-t border-[color-mix(in_srgb,var(--border)_65%,transparent)]`}
          aria-label="Version Control"
        >
          <button
            class={ROW}
            aria-label={`Branch: ${branchName() ?? "detached HEAD"}`}
            disabled={props.running || switchingBranch()}
            data-tip={props.running ? "Wait for the turn to finish to switch branches." : undefined}
            aria-haspopup="menu"
            aria-expanded="false"
            onClick={(event) =>
              openBranches({ Row: event.currentTarget, Trigger: event.currentTarget })
            }
            onKeyDown={(event) => {
              const trigger = event.currentTarget;
              openMenuFromKeys(event, () => openBranches({ Row: trigger, Trigger: trigger }));
            }}
          >
            <GitBranch />
            <span class={LABEL}>
              {switchingBranch() ? "Switching…" : (branchName() ?? "Detached HEAD")}
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
                <Show when={busy()} fallback={<QuickActionIcon action={quick()} status={git()} />}>
                  <Spinner aria-hidden="true" />
                </Show>
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
                if (menu() === null) void details.refreshStatus();
                toggleMenu("git", anchor);
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

      <LineageSection threadId={session.state.ThreadId} />

      <Presence when={menu()} keyed>
        {(held) => {
          const open = held();
          return (
            <MenuPopup
              anchor={open.Anchor.Row}
              trigger={open.Anchor.Trigger}
              align={open.Kind === "branch" ? "start" : "end"}
              class="w-(--anchor-width)"
              onClose={closeMenu}
            >
              <Show when={open.Kind === "editor"}>
                <For each={environment.editors().Available}>
                  {(editor) => (
                    <MenuItem onClick={() => openEditor(editor.Id)}>
                      <EditorIcon editor={editor.Id} />
                      <MenuItemLabel>{editor.Label}</MenuItemLabel>
                    </MenuItem>
                  )}
                </For>
              </Show>
              <Show when={open.Kind === "scripts"}>
                <For each={props.scripts}>
                  {(script) => (
                    <MenuItem data-tip={script.command} onClick={() => runScript(script)}>
                      <Play />
                      <MenuItemLabel>{script.name}</MenuItemLabel>
                    </MenuItem>
                  )}
                </For>
                <MenuSeparator />
                <MenuItem onClick={() => setAddingScript(true)}>
                  <Plus />
                  <MenuItemLabel>Add project script</MenuItemLabel>
                </MenuItem>
              </Show>
              <Show when={open.Kind === "git"}>
                <For each={menuItems()}>
                  {(item) => {
                    const reason = () =>
                      menuItemDisabledReason({
                        item,
                        gitStatus: git(),
                        isBusy: busy(),
                        hasPrimaryRemote: git()?.hasPrimaryRemote ?? false,
                      });
                    const row = () => (
                      <MenuItem disabled={item.disabled} onClick={() => runMenuItem(item)}>
                        <MenuIcon item={item} status={git()} />
                        <MenuItemLabel>{item.label}</MenuItemLabel>
                      </MenuItem>
                    );
                    return (
                      <Show when={item.disabled && reason()} fallback={row()}>
                        {(text) => (
                          <span
                            class="block w-full cursor-not-allowed"
                            data-tip={text()}
                            data-tip-side="left"
                          >
                            {row()}
                          </span>
                        )}
                      </Show>
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
              <Show when={open.Kind === "branch"}>
                <MenuSearchInput
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
                  <Show when={loadingBranches() && details.state.Branches === null}>
                    <p class={`${NOTE} text-warning-foreground`}>Loading branches…</p>
                  </Show>
                  <For each={details.state.Branches ?? []}>
                    {(ref) => {
                      const blocked = () => blockedByWorktree(ref, cwd());
                      const row = () => (
                        <MenuItem
                          disabled={blocked()}
                          onClick={() => void details.selectBranch(ref)}
                        >
                          <GitBranch />
                          <MenuItemLabel>{ref.Name}</MenuItemLabel>
                          <Show when={ref.Current ? "current" : ref.IsDefault ? "default" : null}>
                            {(detail) => <MenuItemDetail>{detail()}</MenuItemDetail>}
                          </Show>
                        </MenuItem>
                      );
                      return (
                        <Show when={blocked()} fallback={row()}>
                          <span
                            class="block w-full cursor-not-allowed"
                            data-tip={`Checked out in ${ref.WorktreePath}`}
                            data-tip-side="left"
                          >
                            {row()}
                          </span>
                        </Show>
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
                    <MenuItem onClick={() => void details.createBranch(branchQuery())}>
                      <GitBranchPlus />
                      <MenuItemLabel>Create branch "{branchQuery().trim()}"</MenuItemLabel>
                    </MenuItem>
                  </Show>
                  <Show when={details.state.BranchError}>
                    {(error) => <p class={`${NOTE} text-error-foreground`}>{error()}</p>}
                  </Show>
                </div>
              </Show>
            </MenuPopup>
          );
        }}
      </Presence>

      <Presence when={committing() && git()}>
        {(held) => (
          <CommitDialog
            status={held()}
            onClose={() => setCommitting(false)}
            onCommit={(message, files, featureBranch) =>
              void work.runGitAction(
                {
                  Action: "commit",
                  CommitMessage: message,
                  FilePaths: files,
                  FeatureBranch: featureBranch,
                },
                actionContext(git()),
              )
            }
          />
        )}
      </Presence>

      <Presence when={addingScript()}>
        {() => (
          <AddScriptDialog
            onClose={() => setAddingScript(false)}
            onAdd={(name, command) =>
              void session.saveScripts([
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
        )}
      </Presence>

      <Presence when={pendingCopy()}>
        {(copy) => (
          <Dialog onClose={() => chooseDefaultBranch()}>
            <DialogPopup size="xl">
              <DialogHeader>
                <DialogTitle>{copy().title}</DialogTitle>
                <DialogDescription>{copy().description}</DialogDescription>
                <Show when={featureBranchBlock()}>
                  {(reason) => <p class="text-xs text-muted-foreground">{reason()}</p>}
                </Show>
              </DialogHeader>
              <DialogFooter variant="bare" class="sm:flex-wrap sm:items-center">
                <Button
                  variant="outline"
                  size="sm"
                  class="w-full sm:mr-auto sm:w-auto"
                  onClick={() => chooseDefaultBranch()}
                >
                  Abort
                </Button>
                <Button
                  variant="outline"
                  size="sm-multiline"
                  class="w-full max-w-full sm:w-auto"
                  onClick={() => chooseDefaultBranch("continue")}
                >
                  {copy().continueLabel}
                </Button>
                <Button
                  size="sm-multiline"
                  class="w-full max-w-full sm:w-auto"
                  disabled={featureBranchBlock() !== null}
                  onClick={() => chooseDefaultBranch("featureBranch")}
                >
                  Check out feature branch & continue
                </Button>
              </DialogFooter>
            </DialogPopup>
          </Dialog>
        )}
      </Presence>
    </div>
  );
};

const DetailsCard = ThreadDetails.provider(Body);

export const ThreadDetailsCard = GitWork.provider<IDetailsProps & { details: IThreadDetails }>(
  (props) => {
    const [, card] = splitProps(props, ["state", "details"]);
    return <DetailsCard {...card} state={props.details} />;
  },
);

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
  onMount(() => {
    measure();
    window.addEventListener("resize", measure);
    onCleanup(() => window.removeEventListener("resize", measure));
  });
  return (
    <aside
      ref={setCard}
      class={`w-[280px] overflow-y-auto rounded-[16px] data-[shown=false]:invisible data-[shown=false]:-translate-y-2 data-[shown=false]:opacity-0 in-[.panel-motion]:motion-safe:transition-[translate,opacity,visibility] in-[.panel-motion]:motion-safe:duration-200 in-[.panel-motion]:motion-safe:ease-in-out border border-[color-mix(in_srgb,var(--foreground)_10%,transparent)] bg-[color-mix(in_srgb,var(--popover)_var(--glass-opacity),transparent)] shadow-[0_10px_25px_-5px_rgb(0_0_0/12%)] backdrop-blur-(--glass-blur) backdrop-saturate-(--glass-saturation) ${props.inline ? "absolute top-3 right-3 z-30 max-h-[calc(100%-24px)]" : "fixed z-70 max-h-[min(calc(100dvh-6.5rem),32rem)] max-w-[calc(100vw-16px)]"}`}
      role="region"
      aria-label="Thread details"
      data-shown={props.shown}
      inert={!props.shown}
      style={props.inline ? undefined : { top: `${place().Top}px`, right: `${place().Right}px` }}
    >
      {props.children}
    </aside>
  );
}
