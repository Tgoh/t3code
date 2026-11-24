import {
  commandHighlightLanguage,
  withVisibleControlCharacters,
} from "@t3tools/client-runtime/work-log/command-label";
import {
  isJsonToolText,
  toolCallLines,
  turnItemOutputImages,
  turnItemOutputText,
} from "@t3tools/client-runtime/work-log/item-detail";
import { formatDiffCount } from "@t3tools/client-runtime/diff-count";
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { isJavaScriptReplTool } from "@t3tools/shared/toolActivity";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

import { cachedHighlight, highlight } from "./codeHighlight";
import { CommandOutput, ToolDetailNote } from "./CommandOutput";
import Environment from "./Environment";
import { ExternalLink } from "./icons";
import type { IWireTurnItem } from "./Infrastructure/wire";
import { ViewedImage } from "./Markdown";
import type { IToolDetail } from "./ToolDetail";
import { Caught } from "./ui/Caught";
import { ADDED_TEXT, REMOVED_TEXT } from "./ui/notes";
import { formatWorkspaceRelativePath } from "./workLog";
import { useWorkspaceRoot } from "./workspaceRoot";

/** The item types whose expanded row shows stock's per-tool detail. */
export const INSPECTED_TYPES = new Set<IWireTurnItem["type"]>([
  "command_execution",
  "file_change",
  "file_search",
  "web_search",
  "dynamic_tool",
  "approval_request",
  "user_input_request",
]);

const MONO = "font-mono text-[11px] leading-relaxed wrap-anywhere whitespace-pre-wrap select-text";

function HighlightedText(props: { text: string; language: string }) {
  const environment = Environment.use();
  const [loads, setLoads] = createSignal(0);
  const html = createMemo(() => {
    loads();
    return cachedHighlight(props.text, props.language, environment.colorScheme());
  });
  createEffect(
    () =>
      html() === null ? ([props.text, props.language, environment.colorScheme()] as const) : null,
    (missing) => {
      if (missing === null) return;
      void highlight(...missing).then(
        () => setLoads((count) => count + 1),
        (error: unknown) => console.warn("Code highlighting failed", error),
      );
    },
  );
  return (
    <Show when={html()} fallback={props.text}>
      {(markup) => (
        <span
          class="[&_:is(pre,code,.shiki)]:m-0 [&_:is(pre,code,.shiki)]:bg-transparent! [&_:is(pre,code,.shiki)]:p-0 [&_:is(pre,code,.shiki)]:font-[inherit] [&_:is(pre,code,.shiki)]:whitespace-pre-wrap"
          innerHTML={markup()}
        />
      )}
    </Show>
  );
}

function StructuredValue(props: {
  value: unknown;
  highlightJson?: boolean;
  language?: "typescript" | "html" | "json";
}) {
  const text = () =>
    typeof props.value === "string" ? props.value : JSON.stringify(props.value, null, 2);
  const language = () =>
    props.language ?? (props.highlightJson && isJsonToolText(text()) ? "json" : null);
  return (
    <Show when={text()}>
      <pre class={`m-0 max-h-80 overflow-auto text-muted-foreground ${MONO}`}>
        <Caught fallback={text()}>
          <Show when={language()} fallback={text()}>
            {(held) => <HighlightedText text={text()} language={held()} />}
          </Show>
        </Caught>
      </pre>
    </Show>
  );
}

// Follows ShellCommandBlock in apps/web/src/components/chat/ShellCommandBlock.tsx.
function ShellCommand(props: { command: string }) {
  const code = () => withVisibleControlCharacters(props.command.trim());
  return (
    <Show when={code()}>
      <div class="text-foreground/85">
        <Caught fallback={code()}>
          <HighlightedText text={code()} language={commandHighlightLanguage(code())} />
        </Caught>
      </div>
    </Show>
  );
}

interface IOutput {
  Text: string | null;
  Images: ReturnType<typeof turnItemOutputImages>;
  /** The whole item was fetched, so an empty output is final. */
  Fetched: boolean;
}

function OutputImages(props: { output: IOutput }) {
  return (
    <For each={props.output.Images}>
      {(resource) => (
        <ViewedImage resource={resource} fragment="" alt="Tool output image" size="detail" />
      )}
    </For>
  );
}

function Output(props: { output: IOutput; detail: IToolDetail | undefined }) {
  return (
    <Show
      when={props.output.Text}
      fallback={
        <Show
          when={props.detail !== undefined && !props.output.Fetched}
          fallback={
            <Show when={props.output.Fetched && props.output.Images.length === 0}>
              <div class="text-muted-foreground italic">No output.</div>
            </Show>
          }
        >
          <ToolDetailNote detail={props.detail!} />
        </Show>
      }
    >
      {(text) => <StructuredValue value={text()} highlightJson />}
    </Show>
  );
}

function ToolCall(props: {
  command?: string;
  args?: unknown;
  toolName?: string | null;
  exitCode?: number | undefined;
  output: IOutput;
  detail: IToolDetail | undefined;
  /** Replaces the fetched output. */
  outputSlot?: JSX.Element;
}) {
  const call = createMemo(() => toolCallLines({ command: props.command, args: props.args }));
  return (
    <div class={`space-y-1.5 ${MONO}`}>
      <OutputImages output={props.output} />
      <Show when={call().command}>{(command) => <ShellCommand command={command()} />}</Show>
      <Show when={call().args}>
        {(args) => (
          <div class="text-foreground/85">
            <For each={args()}>
              {([key, value]) => (
                <div>
                  <span class="text-muted-foreground">{key} </span>
                  {key === "html" ? (
                    <StructuredValue value={value} language="html" />
                  ) : key === "code" && isJavaScriptReplTool(props.toolName) ? (
                    <StructuredValue value={value} language="typescript" />
                  ) : isJsonToolText(value) ? (
                    <StructuredValue value={value} language="json" />
                  ) : (
                    value
                  )}
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
      <Show when={call().argsText}>
        {(text) => <StructuredValue value={text()} highlightJson />}
      </Show>
      {props.outputSlot ?? <Output output={props.output} detail={props.detail} />}
      <Show when={props.exitCode !== undefined && props.exitCode !== 0}>
        <div class="text-destructive">exit {props.exitCode}</div>
      </Show>
    </div>
  );
}

const webHref = (url: string | undefined) =>
  url !== undefined && /^https?:\/\//iu.test(url) ? url : null;

/**
 * Follows V2ItemInspector in apps/web/src/components/chat/V2ItemInspector.tsx.
 */
export function ToolInspector(props: {
  id: string;
  item: IWireTurnItem;
  detail: IToolDetail | undefined;
  /** The row's command output streams from the server. */
  liveOutput: boolean;
}) {
  const workspaceRoot = useWorkspaceRoot();
  const item = createMemo(() => {
    const fetched = props.detail?.Item;
    return fetched != null && fetched.type === props.item.type ? fetched : props.item;
  });
  const output = createMemo<IOutput>(() => {
    const decoded = item() as unknown as OrchestrationV2TurnItem;
    return {
      Text: turnItemOutputText(decoded),
      Images: turnItemOutputImages(decoded),
      Fetched: item() !== props.item,
    };
  });
  const path = (fileName: string) => formatWorkspaceRelativePath(fileName, workspaceRoot());
  const of = <K extends IWireTurnItem["type"]>(type: K) => {
    const held = item();
    return held.type === type ? (held as Extract<IWireTurnItem, { type: K }>) : undefined;
  };
  return (
    <div class="space-y-2 text-xs">
      <Show when={of("command_execution")}>
        {(held) => (
          <ToolCall
            command={held().input}
            exitCode={held().exitCode}
            output={output()}
            detail={props.detail}
            outputSlot={props.liveOutput ? <CommandOutput itemId={props.id} /> : undefined}
          />
        )}
      </Show>
      <Show when={of("file_change")}>
        {(held) => (
          <div class="space-y-2">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-mono text-muted-foreground">{path(held().fileName)}</span>
              <Show when={held().additions !== undefined || held().deletions !== undefined}>
                <span>
                  <span class={ADDED_TEXT}>+{formatDiffCount(held().additions ?? 0)}</span>{" "}
                  <span class={REMOVED_TEXT}>-{formatDiffCount(held().deletions ?? 0)}</span>
                </span>
              </Show>
            </div>
            <Show when={held().status === "failed" && held().diffStr?.trim()}>
              <StructuredValue value={held().diffStr} />
            </Show>
            <Show when={(held().changes ?? []).length > 0}>
              <ul class="m-0 list-none space-y-1 p-0 font-mono text-muted-foreground">
                <For each={held().changes}>
                  {(change) => (
                    <li>
                      {change.operation} {change.oldPath ? `${change.oldPath} → ` : ""}
                      {path(change.path)}
                      {change.fileType || change.mimeType
                        ? ` (${[change.fileType, change.mimeType].filter(Boolean).join(", ")})`
                        : ""}
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        )}
      </Show>
      <Show when={of("file_search")}>
        {(held) => (
          <>
            <Show when={held().pattern?.trim()}>
              <div class={`text-foreground/85 ${MONO}`}>{held().pattern}</div>
            </Show>
            <Show when={(held().results ?? []).length > 0}>
              <ul class="m-0 list-none space-y-1 p-0">
                <For each={held().results}>
                  {(result) => (
                    <li>
                      <span class="font-mono text-foreground/80">
                        {path(result.fileName)}
                        {result.line === undefined ? "" : `:${result.line}`}
                        {result.column === undefined ? "" : `:${result.column}`}
                      </span>
                      <Show when={result.preview}>
                        <p class="m-0 mt-0.5 whitespace-pre-wrap text-muted-foreground">
                          {result.preview}
                        </p>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </>
        )}
      </Show>
      <Show when={of("web_search")}>
        {(held) => (
          <>
            <Show when={(held().patterns ?? []).length > 0}>
              <div class={`text-foreground/85 ${MONO}`}>{held().patterns!.join("\n")}</div>
            </Show>
            <Show when={(held().results ?? []).length > 0}>
              <ul class="m-0 list-none space-y-1.5 p-0">
                <For each={held().results}>
                  {(result) => (
                    <li>
                      <Show
                        when={webHref(result.url)}
                        fallback={
                          <p class="m-0 font-medium text-foreground">
                            {result.title ?? result.url ?? "Search result"}
                          </p>
                        }
                      >
                        {(href) => (
                          <a
                            href={href()}
                            target="_blank"
                            rel="noreferrer"
                            class="inline-flex items-center gap-1 font-medium text-foreground hover:underline [&_svg]:size-3"
                          >
                            {result.title ?? result.url}
                            <ExternalLink />
                          </a>
                        )}
                      </Show>
                      <Show when={result.snippet}>
                        <p class="m-0 text-muted-foreground">{result.snippet}</p>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </>
        )}
      </Show>
      <Show when={of("dynamic_tool")}>
        {(held) => (
          <ToolCall
            toolName={held().toolName}
            args={held().input}
            output={output()}
            detail={props.detail}
          />
        )}
      </Show>
      <Show when={of("approval_request")}>
        {(held) => <StructuredValue value={held().prompt} />}
      </Show>
      <Show when={of("user_input_request")}>
        {(held) => (
          <StructuredValue
            value={held()
              .questions.map((question) =>
                [question.question, ...question.options.map((option) => `• ${option.label}`)].join(
                  "\n",
                ),
              )
              .join("\n\n")}
          />
        )}
      </Show>
    </div>
  );
}
