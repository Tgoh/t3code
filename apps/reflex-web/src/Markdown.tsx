import type { AssetResource } from "@t3tools/contracts";
import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";
import type { Token, Tokens } from "marked";
import {
  type Component,
  createContext,
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

// Marked leaves entities in text for its HTML output, and a text node would show them literally.
function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  decoder.innerHTML = text;
  return decoder.value;
}

const of = <T,>(props: ITokenProps) => props.token as unknown as T;

function Inline(props: { tokens: Token[] | undefined }) {
  return (
    <Index each={props.tokens}>
      {(token) => <Dynamic component={INLINE[token().type] ?? TextToken} token={token()} />}
    </Index>
  );
}

function TextToken(props: ITokenProps) {
  const text = () => of<Tokens.Text>(props);
  return (
    <Show when={text().tokens} fallback={decodeEntities(text().text)}>
      {(tokens) => <Inline tokens={tokens()} />}
    </Show>
  );
}

function LiteralToken(props: ITokenProps) {
  return <>{of<Tokens.Tag>(props).text}</>;
}

function CodeSpanToken(props: ITokenProps) {
  return <code>{of<Tokens.Codespan>(props).text}</code>;
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
  return (
    <Show
      when={thread()}
      fallback={
        <Show
          when={EXTERNAL_LINK.test(link().href)}
          fallback={
            <a data-tip={link().href}>
              <Inline tokens={link().tokens} />
            </a>
          }
        >
          <a href={link().href} target="_blank" rel="noopener noreferrer">
            <Inline tokens={link().tokens} />
          </a>
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
  return (
    <Dynamic
      component={list().ordered ? "ol" : "ul"}
      start={list().ordered && list().start !== 1 ? list().start : undefined}
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

function CodeToken(props: ITokenProps) {
  const code = () => of<Tokens.Code>(props);
  const [wrapped, setWrapped] = createSignal(true);
  const wrapLabel = () => (wrapped() ? "Disable line wrap" : "Wrap lines");
  return (
    <div class="code-block" dir="ltr" data-wrap={wrapped()}>
      <div class="code-block-header">
        <span class="code-language">{code().lang?.split(/\s/)[0] || "text"}</span>
        <span class="code-actions">
          <button
            type="button"
            class="icon-button small"
            classList={{ pressed: wrapped() }}
            aria-pressed={wrapped()}
            aria-label={wrapLabel()}
            data-tip={wrapLabel()}
            onClick={() => setWrapped((held) => !held)}
          >
            <WrapText />
          </button>
          <CopyButton text={code().text} label="Copy code" />
        </span>
      </div>
      <pre>
        <code>{code().text}</code>
      </pre>
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

function TopBlock(props: { token: Token; fromUser: boolean }) {
  const html = createMemo(() =>
    !props.fromUser && containsHtml(props.token)
      ? sanitizeHtml(assistantHtml([props.token]))
      : null,
  );
  return (
    <Show
      when={html()}
      fallback={<Dynamic component={BLOCK[props.token.type] ?? TextToken} token={props.token} />}
    >
      {(markup) => <div class="raw-html-block" innerHTML={markup()} />}
    </Show>
  );
}

export function Markdown(props: { text: string; fromUser: boolean; message?: ISentMessage }) {
  const lex = createMarkdownLexer(props.fromUser);
  const lexed = createMemo(() => lex(props.text));
  const environment = Environment.use();
  const title = useThreadTitle();
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
      <Show
        when={lexed().WholeHtml}
        fallback={
          <div class="chat-markdown" onClick={openHtmlThreadLink}>
            <Index each={lexed().Blocks}>
              {(token) => <TopBlock token={token()} fromUser={props.fromUser} />}
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
    </MessageContext.Provider>
  );
}
