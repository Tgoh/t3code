import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";
import type { Token, Tokens } from "marked";
import {
  type Component,
  createContext,
  createMemo,
  createSignal,
  Index,
  Show,
  useContext,
} from "solid-js";
import { Dynamic } from "solid-js/web";

import { CopyButton } from "./CopyButton";
import Environment from "./Environment";
import { MessagesSquare, WrapText } from "./icons";
import { assistantHtml, containsHtml, createMarkdownLexer } from "./markdownTokens";
import { EXTERNAL_LINK, sanitizeHtml } from "./sanitize";
import {
  contextThreadTarget,
  type ILinkTarget,
  type ISentMessage,
  type IThreadTitle,
  threadLinkTarget,
} from "./userMessage";

interface ITokenProps {
  token: Token;
}

const IMAGE_SOURCE = /^(?:https?:|data:image\/)/i;

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
      {(target) => (
        <button
          type="button"
          class="thread-link"
          data-tip="Open thread"
          onClick={() => environment.selectThread(target().Ref.threadId)}
        >
          <MessagesSquare />
          {target().Title}
        </button>
      )}
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

function ImageToken(props: ITokenProps) {
  const image = () => of<Tokens.Image>(props);
  return (
    <Show when={IMAGE_SOURCE.test(image().href)} fallback={image().text}>
      <img src={image().href} alt={image().text} />
    </Show>
  );
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
  return (
    <p>
      <Inline tokens={of<Tokens.Paragraph>(props).tokens} />
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
