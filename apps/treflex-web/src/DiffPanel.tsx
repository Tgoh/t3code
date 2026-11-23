import {
  repositorySectionForPath,
  turnDiffSections,
} from "@t3tools/client-runtime/state/thread-repositories";
import { createMemo, createSignal, For, type JSX, Match, Show, Switch } from "solid-js";
import { useInFlight } from "treflex-solid";

import { type IDiffPanel, loadDiff } from "./Diff";
import DiffCodeView from "./DiffCodeView";
import {
  diffLineStat,
  fileDiffEntries,
  type IRenderablePatch,
  renderablePatch,
  renderablePatchSections,
} from "./diffRendering";
import Environment from "./Environment";
import {
  ArrowRight,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  FileDiff,
  Pilcrow,
  Rows3,
  TextWrap,
} from "./icons";
import OpenThread, { diffTurns } from "./OpenThread";
import { PanelHeader } from "./RightPanel";
import ThreadSession from "./ThreadSession";
import { shortTimestamp } from "./timestamps";
import { Button } from "./ui/Button";
import {
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  openMenuFromKeys,
} from "./ui/Menu";
import { ADDED_TEXT, DIFF_COUNTS, REMOVED_TEXT } from "./ui/notes";
import { Presence } from "./ui/Presence";
import { RefreshIcon } from "./ui/RefreshIcon";
import { Skeleton } from "./ui/Skeleton";
import { Toggle } from "./ui/Toggle";
import { Toggle as GroupToggle, ToggleGroup } from "./ui/ToggleGroup";

// Follows apps/web/src/components/DiffPanel.tsx and DiffPanelShell.tsx. ThreadView loads this
// module with the first diff, so Pierre's parser and viewer stay out of the main bundle.

const ALL_REPOSITORIES = "__all_repositories__";
const THREAD_FOLDER = "__thread_folder__";
const EMPTY_STATE =
  "flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70";
const NOTICE =
  "shrink-0 border-b border-border/70 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground";
const PICKER_CHEVRON = "size-3.5 shrink-0 opacity-70";

const joinPath = (root: string, path: string) => `${root.replace(/[\\/]+$/, "")}/${path}`;

function Counts(props: { additions: number; deletions: number }) {
  return (
    <span class={DIFF_COUNTS}>
      <span class={ADDED_TEXT}>+{props.additions}</span>{" "}
      <span class={REMOVED_TEXT}>-{props.deletions}</span>
    </span>
  );
}

type ISkeletonWidth = "short" | "medium" | "long";

const FILE_TITLE_WIDTH: Record<ISkeletonWidth, string> = {
  short: "h-3 w-2/5 max-w-52",
  medium: "h-3 w-1/2 max-w-64",
  long: "h-3 w-3/5 max-w-72",
};

const CODE_LINE_WIDTH: Record<ISkeletonWidth, string> = {
  short: "h-2.5 w-3/5",
  medium: "h-2.5 w-2/3",
  long: "h-2.5 w-4/5",
};

function DiffFileHeaderSkeleton(props: { titleWidth: ISkeletonWidth }) {
  return (
    <div class="flex h-8 items-center gap-2 px-2 pr-3">
      <div class="flex size-5 shrink-0 items-center justify-center">
        <Skeleton class="size-2.5" />
      </div>
      <Skeleton class="size-5 shrink-0" />
      <Skeleton shape="pill" class={FILE_TITLE_WIDTH[props.titleWidth]} />
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <Skeleton shape="pill" class="h-3 w-5" />
        <Skeleton shape="pill" class="h-3 w-5" />
      </div>
    </div>
  );
}

function DiffCodeLineSkeleton(props: { width: ISkeletonWidth }) {
  return (
    <div class="flex items-center gap-3">
      <Skeleton shape="pill" class="h-2.5 w-5 shrink-0" />
      <Skeleton shape="pill" class={CODE_LINE_WIDTH[props.width]} />
    </div>
  );
}

export function DiffLoadingState(props: { label: string }) {
  return (
    <div
      class="min-h-0 flex-1 overflow-hidden bg-background"
      role="status"
      aria-live="polite"
      aria-label={props.label}
    >
      <DiffFileHeaderSkeleton titleWidth="medium" />
      <div class="flex h-6 items-center gap-2 px-2 pr-3">
        <div class="h-px flex-1 bg-border/40" />
        <Skeleton shape="pill" class="h-2.5 w-24" />
        <div class="h-px flex-1 bg-border/40" />
      </div>
      <div class="space-y-2 px-3 py-2">
        <DiffCodeLineSkeleton width="medium" />
        <DiffCodeLineSkeleton width="long" />
        <DiffCodeLineSkeleton width="short" />
      </div>
      <DiffFileHeaderSkeleton titleWidth="short" />
      <DiffFileHeaderSkeleton titleWidth="long" />
      <span class="sr-only">{props.label}</span>
    </div>
  );
}

function Picker(props: {
  label: string;
  ariaLabel: string;
  variant: "secondary" | "ghost-muted";
  class?: string;
  menuClass?: string;
  children: (close: () => void) => JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  return (
    <>
      <Button
        ref={setTrigger}
        size="xs"
        variant={props.variant}
        class={props.class}
        aria-label={props.ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
        onKeyDown={(event) => openMenuFromKeys(event, () => setOpen(true))}
      >
        <span class="truncate">{props.label}</span>
        <ChevronDown class={PICKER_CHEVRON} />
      </Button>
      <Presence when={open() && trigger()}>
        {(anchor) => (
          <MenuPopup
            anchor={anchor()}
            align="start"
            class={props.menuClass ?? ""}
            onClose={() => setOpen(false)}
          >
            {props.children(() => setOpen(false))}
          </MenuPopup>
        )}
      </Presence>
    </>
  );
}

export function DiffPanel(props: { panel: IDiffPanel }) {
  const session = ThreadSession.use();
  const thread = OpenThread.use();
  const environment = Environment.use();
  const panel = () => props.panel;
  const settings = () => session.diffSettings();
  const turns = createMemo(() => diffTurns(thread.state));
  const gitRepositories = () => session.diffGitRepositories();
  const gitRepository = () =>
    gitRepositories().Repositories.find(
      (repository) => repository.RepositoryPath === panel().GitRepository,
    ) ?? null;
  const latestTurn = () => turns()[0]?.TurnCount ?? null;
  const [wrapOverride, setWrapOverride] = createSignal<boolean | null>(null);
  const wrap = () => wrapOverride() ?? environment.wordWrap();
  const folderName = () => session.projectName() ?? "Project folder";

  const sections = createMemo(() =>
    panel().Scope === "turn" && panel().Text !== null
      ? turnDiffSections(
          { diff: panel().Text ?? "", repositories: panel().Repositories },
          folderName(),
        )
      : [],
  );
  // Sections only matter when a repository changed; otherwise the turn has its one patch.
  const repositorySections = () =>
    sections().some((section) => section.repositoryPath !== null) ? sections() : [];
  const selectedSection = () =>
    repositorySections().find((section) => section.key === panel().Repository) ?? null;
  const patch = createMemo((): IRenderablePatch | null => {
    const cacheScope = `diff-panel:${environment.colorScheme()}`;
    const shown = selectedSection() === null ? repositorySections() : [selectedSection()!];
    if (shown.length > 0) {
      return renderablePatchSections(
        shown.map((section) => ({
          Key: section.key,
          RelativePath: section.relativePath,
          Diff: section.diff,
        })),
        cacheScope,
      );
    }
    return renderablePatch(panel().Text, cacheScope);
  });
  const entries = createMemo(() => {
    const held = patch();
    return held?.Kind === "files" ? fileDiffEntries(held.Files) : [];
  });
  const collapsedOf = (key: string) => panel().Collapsed[key] ?? settings().FilesCollapsed;
  const shownFiles = createMemo(() =>
    entries().map((entry) => ({ Entry: entry, Collapsed: collapsedOf(entry.Key) })),
  );
  const allCollapsed = () =>
    shownFiles().length > 0 && shownFiles().every((file) => file.Collapsed);
  const stat = createMemo(() => diffLineStat(entries().map((entry) => entry.FileDiff)));

  const scopeLabel = () => {
    const held = panel();
    if (held.Scope === "branch") return "Changes";
    if (held.Scope === "unstaged") return "Uncommitted";
    if (held.TurnCount !== null && held.TurnCount === latestTurn()) return "Latest turn";
    return `Turn ${held.TurnCount ?? "?"}`;
  };
  const scopeValue = () => {
    const held = panel();
    if (held.Scope !== "turn") return held.Scope;
    return held.TurnCount === latestTurn() ? "latest" : `turn:${held.TurnCount}`;
  };
  const chooseScope = (value: string) => {
    if (value === "branch" || value === "unstaged") void session.openDiff(value, null);
    else if (value === "latest") void session.openDiff("turn", null);
    else if (value.startsWith("turn:")) void session.openDiff("turn", Number(value.slice(5)));
  };
  const toggleFile = (key: string) => void session.setDiffFilesCollapsed([key], !collapsedOf(key));
  // Follows `repositoryFileTarget` and `openDiffFile` in stock's DiffPanel.tsx.
  const fileTarget = (path: string, projectRoot: string) => {
    const repository = gitScope() ? gitRepository() : null;
    if (repository !== null) return joinPath(repository.Cwd, path);
    const match = repositorySectionForPath(repositorySections(), path);
    if (match === null) return joinPath(session.diffRepositoryRoot() ?? projectRoot, path);
    const cwd = gitRepositories().Repositories.find(
      (held) => held.RepositoryPath === match.section.repositoryPath,
    )?.Cwd;
    return cwd === undefined ? joinPath(projectRoot, path) : joinPath(cwd, match.path);
  };
  const openFile = (path: string) => {
    const projectRoot = session.fileSearchRoot();
    if (projectRoot === null) return;
    void environment.openInEditor(fileTarget(path, projectRoot), projectRoot);
  };
  // Follows `comparisonHeadRef` and `comparisonBaseRef` in stock's DiffPanel.tsx.
  const headRef = () =>
    panel().HeadRef ?? (gitRepository() === null ? thread.state.Thread?.branch : null) ?? "HEAD";
  const baseRef = () => panel().BaseRef ?? "Automatic";
  const refreshing = useInFlight(loadDiff, () => props.panel);
  const gitScope = () => panel().Scope !== "turn";

  return (
    <>
      <PanelHeader closeLabel="Close diff" onClose={() => session.closeDiff()}>
        <span class="inline-flex h-6 items-center gap-1 rounded-lg bg-accent px-2 text-[12px] font-medium [&_svg]:size-3.5">
          <FileDiff />
          Diff
        </span>
      </PanelHeader>
      <div
        class="@container/diff-header flex h-10 min-h-10 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background px-4"
        data-surface-subheader
      >
        <div class="@container/diff-refs flex min-w-0 flex-1 items-center gap-3">
          <Picker
            label={scopeLabel()}
            ariaLabel={`Diff scope: ${scopeLabel()}`}
            variant="secondary"
            class={repositorySections().length > 0 ? "max-w-full min-w-14 shrink" : "max-w-full"}
          >
            {(close) => (
              <>
                <MenuRadioGroup
                  value={scopeValue()}
                  onValueChange={(value) => {
                    close();
                    chooseScope(value);
                  }}
                >
                  <MenuRadioItem value="branch">Changes</MenuRadioItem>
                  <MenuRadioItem value="unstaged">Uncommitted</MenuRadioItem>
                  <MenuRadioItem value="latest">Latest turn</MenuRadioItem>
                </MenuRadioGroup>
                <MenuSub>
                  <MenuSubTrigger>Turn</MenuSubTrigger>
                  <MenuSubPopup>
                    <MenuRadioGroup
                      value={panel().Scope === "turn" ? `turn:${panel().TurnCount}` : ""}
                      onValueChange={(value) => {
                        close();
                        chooseScope(value);
                      }}
                    >
                      <For each={turns()}>
                        {(turn) => (
                          <MenuRadioItem value={`turn:${turn.TurnCount}`}>
                            <span class="flex items-center gap-2">
                              <span>Turn {turn.TurnCount}</span>
                              <span class="ml-auto text-xs text-muted-foreground tabular-nums">
                                {shortTimestamp(turn.CompletedAt, environment.timestampFormat())}
                              </span>
                            </span>
                          </MenuRadioItem>
                        )}
                      </For>
                    </MenuRadioGroup>
                  </MenuSubPopup>
                </MenuSub>
              </>
            )}
          </Picker>
          <Show when={gitScope() && gitRepositories().Repositories.length > 0}>
            <Picker
              label={gitRepository()?.Name ?? folderName()}
              ariaLabel={`Repository: ${gitRepository()?.Name ?? folderName()}`}
              variant="ghost-muted"
              class="max-w-48 min-w-14 shrink"
              menuClass="max-h-80 max-w-72"
            >
              {(close) => (
                <MenuRadioGroup
                  value={gitRepository()?.RepositoryPath ?? THREAD_FOLDER}
                  onValueChange={(value) => {
                    close();
                    void session.selectDiffGitRepository(value === THREAD_FOLDER ? null : value);
                  }}
                >
                  <Show when={gitRepositories().FolderIsRepository}>
                    <MenuRadioItem value={THREAD_FOLDER}>
                      <span class="min-w-0 truncate">{folderName()}</span>
                    </MenuRadioItem>
                  </Show>
                  <For each={gitRepositories().Repositories}>
                    {(repository) => (
                      <MenuRadioItem value={repository.RepositoryPath}>
                        <span class="min-w-0 truncate">{repository.Name}</span>
                      </MenuRadioItem>
                    )}
                  </For>
                </MenuRadioGroup>
              )}
            </Picker>
          </Show>
          <Show when={repositorySections().length > 0}>
            <Picker
              label={selectedSection()?.name ?? "All repositories"}
              ariaLabel={`Repository: ${selectedSection()?.name ?? "All repositories"}`}
              variant="ghost-muted"
              class="max-w-48 min-w-14 shrink"
              menuClass="max-h-80 max-w-72"
            >
              {(close) => (
                <MenuRadioGroup
                  value={selectedSection()?.key ?? ALL_REPOSITORIES}
                  onValueChange={(value) => {
                    close();
                    void session.selectDiffRepository(value === ALL_REPOSITORIES ? null : value);
                  }}
                >
                  <MenuRadioItem value={ALL_REPOSITORIES}>All repositories</MenuRadioItem>
                  <For each={repositorySections()}>
                    {(section) => (
                      <MenuRadioItem value={section.key}>
                        <span class="flex min-w-0 items-center gap-3">
                          <span class="min-w-0 truncate">{section.name}</span>
                          <Show
                            when={
                              section.relativePath !== "" && section.relativePath !== section.name
                            }
                          >
                            <span class="ml-auto min-w-0 truncate text-xs text-muted-foreground">
                              {section.relativePath}
                            </span>
                          </Show>
                        </span>
                      </MenuRadioItem>
                    )}
                  </For>
                </MenuRadioGroup>
              )}
            </Picker>
          </Show>
          <Show when={panel().Scope === "branch"}>
            <span
              class="flex max-w-full min-w-0 items-center gap-2 overflow-hidden text-xs text-muted-foreground"
              aria-label={`Comparing ${headRef()} against ${baseRef()}`}
              data-tip={`${headRef()} → ${baseRef()}`}
            >
              <span class="max-w-48 min-w-0 truncate @max-[20rem]/diff-refs:hidden">
                {headRef()}
              </span>
              <ArrowRight class="size-3.5 shrink-0 opacity-70 @max-[20rem]/diff-refs:hidden" />
              <span class="hidden @max-[20rem]/diff-refs:inline">vs</span>
              <span class="max-w-48 min-w-0 truncate">{baseRef()}</span>
            </span>
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <Show when={shownFiles().length > 0}>
            <span
              class={
                repositorySections().length > 0
                  ? "contents @max-[30rem]/diff-header:hidden"
                  : "contents"
              }
            >
              <span class="mr-1 text-[10px]">
                <Counts additions={stat().additions} deletions={stat().deletions} />
              </span>
            </span>
          </Show>
          <Show when={gitScope()}>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={refreshing() ? "Refreshing diff" : "Refresh diff"}
              data-tip={refreshing() ? "Refreshing diff…" : "Refresh diff"}
              onClick={() => session.refreshDiff()}
            >
              <RefreshIcon size="sm" refreshing={refreshing()} />
            </Button>
          </Show>
          <Show when={shownFiles().length > 0}>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={allCollapsed() ? "Expand all files" : "Collapse all files"}
              data-tip={allCollapsed() ? "Expand all files" : "Collapse all files"}
              onClick={() =>
                void session.setDiffFilesCollapsed(
                  shownFiles().map((file) => file.Entry.Key),
                  !allCollapsed(),
                )
              }
            >
              <Show when={allCollapsed()} fallback={<ChevronsDownUp class="size-3.5" />}>
                <ChevronsUpDown class="size-3.5" />
              </Show>
            </Button>
          </Show>
          <span
            class={
              repositorySections().length > 0
                ? "contents @max-[30rem]/diff-header:hidden"
                : "contents"
            }
          >
            <ToggleGroup
              aria-label="Diff layout"
              class="shrink-0"
              variant="segmented"
              value={[settings().Split ? "split" : "stacked"]}
              onValueChange={(value) => {
                const next = value[0];
                if (next === "stacked" || next === "split") {
                  void environment.writeSetting({ Store: "client", Patch: { diffLayout: next } });
                }
              }}
            >
              <GroupToggle aria-label="Stacked diff view" value="stacked">
                <Rows3 class="size-3.5" />
              </GroupToggle>
              <GroupToggle aria-label="Split diff view" value="split">
                <Columns2 class="size-3.5" />
              </GroupToggle>
            </ToggleGroup>
          </span>
          <Toggle
            variant="ghost"
            size="sm"
            pressed={wrap()}
            aria-label={wrap() ? "Disable diff line wrapping" : "Enable diff line wrapping"}
            data-tip={wrap() ? "Disable line wrapping" : "Enable line wrapping"}
            onClick={() => setWrapOverride(!wrap())}
          >
            <TextWrap class="size-3.5" />
          </Toggle>
          <Toggle
            variant="ghost"
            size="sm"
            pressed={panel().IgnoreWhitespace}
            aria-label={
              panel().IgnoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"
            }
            data-tip={
              panel().IgnoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"
            }
            onClick={() => session.toggleDiffWhitespace()}
          >
            <Pilcrow class="size-3.5" />
          </Toggle>
        </div>
      </div>
      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <Show when={panel().Truncated === true}>
          <p class={NOTICE}>This preview exceeds the size limit. Changes shown are incomplete.</p>
        </Show>
        <Show when={panel().Error}>
          <div class="px-3 pt-2">
            <p class="mb-2 text-[11px] text-error/80">{panel().Error}</p>
          </div>
        </Show>
        <Switch>
          <Match when={panel().Scope === "turn" && turns().length === 0 && panel().Text !== null}>
            <div class={EMPTY_STATE}>No completed turns yet.</div>
          </Match>
          <Match when={patch()?.Kind === "files"}>
            <div class="min-h-0 min-w-0 flex-1">
              <DiffCodeView
                files={shownFiles()}
                split={settings().Split}
                wrap={wrap()}
                scheme={environment.colorScheme()}
                onToggle={toggleFile}
                onOpen={openFile}
              />
            </div>
          </Match>
          <Match when={patch()} keyed>
            {(raw) =>
              raw.Kind === "raw" ? (
                <div class="min-h-0 flex-1 overflow-auto p-2">
                  <div class="space-y-2">
                    <p class="text-[11px] text-muted-foreground/75">{raw.Reason}</p>
                    <pre
                      class="max-h-[72vh] overflow-auto rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90 data-wrap:whitespace-pre-wrap data-wrap:wrap-break-word"
                      data-wrap={wrap() ? "" : undefined}
                    >
                      {raw.Text}
                    </pre>
                  </div>
                </div>
              ) : null
            }
          </Match>
          <Match when={panel().Text === null && panel().Error === undefined}>
            <DiffLoadingState
              label={
                panel().Scope === "turn"
                  ? "Loading checkpoint diff..."
                  : panel().Scope === "unstaged"
                    ? "Loading uncommitted changes..."
                    : "Loading changes..."
              }
            />
          </Match>
          <Match when={panel().Text !== null}>
            <div class={EMPTY_STATE}>
              <p>No net changes in this selection.</p>
            </div>
          </Match>
          <Match when={panel().Error !== undefined}>
            <div class={EMPTY_STATE}>
              <p>No patch available for this selection.</p>
            </div>
          </Match>
        </Switch>
      </div>
    </>
  );
}

export default DiffPanel;
