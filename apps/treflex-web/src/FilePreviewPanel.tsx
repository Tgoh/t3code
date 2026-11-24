// @effect-diagnostics globalTimers:off -- A view-only reset of the copied icon, outside any Effect runtime.
import { type AssetResource, ThreadId } from "@t3tools/contracts";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { filePreviewKind } from "@t3tools/shared/filePreview";
import { maskMarkdownFrontmatter } from "@t3tools/shared/markdownFrontmatter";
import { fileBasename, isHostPath, workspaceRelativeFilePath } from "@t3tools/shared/path";
import type { JSX } from "@solidjs/web";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  Show,
  Switch,
  untrack,
} from "solid-js";
import { useComponentState } from "treflex-solid";

import { copyText } from "./clipboard";
import Environment from "./Environment";
import FileCodeView from "./FileCodeView";
import type { IFilePanel, IFileRead, IFileSource } from "./FilePanel";
import {
  attachmentCopyLabel,
  attachmentNeedsText,
  fileBreadcrumbs,
  isMarkdownPreviewFile,
  type IWorkspaceMediaKind,
  markdownBaseDir,
  readErrorMessage,
  renderedToggleLabel,
  followRevision,
  type IPlaybackSource,
  playerErrorFails,
  playerSource,
  revisionedUrl,
  videoFailed,
  workspaceCopyable,
  workspaceMediaKind,
} from "./filePreview";
import {
  Check,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Eye,
  Maximize,
  Minus,
  Plus,
  RotateCw,
  Scan,
  TextWrap,
  TriangleAlert,
} from "./icons";
import { ImageDialog } from "./ImageDialog";
import { FileIcon, Markdown, useMediaUrl } from "./Markdown";
import {
  EMPTY_MEDIA_URL,
  type IMediaUrl,
  prepareVideoFirstFrame,
  retryMediaUrl,
} from "./markdownImage";
import OpenThread from "./OpenThread";
import { PanelHeader } from "./RightPanel";
import ThreadSession from "./ThreadSession";
import { Button } from "./ui/Button";
import { Presence } from "./ui/Presence";
import { cleanupRef } from "./ui/cleanupRef";
import { ScrollArea } from "./ui/ScrollArea";
import { Spinner } from "./ui/Spinner";
import { toastManager } from "./ui/toastStore";
import { Toggle } from "./ui/Toggle";

// Follows apps/web/src/components/files/FilePreviewPanel.tsx, AttachmentFilePreview.tsx,
// fileSurfaceChrome.tsx, FileBreadcrumbs.tsx, PreviewImageContent.tsx and AudioPreview.tsx, and the
// file tab of apps/web/src/components/RightPanelTabs.tsx. ThreadView loads this module with the
// first file, so Pierre's viewer stays out of the main bundle.

const SUBHEADER =
  "flex h-10 min-h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3";
const NOTICE =
  "shrink-0 border-b border-warning/20 bg-warning-surface px-3 py-1.5 text-2xs text-warning-foreground";
const CRUMB_SEPARATOR = "mx-1 size-3.5 shrink-0 text-muted-foreground/60";
const CENTERED = "flex min-h-0 flex-1 items-center justify-center text-muted-foreground";
const COPIED_MS = 2_000;
// decodeFilePreviewText's refusal in @t3tools/shared/filePreview, which stock's fetch of the file hits.
const BINARY_TEXT = "This file contains binary data and cannot be shown as text.";
const TRUNCATED_NOTICE = (bytes: number) =>
  `Preview limited to the first 1 MB of a ${bytes.toLocaleString()} byte file.`;

function SurfaceAction(props: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: JSX.Element;
}) {
  return (
    <Show
      when={props.pressed !== undefined}
      fallback={
        <Button
          variant="ghost"
          size="icon-sm"
          class="shrink-0"
          aria-label={props.label}
          data-tip={props.label}
          disabled={props.disabled ?? false}
          onClick={() => props.onPress()}
        >
          {props.children}
        </Button>
      }
    >
      <Toggle
        variant="ghost"
        size="sm"
        class="shrink-0"
        pressed={props.pressed === true}
        aria-label={props.label}
        data-tip={props.label}
        disabled={props.disabled ?? false}
        onClick={() => props.onPress()}
      >
        {props.children}
      </Toggle>
    </Show>
  );
}

function CopyAction(props: { text: string; label: string }) {
  const [copied, setCopied] = createSignal(false);
  const copy = async () => {
    if (!(await copyText(props.text))) {
      toastManager.add({
        type: "error",
        title: "Could not copy file",
        description: "Clipboard API unavailable.",
      });
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  };
  return (
    <SurfaceAction label={copied() ? "Copied" : props.label} onPress={() => void copy()}>
      <Show when={copied()} fallback={<Copy class="size-3.5" />}>
        <Check class="size-3.5" />
      </Show>
    </SurfaceAction>
  );
}

function SurfaceLoading() {
  return (
    <div role="status" aria-label="Loading file" class={CENTERED}>
      <Spinner size="lg" />
    </div>
  );
}

function SurfaceFailure(props: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-xs leading-relaxed"
    >
      <p class="text-destructive">{props.message}</p>
      <Show when={props.onRetry}>
        {(retry) => (
          <button
            type="button"
            onClick={() => retry()()}
            class="cursor-pointer rounded-md border border-input px-2.5 py-1 text-xs text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            Try again
          </button>
        )}
      </Show>
    </div>
  );
}

function RenderedMarkdown(props: {
  text: string;
  cwd: string | undefined;
  baseDir: string | undefined;
}) {
  return (
    <ScrollArea class="min-h-0 flex-1">
      <div class="mx-auto max-w-4xl px-6 py-5">
        <Markdown
          text={maskMarkdownFrontmatter(props.text)}
          fromUser={false}
          files={{ Cwd: props.cwd, BaseDir: props.baseDir }}
        />
      </div>
    </ScrollArea>
  );
}

function SourceView(props: {
  name: string;
  text: string;
  wrap: boolean;
  revealLine: number | null;
  revealId: number;
  revealedId: number | null;
  onRevealed: (id: number) => void;
}) {
  const environment = Environment.use();
  return (
    <FileCodeView
      name={props.name}
      text={props.text}
      wrap={props.wrap}
      scheme={environment.colorScheme()}
      revealLine={props.revealLine}
      revealId={props.revealId}
      revealedId={props.revealedId}
      onRevealed={props.onRevealed}
    />
  );
}

function PreviewImage(props: { src: string; name: string; onError: () => void }) {
  const [failed, setFailed] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const [natural, setNatural] = createSignal({ Width: 0, Height: 0 });
  const [viewport, setViewport] = createSignal({ Width: 0, Height: 0 });
  const [zoom, setZoom] = createSignal<number | null>(null);
  const observe = cleanupRef((node: HTMLDivElement) => {
    const update = () => setViewport({ Width: node.clientWidth, Height: node.clientHeight });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  });
  const fit = () => {
    const { Width: width, Height: height } = natural();
    if (width === 0) return 1;
    const room = viewport();
    return Math.min(
      1,
      Math.max(1, room.Width - 32) / width,
      Math.max(1, room.Height - 32) / height,
    );
  };
  const scale = () => zoom() ?? fit();
  const changeZoom = (factor: number) => setZoom(Math.max(0.05, Math.min(8, scale() * factor)));
  return (
    <Show when={!failed()} fallback={<SurfaceFailure message="Unable to load image." />}>
      <div class="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-1 text-xs text-muted-foreground">
        <span class="tabular-nums">
          {natural().Width
            ? `${natural().Width.toLocaleString()} × ${natural().Height.toLocaleString()}`
            : "Loading image…"}
        </span>
        <div class="flex items-center gap-1">
          <SurfaceAction
            label="Zoom out"
            disabled={!natural().Width || scale() <= 0.05}
            onPress={() => changeZoom(1 / 1.25)}
          >
            <Minus class="size-3.5" />
          </SurfaceAction>
          <span class="min-w-10 text-center tabular-nums">{Math.round(scale() * 100)}%</span>
          <SurfaceAction
            label="Zoom in"
            disabled={!natural().Width || scale() >= 8}
            onPress={() => changeZoom(1.25)}
          >
            <Plus class="size-3.5" />
          </SurfaceAction>
          <SurfaceAction label="Fit image" pressed={zoom() === null} onPress={() => setZoom(null)}>
            <Scan class="size-3.5" />
          </SurfaceAction>
          <SurfaceAction
            label="Actual image size"
            pressed={zoom() === 1}
            onPress={() => setZoom(1)}
          >
            <Maximize class="size-3.5" />
          </SurfaceAction>
        </div>
      </div>
      <div ref={observe} class="min-h-0 flex-1 overflow-auto">
        <div
          class="flex min-h-full min-w-full items-center justify-center p-4"
          style={
            natural().Width
              ? {
                  width: `${natural().Width * scale() + 32}px`,
                  height: `${natural().Height * scale() + 32}px`,
                }
              : undefined
          }
        >
          <button
            type="button"
            aria-label={`Zoom ${props.name}`}
            class="shrink-0 cursor-zoom-in"
            onClick={() => setExpanded(true)}
          >
            <img
              src={props.src}
              alt={props.name}
              class="block max-w-none"
              style={
                natural().Width
                  ? {
                      width: `${natural().Width * scale()}px`,
                      height: `${natural().Height * scale()}px`,
                    }
                  : { "max-width": "100%" }
              }
              onLoad={(event) =>
                setNatural({
                  Width: event.currentTarget.naturalWidth,
                  Height: event.currentTarget.naturalHeight,
                })
              }
              onError={() => {
                setFailed(true);
                props.onError();
              }}
            />
          </button>
        </div>
      </div>
      <Presence when={expanded()}>
        {() => <ImageDialog src={props.src} alt={props.name} onClose={() => setExpanded(false)} />}
      </Presence>
    </Show>
  );
}

type IMediaKind = IWorkspaceMediaKind;

function useSignedMedia(resource: AssetResource, kind: IMediaKind, revision: () => number) {
  const media = useMediaUrl(resource);
  // Follows WorkspaceVideoPreview and WorkspaceAudioPreview, which sign the URL again on each
  // workspace change.
  createEffect(
    revision,
    () => {
      if (kind !== "image") void media.reload();
    },
    { defer: true },
  );
  const latest = () =>
    media.state.Url === null
      ? null
      : revisionedUrl(
          media.state.Url,
          kind === "image" ? null : media.state.FileRevision,
          revision(),
        );
  const revisionKey = () =>
    media.state.FileRevision ?? (revision() === 0 ? null : String(revision()));
  return { media, latest, revisionKey };
}

// Follows WorkspaceImagePreview in apps/web/src/components/files/FilePreviewPanel.tsx.
function SignedImage(props: { resource: AssetResource; name: string; revision: number }) {
  const { media, latest } = useSignedMedia(
    untrack(() => props.resource),
    "image",
    () => props.revision,
  );
  const [erroredSrc, setErroredSrc] = createSignal<string | null>(null);
  const failed = () => media.state.Failed || (latest() !== null && erroredSrc() === latest());
  return (
    <Show
      when={!failed()}
      fallback={
        <SurfaceFailure
          message="Unable to load workspace image."
          onRetry={() => {
            setErroredSrc(null);
            void media.retry();
          }}
        />
      }
    >
      <Show when={latest()} keyed fallback={<SurfaceLoading />}>
        {(src) => (
          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <PreviewImage src={src} name={props.name} onError={media.failed} />
          </div>
        )}
      </Show>
    </Show>
  );
}

// Follows MediaVideoPlayer in apps/web/src/components/media/MediaVideoPlayer.tsx, as
// WorkspaceVideoPreview uses it.
function SignedVideo(props: { resource: AssetResource; name: string; revision: number }) {
  const { media, latest, revisionKey } = useSignedMedia(
    untrack(() => props.resource),
    "video",
    () => props.revision,
  );
  const [playing, setPlaying] = createSignal(false);
  // Written by the player's events, and moved on by a revision change while paused.
  const [playback, setPlayback] = createSignal<IPlaybackSource | null>((held) =>
    followRevision({
      held: held ?? null,
      latest: latest(),
      revision: revisionKey(),
      sourceFailed: media.state.Failed,
      playing: playing(),
    }),
  );
  const [failedSrc, setFailedSrc] = createSignal<string | null>(null);
  const [retrying, setRetrying] = createSignal(false);
  const [attempt, setAttempt] = createSignal(0);
  const src = () => playerSource(playback(), latest());
  const sourceRevision = () => {
    const held = playback();
    return held === null ? revisionKey() : held.Revision;
  };
  const failed = () => videoFailed(src(), failedSrc(), media.state.Failed);
  const retry = async () => {
    if (retrying()) return;
    setRetrying(true);
    await media.retry();
    if (media.state.Failed) setFailedSrc(src());
    else {
      setPlayback(null);
      setFailedSrc(null);
      setAttempt(attempt() + 1);
    }
    setRetrying(false);
  };
  const mount = createMemo(() => ({ Attempt: attempt() }));
  return (
    <div class="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
      <span class="relative flex h-full min-h-0 w-full max-w-5xl items-center justify-center align-middle">
        <Switch
          fallback={
            <span
              role="status"
              aria-label="Loading video"
              class="block aspect-video w-full rounded-lg bg-muted/60"
            />
          }
        >
          <Match when={failed()}>
            <span
              role="alert"
              class="flex aspect-video max-h-full w-full flex-col items-center justify-center gap-3 rounded-lg border border-border/40 bg-muted/40 p-4 text-center text-sm text-muted-foreground"
            >
              <span class="inline-flex items-center gap-1.5">
                <TriangleAlert aria-hidden="true" class="size-3.5 shrink-0" />
                {["Video unavailable", props.name].filter(Boolean).join(" · ")}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={retrying()}
                onClick={() => void retry()}
              >
                <RotateCw />
                {retrying() ? "Retrying…" : "Retry video"}
              </Button>
            </span>
          </Match>
          <Match when={src() !== null}>
            <Show when={mount()} keyed>
              {(_attempt) => (
                <video
                  src={src()!}
                  aria-label={props.name || "Video preview"}
                  controls
                  playsinline
                  preload="metadata"
                  class="aspect-auto max-h-full w-auto max-w-full bg-black object-contain"
                  onLoadedMetadata={(event) => {
                    prepareVideoFirstFrame(event.currentTarget);
                    const revision = sourceRevision();
                    if (revision !== null) setPlayback({ Src: src()!, Revision: revision });
                  }}
                  onPlay={() => {
                    setPlaying(true);
                    setPlayback({ Src: src()!, Revision: sourceRevision() });
                  }}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  onError={() => {
                    const shown = src()!;
                    setPlaying(false);
                    setPlayback(null);
                    if (playerErrorFails(shown, latest())) setFailedSrc(shown);
                  }}
                />
              )}
            </Show>
          </Match>
        </Switch>
      </span>
    </div>
  );
}

// Follows WorkspaceAudioPreview in apps/web/src/components/files/FilePreviewPanel.tsx and
// StandardAudioPreview in AudioPreview.tsx.
function SignedAudio(props: { resource: AssetResource; name: string; revision: number }) {
  const { media, latest, revisionKey } = useSignedMedia(
    untrack(() => props.resource),
    "audio",
    () => props.revision,
  );
  const [playing, setPlaying] = createSignal(false);
  const [loaded, setLoaded] = createSignal<IPlaybackSource | null>((held) =>
    followRevision({
      held: held ?? null,
      latest: latest(),
      revision: revisionKey(),
      sourceFailed: false,
      playing: playing(),
    }),
  );
  const [failedUrl, setFailedUrl] = createSignal<string | null>(null);
  const failed = () => media.state.Failed || (latest() !== null && failedUrl() === latest());
  const src = () => playerSource(loaded(), latest());
  return (
    <Show
      when={!failed()}
      fallback={
        <SurfaceFailure
          message="Unable to load audio."
          onRetry={() => {
            setFailedUrl(null);
            void media.retry();
          }}
        />
      }
    >
      <Show when={src() !== null} fallback={<SurfaceLoading />}>
        <div class="flex min-h-0 flex-1 items-center justify-center p-6">
          <audio
            class="w-full max-w-xl"
            src={src()!}
            aria-label={props.name}
            controls
            preload="metadata"
            onLoadedMetadata={() => {
              const revision = revisionKey();
              if (revision !== null && loaded() === null)
                setLoaded({ Src: src()!, Revision: revision });
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => {
              const shown = src()!;
              setPlaying(false);
              setLoaded(null);
              if (shown === latest()) setFailedUrl(shown);
            }}
          />
        </div>
      </Show>
    </Show>
  );
}

function SignedMedia(props: {
  kind: IMediaKind;
  resource: AssetResource;
  name: string;
  /** The workspace changes seen since the file opened; 0 for an attachment. */
  revision: number;
}) {
  return (
    <Switch>
      <Match when={props.kind === "image"}>
        <SignedImage resource={props.resource} name={props.name} revision={props.revision} />
      </Match>
      <Match when={props.kind === "video"}>
        <SignedVideo resource={props.resource} name={props.name} revision={props.revision} />
      </Match>
      <Match when={props.kind === "audio"}>
        <SignedAudio resource={props.resource} name={props.name} revision={props.revision} />
      </Match>
    </Switch>
  );
}

// Follows `save` in apps/web/src/components/files/AttachmentFilePreview.tsx and
// WorkspacePdfSaveAction in FilePreviewPanel.tsx: each press signs again, so an expired URL or a
// rewritten file never downloads the server's error page.
function SaveAction(props: { resource: AssetResource; name: string }) {
  const environment = Environment.use();
  const signing = useComponentState<IMediaUrl>(() => ({ ...EMPTY_MEDIA_URL }));
  const [saving, setSaving] = createSignal(false);
  const save = async () => {
    setSaving(true);
    try {
      await signing.dispatch(
        retryMediaUrl,
        environment.state.EnvironmentId,
        untrack(() => props.resource),
      );
      const url = signing.state.Url;
      if (signing.state.Failed || url === null) {
        throw new Error("Reconnect to the environment and try again.");
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error("The file could not be loaded. Try again.");
      const downloadUrl = URL.createObjectURL(await response.blob());
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 30_000);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = props.name.split(/[\\/]/).at(-1) || props.name;
      anchor.click();
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not save file",
        description: cause instanceof Error ? cause.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <SurfaceAction
      label={saving() ? "Preparing file…" : "Save file"}
      disabled={saving()}
      onPress={() => void save()}
    >
      <Download class="size-3.5" />
    </SurfaceAction>
  );
}

function NoPreview(props: { name: string }) {
  const extension = () => {
    const dot = props.name.lastIndexOf(".");
    return dot < 0 ? "" : props.name.slice(dot + 1);
  };
  return (
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
      <p class="text-sm font-medium">No preview for this file</p>
      <p class="max-w-sm text-xs leading-relaxed text-muted-foreground">
        {extension()
          ? `Save it to open in an app that supports ${extension()} files.`
          : "Save it to open in an app that supports this format files."}
      </p>
    </div>
  );
}

/** A file read from its signed URL: a sent attachment, or a workspace file the server won't read as text. */
function AttachmentView(props: {
  name: string;
  mimeType: string;
  sizeBytes: number;
  origin: string;
  resource: AssetResource;
  read: IFileRead | null;
  onRetry: () => void;
}) {
  const environment = Environment.use();
  const kind = () => filePreviewKind({ name: props.name, mimeType: props.mimeType });
  const needsText = () => attachmentNeedsText(kind());
  const text = () => (props.read?.Kind === "attachment" ? props.read : null);
  const failure = () => (needsText() && props.read?.Kind === "failed" ? props.read.Message : null);
  const [rendered, setRendered] = createSignal(true);
  const [wrapOverride, setWrapOverride] = createSignal<boolean | null>(null);
  const wrap = () => wrapOverride() ?? environment.wordWrap();
  const markdownRendered = () => kind() === "markdown" && rendered();
  const download = (): AssetResource =>
    props.resource._tag === "attachment"
      ? { ...props.resource, disposition: "attachment" }
      : props.resource;
  const media = (): IMediaKind | null =>
    kind() === "image" || kind() === "video" || kind() === "audio" ? (kind() as IMediaKind) : null;
  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div class={SUBHEADER} data-surface-subheader>
        <div class="flex min-w-0 flex-1 items-center text-xs">
          <span class="shrink-0 px-0.5 text-muted-foreground">{props.origin}</span>
          <ChevronRight class={CRUMB_SEPARATOR} />
          <span aria-current="page" class="min-w-0 truncate px-0.5 font-medium text-foreground">
            {props.name}
          </span>
          <Show when={props.sizeBytes > 0}>
            <span class="ml-2 shrink-0 text-muted-foreground">
              {formatAttachmentSize(props.sizeBytes)}
            </span>
          </Show>
        </div>
        <Show when={kind() === "markdown"}>
          <SurfaceAction
            label={renderedToggleLabel(rendered())}
            pressed={rendered()}
            onPress={() => setRendered(!rendered())}
          >
            <Show when={rendered()} fallback={<Eye class="size-3.5" />}>
              <Code2 class="size-3.5" />
            </Show>
          </SurfaceAction>
        </Show>
        <Show when={failure() === null && text() !== null && !markdownRendered()}>
          <SurfaceAction
            label={wrap() ? "Disable word wrap" : "Enable word wrap"}
            pressed={wrap()}
            onPress={() => setWrapOverride(!wrap())}
          >
            <TextWrap class="size-3.5" />
          </SurfaceAction>
        </Show>
        <Show when={text()}>
          {(held) => (
            <CopyAction text={held().Text} label={attachmentCopyLabel(false, held().Truncated)} />
          )}
        </Show>
        <SaveAction resource={download()} name={props.name} />
      </div>
      <Show when={text()?.Truncated}>
        <div role="status" class={NOTICE}>
          {props.sizeBytes > 0
            ? `Preview limited to the first 1 MB of a ${props.sizeBytes.toLocaleString()} byte file. Save the file to read it in full.`
            : "Preview limited to the first 1 MB. Save the file to read it in full."}
        </div>
      </Show>
      <Switch fallback={<NoPreview name={props.name} />}>
        <Match when={failure()}>
          {(message) => <SurfaceFailure message={message()} onRetry={props.onRetry} />}
        </Match>
        <Match when={needsText() && text() === null}>
          <SurfaceLoading />
        </Match>
        <Match when={text()}>
          {(held) => (
            <Show
              when={markdownRendered()}
              fallback={
                <SourceView
                  name={props.name}
                  text={held().Text}
                  wrap={wrap()}
                  revealLine={null}
                  revealId={0}
                  revealedId={0}
                  onRevealed={() => undefined}
                />
              }
            >
              <RenderedMarkdown text={held().Text} cwd={undefined} baseDir={undefined} />
            </Show>
          )}
        </Match>
        <Match when={media()}>
          {(held) => (
            <SignedMedia kind={held()} resource={props.resource} name={props.name} revision={0} />
          )}
        </Match>
      </Switch>
    </div>
  );
}

function Breadcrumbs(props: { projectName: string; path: string }) {
  const crumbs = () => fileBreadcrumbs(props.projectName, props.path);
  const [list, setList] = createSignal<HTMLOListElement>();
  // Follows the crumb scroll in FilePreviewPanel.tsx: the deepest crumb shows when it fits, but
  // never at the cost of the current one.
  createEffect(
    () => [list(), crumbs()] as const,
    ([element]) => {
      if (element === undefined) return;
      element.lastElementChild?.scrollIntoView({ block: "nearest", inline: "end" });
      element
        .querySelector("[aria-current='page']")
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
  );
  return (
    <ScrollArea radius="none" hideScrollbars scrollFade class="min-w-0 flex-1">
      <nav aria-label="File path" class="flex h-full w-max min-w-full items-center text-xs">
        <ol ref={setList} class="flex items-center">
          <For each={crumbs()}>
            {(crumb, index) => {
              const current = () => index() === crumbs().length - 1;
              return (
                <li class="flex min-w-0 shrink-0 items-center">
                  <span
                    class="block max-w-40 truncate rounded-sm px-0.5 text-muted-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground"
                    aria-current={current() ? "page" : undefined}
                    data-tip={crumb.Path || props.projectName}
                  >
                    {crumb.Label}
                  </span>
                  <Show when={!current()}>
                    <ChevronRight aria-hidden="true" class={CRUMB_SEPARATOR} />
                  </Show>
                </li>
              );
            }}
          </For>
        </ol>
      </nav>
    </ScrollArea>
  );
}

function WorkspaceFile(props: {
  panel: IFilePanel;
  source: Extract<IFileSource, { Kind: "workspace" }>;
}) {
  const environment = Environment.use();
  const session = ThreadSession.use();
  const thread = OpenThread.use();
  const path = () => props.source.Path;
  const absolute = () => resolvePathLinkTarget(path(), props.source.Cwd);
  const mediaKind = () => workspaceMediaKind(path());
  const hostFile = () => isHostPath(path());
  const read = () => props.panel.Read;
  const text = () => {
    const held = read();
    return held?.Kind === "text" ? held : null;
  };
  const readError = () => {
    const held = read();
    return held?.Kind === "error" ? held : null;
  };
  const failed = () => {
    const held = read();
    return held?.Kind === "failed" ? held.Message : null;
  };
  const binary = () => readError()?.Failure === "binary_file";
  const markdown = () => isMarkdownPreviewFile(path());
  const [handledReveal, setHandledReveal] = createSignal<number | null>(null);
  const [revealedId, setRevealedId] = createSignal<number | null>(null);
  const revealHandled = () =>
    props.panel.RevealLine === null || handledReveal() === props.panel.RevealId;
  const rendered = () => environment.state.Local.Preferences.RenderMarkdown && revealHandled();
  const markdownRendered = () => markdown() && rendered();
  const [wrapOverride, setWrapOverride] = createSignal<boolean | null>(null);
  const wrap = () => wrapOverride() ?? environment.wordWrap();
  const copyable = () => workspaceCopyable(text(), mediaKind() !== null);
  const projectName = () => session.projectName() ?? "Project folder";
  const toggleRendered = () => {
    const next = !rendered();
    void environment.setPreferences({ RenderMarkdown: next });
    setHandledReveal(next ? props.panel.RevealId : null);
  };
  const threadId = () => ThreadId.make(thread.state.ThreadId);
  // The server signs `workspace-file` only below the workspace root.
  const mediaResource = (kind: IMediaKind): AssetResource => ({
    _tag:
      kind === "image" && workspaceRelativeFilePath(absolute(), props.source.Cwd) !== null
        ? "workspace-file"
        : "media-file",
    threadId: threadId(),
    path: absolute(),
  });
  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div class={SUBHEADER} data-surface-subheader>
        <Breadcrumbs projectName={projectName()} path={path()} />
        <Show when={markdown()}>
          <SurfaceAction
            label={renderedToggleLabel(rendered())}
            pressed={rendered()}
            onPress={toggleRendered}
          >
            <Show when={rendered()} fallback={<Eye class="size-3.5" />}>
              <Code2 class="size-3.5" />
            </Show>
          </SurfaceAction>
        </Show>
        <Show when={text() !== null && !markdownRendered()}>
          <SurfaceAction
            label={wrap() ? "Disable word wrap" : "Enable word wrap"}
            pressed={wrap()}
            onPress={() => setWrapOverride(!wrap())}
          >
            <TextWrap class="size-3.5" />
          </SurfaceAction>
        </Show>
        <Show when={copyable()}>
          {(held) => <CopyAction text={held()} label="Copy contents" />}
        </Show>
      </div>
      <Show when={mediaKind() === null && text()?.Truncated}>
        <div class={NOTICE}>{TRUNCATED_NOTICE(text()!.ByteLength)}</div>
      </Show>
      <Switch>
        <Match when={mediaKind()} keyed>
          {(kind) => (
            <SignedMedia
              kind={kind}
              resource={mediaResource(kind)}
              name={path()}
              revision={props.panel.Revision}
            />
          )}
        </Match>
        <Match when={binary()}>
          <AttachmentView
            name={fileBasename(path()) || path()}
            mimeType="application/octet-stream"
            sizeBytes={0}
            origin="File"
            resource={{
              _tag: "media-file",
              threadId: threadId(),
              path: absolute(),
              disposition: "attachment",
            }}
            read={{ Kind: "failed", Message: BINARY_TEXT }}
            onRetry={() => void session.reloadFile()}
          />
        </Match>
        <Match when={readError()}>
          {(error) => (
            <div role="alert" class="flex min-h-0 flex-1 flex-col overflow-auto">
              <div class="my-auto flex shrink-0 flex-col gap-3 px-6 py-6 text-center text-xs leading-relaxed">
                <p class="text-destructive">{readErrorMessage(error())}</p>
                <Show when={error().AttemptedPath}>
                  {(attempted) => (
                    <p class="text-muted-foreground">
                      Attempted path
                      <code class="block font-mono break-all text-foreground select-all">
                        {attempted()}
                      </code>
                    </p>
                  )}
                </Show>
                <Show when={!hostFile()}>
                  <p class="text-muted-foreground">
                    Workspace folder:{" "}
                    <code class="font-mono break-all select-all">
                      {error().Cwd ?? props.source.Cwd}
                    </code>
                    . Check the link's path or locate the file in Files.
                  </p>
                </Show>
              </div>
            </div>
          )}
        </Match>
        <Match when={failed()}>
          {(message) => (
            <SurfaceFailure message={message()} onRetry={() => void session.reloadFile()} />
          )}
        </Match>
        <Match when={text()}>
          {(held) => (
            <Show
              when={markdownRendered()}
              fallback={
                <SourceView
                  name={path()}
                  text={held().Contents}
                  wrap={wrap()}
                  revealLine={props.panel.RevealLine}
                  revealId={props.panel.RevealId}
                  revealedId={revealedId()}
                  onRevealed={setRevealedId}
                />
              }
            >
              <RenderedMarkdown
                text={held().Contents}
                cwd={props.source.Cwd}
                baseDir={markdownBaseDir(path(), props.source.Cwd)}
              />
            </Show>
          )}
        </Match>
        <Match when={true}>
          <SurfaceLoading />
        </Match>
      </Switch>
    </div>
  );
}

export function FilePreviewPanel(props: { panel: IFilePanel }) {
  const session = ThreadSession.use();
  const name = () => {
    const source = props.panel.Source;
    return source.Kind === "attachment" ? source.Name : fileBasename(source.Path) || source.Path;
  };
  return (
    <>
      <PanelHeader closeLabel="Close file" onClose={() => session.closeFile()}>
        <span class="inline-flex h-6 min-w-0 items-center gap-1 rounded-lg bg-accent px-2 text-[12px] font-medium">
          <FileIcon path={name()} class="size-3.5 shrink-0" />
          <span class="truncate">{name()}</span>
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Add panel surface"
          data-tip="Add panel surface"
          onClick={() => session.openLauncher()}
        >
          <Plus />
        </Button>
      </PanelHeader>
      <Switch>
        <Match when={props.panel.Source.Kind === "workspace" ? props.panel.Source : null} keyed>
          {(source) => <WorkspaceFile panel={props.panel} source={source} />}
        </Match>
        <Match when={props.panel.Source.Kind === "attachment" ? props.panel.Source : null} keyed>
          {(source) => (
            <AttachmentView
              name={source.Name}
              mimeType={source.MimeType}
              sizeBytes={source.SizeBytes}
              origin="Attachment"
              resource={{
                _tag: "attachment",
                attachmentId: source.Id,
                fileName: source.Name,
                mimeType: source.MimeType,
                disposition: "inline",
              }}
              read={props.panel.Read}
              onRetry={() => void session.reloadFile()}
            />
          )}
        </Match>
      </Switch>
    </>
  );
}

export default FilePreviewPanel;
