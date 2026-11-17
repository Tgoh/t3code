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
import { MessagesSquare, TriangleAlert, WrapText } from "./icons";
import { ImageDialog } from "./ImageDialog";
import type { IAssetUrl } from "./Infrastructure/commandEffects";
import {
  type IMarkdownImageUrl,
  imageSizeStyle,
  loadImageUrl,
  markdownImageTarget,
  sameTarget,
} from "./markdownImage";
import { assistantHtml, containsHtml, createMarkdownLexer } from "./markdownTokens";
import OpenThread from "./OpenThread";
import { EXTERNAL_LINK, sanitizeHtml } from "./sanitize";
import ThreadSession from "./ThreadSession";
import { IconButton } from "./ui/IconButton";
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

function FileIcon(props: { path: string }) {
  const icon = () => fileIconFor(props.path);
  return (
    <svg
      aria-hidden="true"
      class="file-icon"
      style={{ color: `light-dark(${icon().Light}, ${icon().Dark})` }}
      viewBox="0 0 16 16"
    >
      <use href={`#${icon().Name}`} />
    </svg>
  );
}

// Follows MarkdownFileLink in apps/web/src/components/chat/MarkdownFileLink.tsx.
function FileChip(props: { link: IFileLink }) {
  const environment = Environment.use();
  const files = useContext(FileLinkContext);
  return (
    <button
      type="button"
      class="file-link"
      dir="ltr"
      data-tip={props.link.TargetPath}
      onClick={(event) => {
        event.stopPropagation();
        environment.openInEditor(props.link.TargetPath, files.cwd() ?? null);
      }}
    >
      <FileIcon path={props.link.FilePath} />
      <span class="file-link-label">{chipLabel(props.link, files.suffixes())}</span>
    </button>
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
          class="thread-link unavailable"
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
            class="thread-link"
            aria-label={`Thread, ${target().Title}`}
            data-tip="Open thread"
            onClick={() => environment.selectThread(target().Ref.threadId)}
          >
            <Show when={project()} fallback={<MessagesSquare />}>
              {(held) => <ProjectBadge project={held()} />}
            </Show>
            <span class="thread-link-label">{target().Title}</span>
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
              >
                {inner()}
              </a>
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

function ImageUnavailable(props: { alt: string }) {
  return (
    <span class="markdown-image-unavailable">
      <TriangleAlert />
      {["Image unavailable", props.alt].filter(Boolean).join(" · ")}
    </span>
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
              <span class="markdown-image-chip">
                <ImageUnavailable alt={props.alt} />
              </span>
            </Show>
          }
        >
          <span
            class="markdown-image-frame"
            style={style()}
            role={failed() ? "alert" : "status"}
            aria-label={failed() ? undefined : "Loading image"}
          >
            <Show
              when={failed()}
              fallback={
                <Show when={props.src}>
                  {(src) => <img class="markdown-image-probe" src={src()} alt="" {...events} />}
                </Show>
              }
            >
              <span class="markdown-image-failed">
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
            class="markdown-image"
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
          <Show when={expanded()}>
            <ImageDialog src={src()} alt={props.alt} onClose={() => setExpanded(false)} />
          </Show>
        </>
      )}
    </Show>
  );
}

function FileImage(props: {
  resource: AssetResource;
  fragment: string;
  alt: string;
  standalone: boolean;
}) {
  const environment = Environment.use();
  const local = useComponentState<IMarkdownImageUrl>(() => ({
    Url: null,
    Size: null,
    Failed: false,
  }));
  onMount(() => local.dispatch(loadImageUrl, environment.state.EnvironmentId, props.resource));
  return (
    <ShownImage
      src={local.state.Url === null ? null : local.state.Url + props.fragment}
      sourceFailed={local.state.Failed}
      size={local.state.Size}
      alt={props.alt}
      standalone={props.standalone}
    />
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
        "Direct" in held ? (
          <ShownImage
            src={held.Direct}
            sourceFailed={false}
            size={null}
            alt={props.token.text}
            standalone={props.standalone}
          />
        ) : (
          <FileImage
            resource={held.Resource}
            fragment={held.Fragment}
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

function Blocks(props: { tokens: Token[] | undefined }) {
  return (
    <Index each={props.tokens}>
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
      <Blocks tokens={props.item.tokens} />
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
    <span class="code-language">
      <Show
        when={props.fence.Title}
        fallback={
          <Show when={hasSpecificIcon(languageFile())} fallback={props.fence.Language}>
            <span
              class="code-language-icon"
              aria-label={`Language: ${props.fence.Language}`}
              data-tip={props.fence.Language}
            >
              <FileIcon path={languageFile()} />
            </span>
          </Show>
        }
      >
        {(title) => (
          <>
            <FileIcon path={title()} />
            <span class="code-title">{title()}</span>
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
    key === null || session === null ? unkeyedWrap() : session.unwrappedCodeBlocks()[key] !== true;
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
      class="code-block"
      dir="ltr"
      data-wrap={wrapped()}
      data-language={fence().Language}
      data-highlighted={html() !== null}
    >
      <div class="code-block-header">
        <CodeTitle fence={fence()} />
        <span class="code-actions" role="toolbar" aria-label="Code block actions">
          <IconButton
            variant="muted"
            size="xs"
            pressed={wrapped()}
            aria-pressed={wrapped()}
            aria-label={wrapLabel()}
            data-tip={wrapLabel()}
            onClick={toggleWrap}
          >
            <WrapText />
          </IconButton>
          <CopyButton size="xs" text={code().text} label="Copy code" />
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
        {(markup) => <div class="code-highlight" innerHTML={markup()} />}
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
      {(markup) => <div class="raw-html-block" innerHTML={markup()} />}
    </Show>
  );
}

export function Markdown(props: {
  text: string;
  fromUser: boolean;
  message?: ISentMessage;
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
