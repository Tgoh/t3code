import type { AssetResource } from "@t3tools/contracts";
import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";
import type { Token, Tokens } from "marked";
import {
  type Component,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  Index,
  onMount,
  Show,
  useContext,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import { useComponentState } from "treflex-solid";

import { ProjectBadge } from "./brand";
import {
  cachedHighlight,
  fenceOf,
  highlight,
  type IFence,
  isPlainLanguage,
  isSettled,
} from "./codeHighlight";
import { ensureFileIconSprite, fileIconFor, hasSpecificIcon, languageFileName } from "./fileIcons";
import {
  chipLabel,
  fileLinkFromCode,
  fileLinkFromHref,
  fileLinkPathsKey,
  type IFileLink,
  isEditorLinkHref,
  labelNamesFile,
  parentSuffixes,
  prosePathParts,
} from "./fileLinks";
import { CopyButton } from "./CopyButton";
import Environment from "./Environment";
import { LoaderCircle, MessagesSquare, RefreshCw, TriangleAlert, WrapText } from "./icons";
import { ImageDialog, MEDIA_DIALOG_FIT, MediaDialog } from "./ImageDialog";
import type { IAssetUrl } from "./Infrastructure/commandEffects";
import {
  type IMediaKind,
  type IMediaTarget,
  type IMediaUrl,
  imageSizeStyle,
  loadMediaUrl,
  markdownImageTarget,
  mediaLinkTarget,
  opensInEditor,
  prepareVideoFirstFrame,
  sameTarget,
  webMediaLinkTarget,
} from "./markdownImage";
import { assistantHtml, blockTokens, containsHtml, createMarkdownLexer } from "./markdownTokens";
import OpenThread from "./OpenThread";
import { EXTERNAL_LINK, sanitizeHtml, THREAD_LINK, THREAD_LINK_UNAVAILABLE } from "./sanitize";
import ThreadSession from "./ThreadSession";
import { Button } from "./ui/Button";
import { Presence } from "./ui/Presence";
import {
  contextThreadTarget,
  type ILinkTarget,
  type ISentMessage,
  type IThreadTitle,
  threadLinkTarget,
} from "./userMessage";
import { useWorkspaceRoot } from "./workspaceRoot";

interface ITokenProps {
  token: Token;
}

const FILE_LINK =
  "group/file inline-block max-w-full cursor-pointer overflow-x-clip rounded-sm border-0 bg-transparent p-0 align-bottom font-medium text-ellipsis whitespace-nowrap text-(--file-link) [text-align:inherit] focus-visible:outline-current";

const CODE_ICON = "size-3.5 shrink-0";

const IMAGE_BORDER = "border border-[color-mix(in_srgb,var(--border)_40%,transparent)]";

// The .chat-markdown prose rules style every pre, including the highlighter's markup in here.
const CODE_BLOCK =
  "my-[0.65rem] overflow-hidden rounded-lg border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-secondary text-start leading-snug [.chat-markdown>&:first-child]:mt-0 [.chat-markdown>&:last-child]:mb-0 [&_pre]:m-0 [&_pre]:rounded-none [&_pre]:border-0 [&_pre]:bg-transparent data-[wrap=true]:[&_pre]:whitespace-pre-wrap data-[wrap=true]:[&_pre]:wrap-anywhere";

const decoder = document.createElement("textarea");
ensureFileIconSprite();

// Marked leaves entities in text for its HTML output, and a text node would show them literally.
function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  decoder.innerHTML = text;
  return decoder.value;
}

const of = <T,>(props: ITokenProps) => props.token as unknown as T;

const plainText = (tokens: Token[] | undefined): string =>
  (tokens ?? [])
    .map((token) =>
      "tokens" in token && token.tokens
        ? plainText(token.tokens)
        : "text" in token
          ? token.text
          : "",
    )
    .join("");

function Inline(props: { tokens: Token[] | undefined }) {
  return (
    <Index each={props.tokens}>
      {(token) => <Dynamic component={INLINE[token().type] ?? TextToken} token={token()} />}
    </Index>
  );
}

interface IFileLinks {
  cwd: () => string | undefined;
  suffixes: () => ReadonlyMap<string, string>;
  // Text inside a link already belongs to it, so its paths don't become chips.
  inLink: boolean;
}

const FileLinkContext = createContext<IFileLinks>({
  cwd: () => undefined,
  suffixes: () => new Map(),
  inLink: false,
});

function FileIcon(props: { path: string; class: string }) {
  const icon = () => fileIconFor(props.path);
  return (
    <svg
      aria-hidden="true"
      class={props.class}
      style={{ color: `light-dark(${icon().Light}, ${icon().Dark})` }}
      viewBox="0 0 16 16"
    >
      <use href={`#${icon().Name}`} />
    </svg>
  );
}

// Follows MarkdownFileLink in apps/web/src/components/chat/MarkdownFileLink.tsx. Stock opens a
// workspace file in its Files panel, which this client doesn't have, so a workspace media file
// opens in the viewer like any other and the rest open in the editor.
function FileChip(props: { link: IFileLink }) {
  const environment = Environment.use();
  const thread = OpenThread.use();
  const files = useContext(FileLinkContext);
  const media = createMemo(
    () => mediaLinkTarget(props.link, files.cwd(), thread.state.Thread?.id),
    undefined,
    { equals: sameTarget },
  );
  const [viewing, setViewing] = createSignal<IMediaTarget | null>(null);
  return (
    <>
      <button
        type="button"
        class={FILE_LINK}
        dir="ltr"
        data-tip={props.link.TargetPath}
        onClick={(event) => {
          event.stopPropagation();
          const held = media();
          if (held !== null && !opensInEditor(event)) setViewing(held);
          else environment.openInEditor(props.link.TargetPath, files.cwd() ?? null);
        }}
      >
        <FileIcon
          path={props.link.FilePath}
          class="mr-[0.2em] inline size-[1em] align-[-0.125em]"
        />
        <span class="underline decoration-transparent decoration-1 underline-offset-[0.2em] transition-[text-decoration-color] duration-150 ease-[ease] group-hover/file:decoration-current">
          {chipLabel(props.link, files.suffixes())}
        </span>
      </button>
      <Presence when={viewing()} keyed>
        {(held) => (
          <MediaViewer
            target={held()}
            name={chipLabel(props.link, files.suffixes())}
            onClose={() => setViewing(null)}
          />
        )}
      </Presence>
    </>
  );
}

function ProseText(props: { text: string }) {
  const files = useContext(FileLinkContext);
  const parts = createMemo(() => (files.inLink ? [props.text] : prosePathParts(props.text)));
  return (
    <Show when={parts().length > 1} fallback={props.text}>
      <Index each={parts()}>
        {(part) => {
          const held = part();
          if (typeof held === "string") return held;
          const link = fileLinkFromHref(held.Path, files.cwd());
          return link === null ? held.Path : <FileChip link={link} />;
        }}
      </Index>
    </Show>
  );
}

function TextToken(props: ITokenProps) {
  const text = () => of<Tokens.Text>(props);
  return (
    <Show when={text().tokens} fallback={<ProseText text={decodeEntities(text().text)} />}>
      {(tokens) => <Inline tokens={tokens()} />}
    </Show>
  );
}

function LiteralToken(props: ITokenProps) {
  return <>{of<Tokens.Tag>(props).text}</>;
}

function CodeSpanToken(props: ITokenProps) {
  const files = useContext(FileLinkContext);
  const text = () => of<Tokens.Codespan>(props).text;
  const link = createMemo(() => (files.inLink ? null : fileLinkFromCode(text(), files.cwd())));
  return (
    <Show when={link()} fallback={<code>{text()}</code>}>
      {(held) => <FileChip link={held()} />}
    </Show>
  );
}

function StrongToken(props: ITokenProps) {
  return (
    <strong>
      <Inline tokens={of<Tokens.Strong>(props).tokens} />
    </strong>
  );
}

function EmToken(props: ITokenProps) {
  return (
    <em>
      <Inline tokens={of<Tokens.Em>(props).tokens} />
    </em>
  );
}

function DelToken(props: ITokenProps) {
  return (
    <del>
      <Inline tokens={of<Tokens.Del>(props).tokens} />
    </del>
  );
}

function BrToken() {
  return <br />;
}

// The message whose context records name the thread chips in its text.
const MessageContext = createContext<ISentMessage | null>(null);

function useThreadTitle(): IThreadTitle {
  const environment = Environment.use();
  return (threadId) => environment.state.Replica.Shell.Threads[threadId]?.title;
}

function ThreadChip(props: { target: ILinkTarget }) {
  const environment = Environment.use();
  return (
    <Show
      when={"Ref" in props.target && props.target.Openable ? props.target : null}
      fallback={
        <span
          class={THREAD_LINK_UNAVAILABLE}
          data-tip={"Unknown" in props.target ? props.target.Unknown : "Thread on another machine"}
        >
          <MessagesSquare />
          {"Unknown" in props.target ? props.target.Unknown : props.target.Title}
        </span>
      }
    >
      {(target) => {
        const project = () => {
          const shell = environment.state.Replica.Shell;
          const projectId = shell.Threads[target().Ref.threadId]?.projectId;
          return projectId === undefined ? undefined : shell.Projects[projectId];
        };
        return (
          <button
            type="button"
            class={`${THREAD_LINK} group/link`}
            aria-label={`Thread, ${target().Title}`}
            data-tip="Open thread"
            onClick={() => environment.selectThread(target().Ref.threadId)}
          >
            <Show when={project()} fallback={<MessagesSquare />}>
              {(held) => <ProjectBadge project={held()} />}
            </Show>
            <span class="underline decoration-transparent decoration-1 underline-offset-[0.2em] transition-[text-decoration-color] duration-150 ease-[ease] group-hover/link:decoration-current">
              {target().Title}
            </span>
          </button>
        );
      }}
    </Show>
  );
}

function LinkToken(props: ITokenProps) {
  const link = () => of<Tokens.Link>(props);
  const environment = Environment.use();
  const message = useContext(MessageContext);
  const title = useThreadTitle();
  const thread = createMemo((): ILinkTarget | null => {
    const { href, text } = link();
    // An autolink's text is its own URL, which is no label.
    const label = text.trim() && parseThreadLinkHref(text) === null ? text : null;
    const environmentId = environment.state.EnvironmentId;
    return (
      contextThreadTarget(href, message, environmentId, title) ??
      threadLinkTarget(href, label, environmentId, title)
    );
  });
  const files = useContext(FileLinkContext);
  const file = createMemo(() => fileLinkFromHref(link().href, files.cwd()));
  const [viewing, setViewing] = createSignal<IMediaTarget | null>(null);
  const inner = () => (
    <FileLinkContext.Provider value={{ ...files, inLink: true }}>
      <Inline tokens={link().tokens} />
    </FileLinkContext.Provider>
  );
  return (
    <Show
      when={thread()}
      fallback={
        <Show
          when={file()}
          fallback={
            <Show
              when={EXTERNAL_LINK.test(link().href) || isEditorLinkHref(link().href)}
              fallback={<a data-tip={link().href}>{inner()}</a>}
            >
              <a
                href={link().href}
                {...(EXTERNAL_LINK.test(link().href)
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                onClick={(event) => {
                  const media = webMediaLinkTarget(link().href);
                  if (
                    media === null ||
                    event.defaultPrevented ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  setViewing(media);
                }}
              >
                {inner()}
              </a>
              <Presence when={viewing()} keyed>
                {(held) => (
                  <MediaViewer
                    target={held()}
                    name={plainText(link().tokens) || link().href}
                    onClose={() => setViewing(null)}
                  />
                )}
              </Presence>
            </Show>
          }
        >
          {(held) => (
            <Show
              when={!labelNamesFile(plainText(link().tokens), link().href)}
              fallback={<FileChip link={held()} />}
            >
              <span>{inner()} </span>
              <FileChip link={held()} />
            </Show>
          )}
        </Show>
      }
    >
      {(target) => <ThreadChip target={target()} />}
    </Show>
  );
}

const UNAVAILABLE_LABEL: Record<IMediaKind, string> = {
  image: "Image unavailable",
  video: "Video unavailable",
  audio: "Audio unavailable",
};

function ImageUnavailable(props: { alt: string; kind?: IMediaKind }) {
  return (
    <span class="inline-flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:shrink-0">
      <TriangleAlert />
      {[UNAVAILABLE_LABEL[props.kind ?? "image"], props.alt].filter(Boolean).join(" · ")}
    </span>
  );
}

function useMediaUrl(resource: AssetResource) {
  const environment = Environment.use();
  const local = useComponentState<IMediaUrl>(() => ({ Url: null, Size: null, Failed: false }));
  const load = () => local.dispatch(loadMediaUrl, environment.state.EnvironmentId, resource);
  onMount(load);
  return { state: local.state, reload: load };
}

const MEDIA_PLACEHOLDER = `rounded-lg ${IMAGE_BORDER} bg-[color-mix(in_srgb,var(--muted)_60%,transparent)]`;

// Follows MediaVideoPlayer in apps/web/src/components/media/MediaVideoPlayer.tsx.
function ShownVideo(props: {
  src: string | null;
  sourceFailed: boolean;
  alt: string;
  onRetry: () => void;
}) {
  const [erroredSrc, setErroredSrc] = createSignal<string | null>(null);
  const failed = () => props.sourceFailed || (props.src !== null && erroredSrc() === props.src);
  return (
    <span class="inline-block w-full max-w-[min(100%,30rem)] align-top">
      <Show
        when={!failed()}
        fallback={
          <span
            role="alert"
            class={`flex aspect-video w-full flex-col items-center justify-center gap-3 p-4 text-center text-[0.75rem] text-muted-foreground ${MEDIA_PLACEHOLDER}`}
          >
            <ImageUnavailable alt={props.alt} kind="video" />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setErroredSrc(null);
                props.onRetry();
              }}
            >
              <RefreshCw />
              Retry video
            </Button>
          </span>
        }
      >
        <Show
          when={props.src}
          keyed
          fallback={
            <span
              role="status"
              aria-label="Loading video"
              class={`block aspect-video w-full ${MEDIA_PLACEHOLDER}`}
            />
          }
        >
          {(src) => (
            <video
              class={`block aspect-video max-h-[30rem] w-full bg-black object-contain ${MEDIA_PLACEHOLDER}`}
              src={src}
              aria-label={props.alt || "Video preview"}
              controls
              playsinline
              preload="metadata"
              onLoadedMetadata={(event) => prepareVideoFirstFrame(event.currentTarget)}
              onError={() => setErroredSrc(src)}
            />
          )}
        </Show>
      </Show>
    </span>
  );
}

// Follows InlineAudioPreview in apps/web/src/components/files/InlineAudioPreview.tsx.
function ShownAudio(props: { src: string | null; sourceFailed: boolean; alt: string }) {
  const [erroredSrc, setErroredSrc] = createSignal<string | null>(null);
  const failed = () => props.sourceFailed || (props.src !== null && erroredSrc() === props.src);
  return (
    <Show
      when={!failed()}
      fallback={
        <span
          role="alert"
          class={`inline-block rounded-md ${IMAGE_BORDER} bg-[color-mix(in_srgb,var(--muted)_40%,transparent)] px-2 py-1 text-[0.75rem] text-muted-foreground`}
        >
          <ImageUnavailable alt={props.alt} kind="audio" />
        </span>
      }
    >
      <Show when={props.src} keyed fallback={<span role="status" aria-label="Loading audio" />}>
        {(src) => (
          <audio
            class="inline-block h-10 w-full max-w-[min(100%,30rem)] align-middle"
            src={src}
            aria-label={props.alt || "Audio preview"}
            controls
            preload="metadata"
            onError={() => setErroredSrc(src)}
          />
        )}
      </Show>
    </Show>
  );
}

function FileMedia(props: {
  kind: IMediaKind;
  resource: AssetResource;
  fragment: string;
  alt: string;
  standalone: boolean;
}) {
  const media = useMediaUrl(props.resource);
  const src = () => (media.state.Url === null ? null : media.state.Url + props.fragment);
  return (
    <Show
      when={props.kind === "image"}
      fallback={
        <Show
          when={props.kind === "video"}
          fallback={<ShownAudio src={src()} sourceFailed={media.state.Failed} alt={props.alt} />}
        >
          <ShownVideo
            src={src()}
            sourceFailed={media.state.Failed}
            alt={props.alt}
            onRetry={() => void media.reload()}
          />
        </Show>
      }
    >
      <ShownImage
        src={src()}
        sourceFailed={media.state.Failed}
        size={media.state.Size}
        alt={props.alt}
        standalone={props.standalone}
      />
    </Show>
  );
}

function ViewerContent(props: {
  kind: IMediaKind;
  src: string | null;
  failed: boolean;
  name: string;
}) {
  const [erroredSrc, setErroredSrc] = createSignal<string | null>(null);
  const failed = () => props.failed || (props.src !== null && erroredSrc() === props.src);
  const keep = (event: MouseEvent) => event.stopPropagation();
  return (
    <Show
      when={!failed()}
      fallback={
        <span
          role="alert"
          class="flex max-w-[min(28rem,calc(100vw-32px))] cursor-default flex-col gap-1 rounded-lg bg-popover p-4 text-[13px] text-muted-foreground"
          onClick={keep}
        >
          <ImageUnavailable alt={props.name} kind={props.kind} />
          The file could not be loaded. It may have been moved or deleted.
        </span>
      }
    >
      <Show
        when={props.src}
        keyed
        fallback={
          <LoaderCircle
            role="status"
            aria-label="Loading media"
            class="size-6 animate-spin text-white/80"
          />
        }
      >
        {(src) =>
          props.kind === "video" ? (
            <video
              class={`${MEDIA_DIALOG_FIT} cursor-default bg-black`}
              src={src}
              aria-label={props.name}
              controls
              playsinline
              preload="metadata"
              onClick={keep}
              onLoadedMetadata={(event) => prepareVideoFirstFrame(event.currentTarget)}
              onError={() => setErroredSrc(src)}
            />
          ) : (
            <img
              class={MEDIA_DIALOG_FIT}
              src={src}
              alt={props.name}
              onError={() => setErroredSrc(src)}
            />
          )
        }
      </Show>
    </Show>
  );
}

function FileViewerContent(props: { kind: IMediaKind; resource: AssetResource; name: string }) {
  const media = useMediaUrl(props.resource);
  return (
    <ViewerContent
      kind={props.kind}
      src={media.state.Url}
      failed={media.state.Failed}
      name={props.name}
    />
  );
}

// Follows resolveMarkdownMediaPreview in apps/web/src/components/chat/ExpandedImagePreview.tsx,
// showing a failure in the viewer rather than a toast.
function MediaViewer(props: { target: IMediaTarget; name: string; onClose: () => void }) {
  return (
    <MediaDialog onClose={props.onClose}>
      {"Direct" in props.target ? (
        <ViewerContent
          kind={props.target.Kind}
          src={props.target.Direct}
          failed={false}
          name={props.name}
        />
      ) : (
        <FileViewerContent
          kind={props.target.Kind}
          resource={props.target.Resource}
          name={props.name}
        />
      )}
    </MediaDialog>
  );
}

// Follows ChatMarkdownImage in apps/web/src/components/chat/ChatMarkdownMedia.tsx.
function ShownImage(props: {
  src: string | null;
  sourceFailed: boolean;
  size: IAssetUrl["Size"] | null;
  alt: string;
  standalone: boolean;
}) {
  const [loaded, setLoaded] = createSignal(false);
  const [errored, setErrored] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const failed = () => props.sourceFailed || errored();
  const settled = () => props.src !== null && !failed() && (!props.standalone || loaded());
  const style = () => imageSizeStyle(props.size);
  const events = {
    onLoad: () => setLoaded(true),
    onError: () => setErrored(true),
  };
  const expand = (event: Event) => {
    if ((event.currentTarget as Element).closest("a")) return;
    event.preventDefault();
    event.stopPropagation();
    setExpanded(true);
  };
  return (
    <Show
      when={settled() ? props.src : null}
      fallback={
        <Show
          when={props.standalone}
          fallback={
            <Show when={failed()} fallback={<span role="status" aria-label="Loading image" />}>
              <span
                class={`inline-block rounded-md ${IMAGE_BORDER} bg-[color-mix(in_srgb,var(--muted)_40%,transparent)] px-2 py-1 text-[0.75rem] text-muted-foreground`}
              >
                <ImageUnavailable alt={props.alt} />
              </span>
            </Show>
          }
        >
          <span
            class={`relative inline-block aspect-video w-full max-w-[min(100%,30rem)] overflow-hidden rounded-lg ${IMAGE_BORDER} bg-[color-mix(in_srgb,var(--muted)_60%,transparent)] align-top`}
            style={style()}
            role={failed() ? "alert" : "status"}
            aria-label={failed() ? undefined : "Loading image"}
          >
            <Show
              when={failed()}
              fallback={
                <Show when={props.src}>
                  {(src) => (
                    <img
                      class="invisible absolute inset-0 size-full"
                      src={src()}
                      alt=""
                      {...events}
                    />
                  )}
                </Show>
              }
            >
              <span class="flex h-full items-center justify-center p-2 text-center text-[0.75rem] text-muted-foreground">
                <ImageUnavailable alt={props.alt} />
              </span>
            </Show>
          </span>
        </Show>
      }
    >
      {(src) => (
        <>
          <img
            class={`h-auto max-h-[30rem] w-auto max-w-[min(100%,30rem)] cursor-zoom-in rounded-lg ${IMAGE_BORDER} object-contain`}
            src={src()}
            alt={props.alt}
            style={style()}
            decoding="async"
            loading="lazy"
            draggable={false}
            role="button"
            tabIndex={0}
            aria-label={`Preview ${props.alt.trim() || "image"}`}
            onClick={expand}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") expand(event);
            }}
            {...events}
          />
          <Presence when={expanded()}>
            {() => <ImageDialog src={src()} alt={props.alt} onClose={() => setExpanded(false)} />}
          </Presence>
        </>
      )}
    </Show>
  );
}

function MarkdownImage(props: { token: Tokens.Image; standalone: boolean }) {
  const thread = OpenThread.use();
  const workspaceRoot = useWorkspaceRoot();
  const target = createMemo(
    () => markdownImageTarget(props.token.href, workspaceRoot(), thread.state.Thread?.id),
    undefined,
    { equals: sameTarget },
  );
  return (
    <Show when={target()} keyed fallback={props.token.text}>
      {(held) =>
        "Resource" in held ? (
          <FileMedia
            kind={held.Kind}
            resource={held.Resource}
            fragment={held.Fragment}
            alt={props.token.text}
            standalone={props.standalone}
          />
        ) : held.Kind === "video" ? (
          <ShownVideo
            src={held.Direct}
            sourceFailed={false}
            alt={props.token.text}
            onRetry={() => {}}
          />
        ) : held.Kind === "audio" ? (
          <ShownAudio src={held.Direct} sourceFailed={false} alt={props.token.text} />
        ) : (
          <ShownImage
            src={held.Direct}
            sourceFailed={false}
            size={null}
            alt={props.token.text}
            standalone={props.standalone}
          />
        )
      }
    </Show>
  );
}

function ImageToken(props: ITokenProps) {
  return <MarkdownImage token={of<Tokens.Image>(props)} standalone={false} />;
}

const INLINE: Record<string, Component<ITokenProps>> = {
  codespan: CodeSpanToken,
  strong: StrongToken,
  em: EmToken,
  del: DelToken,
  br: BrToken,
  link: LinkToken,
  image: ImageToken,
  html: LiteralToken,
  escape: LiteralToken,
};

function Blocks(props: { tokens: Token[]; loose?: boolean }) {
  const blocks = createMemo(() => blockTokens(props.tokens, props.loose));
  return (
    <Index each={blocks()}>
      {(token) => <Dynamic component={BLOCK[token().type] ?? TextToken} token={token()} />}
    </Index>
  );
}

function ParagraphToken(props: ITokenProps) {
  const tokens = () => of<Tokens.Paragraph>(props).tokens;
  const alone = () => {
    const shown = tokens().filter((token) => token.type !== "text" || token.raw.trim() !== "");
    return shown.length === 1 && shown[0]!.type === "image" ? (shown[0] as Tokens.Image) : null;
  };
  return (
    <p>
      <Show when={alone()} fallback={<Inline tokens={tokens()} />}>
        {(image) => <MarkdownImage token={image()} standalone />}
      </Show>
    </p>
  );
}

function HeadingToken(props: ITokenProps) {
  const heading = () => of<Tokens.Heading>(props);
  return (
    <Dynamic component={`h${heading().depth}`}>
      <Inline tokens={heading().tokens} />
    </Dynamic>
  );
}

function BlockquoteToken(props: ITokenProps) {
  return (
    <blockquote>
      <Blocks tokens={of<Tokens.Blockquote>(props).tokens} />
    </blockquote>
  );
}

function HrToken() {
  return <hr />;
}

function HtmlBlockToken(props: ITokenProps) {
  return <p>{of<Tokens.HTML>(props).text}</p>;
}

function ListItem(props: { item: Tokens.ListItem }) {
  return (
    <li>
      <Show when={props.item.task}>
        <input type="checkbox" checked={props.item.checked === true} disabled />{" "}
      </Show>
      <Blocks tokens={props.item.tokens} loose={props.item.loose} />
    </li>
  );
}

function ListToken(props: ITokenProps) {
  const list = () => of<Tokens.List>(props);
  const lastNumber = () => Number(list().start || 1) + list().items.length - 1;
  return (
    <Dynamic
      component={list().ordered ? "ol" : "ul"}
      start={list().ordered && list().start !== 1 ? list().start : undefined}
      classList={{ "wide-markers": list().ordered && lastNumber() >= 10 }}
    >
      <Index each={list().items}>{(item) => <ListItem item={item()} />}</Index>
    </Dynamic>
  );
}

function TableCell(props: { cell: Tokens.TableCell; tag: "th" | "td" }) {
  return (
    <Dynamic
      component={props.tag}
      style={props.cell.align === null ? undefined : { "text-align": props.cell.align }}
    >
      <Inline tokens={props.cell.tokens} />
    </Dynamic>
  );
}

function TableToken(props: ITokenProps) {
  const table = () => of<Tokens.Table>(props);
  return (
    <table>
      <thead>
        <tr>
          <Index each={table().header}>{(cell) => <TableCell cell={cell()} tag="th" />}</Index>
        </tr>
      </thead>
      <tbody>
        <Index each={table().rows}>
          {(row) => (
            <tr>
              <Index each={row()}>{(cell) => <TableCell cell={cell()} tag="td" />}</Index>
            </tr>
          )}
        </Index>
      </tbody>
    </table>
  );
}

// Hands each code block in a top-level block the next key in document order. A message's blocks
// remount as its turn settles and as the timeline windows, so the session keeps a keyed block's
// wrap choice.
const CodeBlockKey = createContext<() => string | null>(() => null);

function CodeTitle(props: { fence: IFence }) {
  const languageFile = () => languageFileName(props.fence.Language);
  return (
    <span class="inline-flex min-w-0 items-center gap-1.5 font-mono text-[11px] whitespace-nowrap">
      <Show
        when={props.fence.Title}
        fallback={
          <Show when={hasSpecificIcon(languageFile())} fallback={props.fence.Language}>
            <span
              class="inline-flex"
              aria-label={`Language: ${props.fence.Language}`}
              data-tip={props.fence.Language}
            >
              <FileIcon path={languageFile()} class={CODE_ICON} />
            </span>
          </Show>
        }
      >
        {(title) => (
          <>
            <FileIcon path={title()} class={CODE_ICON} />
            <span class="overflow-hidden text-ellipsis">{title()}</span>
          </>
        )}
      </Show>
    </span>
  );
}

// Follows MarkdownCodeBlock and SuspenseShikiCodeBlock in
// apps/web/src/components/chat/MarkdownCodeBlock.tsx, highlighting only settled blocks.
function CodeToken(props: ITokenProps) {
  const environment = Environment.use();
  const code = () => of<Tokens.Code>(props);
  const fence = createMemo(() => fenceOf(code().lang), undefined, {
    equals: (a, b) => a.Language === b.Language && a.Title === b.Title,
  });
  const key = useContext(CodeBlockKey)();
  const session = key === null ? null : ThreadSession.use();
  const [unkeyedWrap, setUnkeyedWrap] = createSignal(true);
  const wrapped = () =>
    key === null || session === null ? unkeyedWrap() : session.state.UnwrappedCode[key] !== true;
  const toggleWrap = () => {
    if (key === null || session === null) setUnkeyedWrap((held) => !held);
    else void session.toggleCodeWrap(key);
  };
  const wrapLabel = () => (wrapped() ? "Disable line wrap" : "Wrap lines");
  const wanted = createMemo(
    () =>
      isSettled(code()) && !isPlainLanguage(fence().Language)
        ? { Text: code().text, Language: fence().Language, Scheme: environment.colorScheme() }
        : null,
    undefined,
    {
      equals: (a, b) =>
        a === b ||
        (a !== null &&
          b !== null &&
          a.Text === b.Text &&
          a.Language === b.Language &&
          a.Scheme === b.Scheme),
    },
  );
  const [loads, setLoads] = createSignal(0);
  const html = createMemo(() => {
    const held = wanted();
    loads();
    return held === null ? null : cachedHighlight(held.Text, held.Language, held.Scheme);
  });
  createEffect(() => {
    const held = wanted();
    if (held === null || html() !== null) return;
    void highlight(held.Text, held.Language, held.Scheme).then(
      () => setLoads((count) => count + 1),
      (error: unknown) => console.warn("Code highlighting failed", error),
    );
  });
  return (
    <div
      class={CODE_BLOCK}
      dir="ltr"
      data-wrap={wrapped()}
      data-language={fence().Language}
      data-highlighted={html() !== null}
    >
      <div class="flex items-center justify-between gap-2 pt-1.5 pr-1.5 pl-3 text-[color-mix(in_srgb,var(--foreground)_72%,transparent)] select-none">
        <CodeTitle fence={fence()} />
        <span class="flex items-center gap-0.5" role="toolbar" aria-label="Code block actions">
          <Button
            variant={wrapped() ? "secondary" : "ghost-muted"}
            size="icon-xs"
            aria-pressed={wrapped()}
            aria-label={wrapLabel()}
            data-tip={wrapLabel()}
            onClick={toggleWrap}
          >
            <WrapText class="size-3" />
          </Button>
          <CopyButton size="icon-xs" text={code().text} label="Copy code" />
        </span>
      </div>
      <Show
        when={html()}
        fallback={
          <pre>
            <code>{code().text}</code>
          </pre>
        }
      >
        {(markup) => (
          <div class="[&_:is(pre,.shiki,.diffs)]:bg-transparent!" innerHTML={markup()} />
        )}
      </Show>
    </div>
  );
}

const BLOCK: Record<string, Component<ITokenProps>> = {
  paragraph: ParagraphToken,
  heading: HeadingToken,
  blockquote: BlockquoteToken,
  hr: HrToken,
  html: HtmlBlockToken,
  list: ListToken,
  table: TableToken,
  code: CodeToken,
};

function TopBlock(props: { token: Token; fromUser: boolean; key: string | null }) {
  const html = createMemo(() =>
    !props.fromUser && containsHtml(props.token)
      ? sanitizeHtml(assistantHtml([props.token]))
      : null,
  );
  const blockKey = props.key;
  let codeBlocks = 0;
  const nextCodeKey = () => (blockKey === null ? null : `${blockKey}:${codeBlocks++}`);
  return (
    <Show
      when={html()}
      fallback={
        <CodeBlockKey.Provider value={nextCodeKey}>
          <Dynamic component={BLOCK[props.token.type] ?? TextToken} token={props.token} />
        </CodeBlockKey.Provider>
      }
    >
      {(markup) => <div class="contents" innerHTML={markup()} />}
    </Show>
  );
}

export function Markdown(props: {
  text: string;
  fromUser: boolean;
  message?: ISentMessage | undefined;
  // The row the text belongs to, which keys state its blocks keep across remounts.
  id?: string;
}) {
  const lex = createMarkdownLexer(props.fromUser);
  const lexed = createMemo(() => lex(props.text));
  const environment = Environment.use();
  const title = useThreadTitle();
  const workspaceRoot = useWorkspaceRoot();
  const pathsKey = createMemo(() => fileLinkPathsKey(props.text, workspaceRoot()));
  const suffixes = createMemo(() => parentSuffixes(pathsKey()));
  const files: IFileLinks = { cwd: workspaceRoot, suffixes, inLink: false };
  // Raw HTML can't hold a component, so sanitize marks its thread links and a click here opens them.
  const openHtmlThreadLink = (event: MouseEvent) => {
    const href = (event.target as Element)
      .closest("[data-thread-href]")
      ?.getAttribute("data-thread-href");
    if (href == null) return;
    const target = threadLinkTarget(href, null, environment.state.EnvironmentId, title);
    if (target !== null && "Ref" in target && target.Openable)
      environment.selectThread(target.Ref.threadId);
  };
  return (
    <MessageContext.Provider value={props.message ?? null}>
      <FileLinkContext.Provider value={files}>
        <Show
          when={lexed().WholeHtml}
          fallback={
            <div class="chat-markdown" onClick={openHtmlThreadLink}>
              <Index each={lexed().Blocks}>
                {(token, index) => (
                  <TopBlock
                    token={token()}
                    fromUser={props.fromUser}
                    key={props.id === undefined ? null : `${props.id}:${index}`}
                  />
                )}
              </Index>
            </div>
          }
        >
          {(tokens) => (
            <div
              class="chat-markdown"
              onClick={openHtmlThreadLink}
              innerHTML={sanitizeHtml(assistantHtml(tokens()))}
            />
          )}
        </Show>
      </FileLinkContext.Provider>
    </MessageContext.Provider>
  );
}
