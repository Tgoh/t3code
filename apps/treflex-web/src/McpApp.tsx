// @effect-diagnostics globalTimers:off -- Revokes a saved file's object URL after the browser takes it, outside any Effect runtime.
import {
  makeMcpAppHost,
  McpAppHostRefusal,
  mcpAppStyleVariables,
  mcpResourceBytes,
  type McpAppCallToolResult,
  type McpAppDisplayMode,
  type McpAppHost,
  type McpAppHostContext,
} from "@t3tools/client-runtime/mcp-apps";
import {
  clampMcpAppHeight,
  MCP_APP_COLOR_SCHEME_PARAM,
  MCP_APP_DEFAULT_HEIGHT,
  MCP_APP_MAX_HEIGHT,
  mcpAppAllowAttribute,
  mcpAppFileName,
  type McpAppReference,
} from "@t3tools/shared/mcpApp";
import { type IOpenGenerator, open } from "treflex";
import { useComponentState } from "treflex-solid";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";

import Environment from "./Environment";
import { pageTheme } from "./HtmlRender";
import { Minimize2 } from "./icons";
import { type IMcpAppRequest, mcpAppEffect, turnItemEffect } from "./Infrastructure/commandEffects";
import { serverError } from "./Infrastructure/serverError";
import { EMPTY_MEDIA_URL, type IMediaUrl, loadMediaUrl } from "./markdownImage";
import OpenThread from "./OpenThread";
import ThreadSession from "./ThreadSession";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/AlertDialog";
import { Button } from "./ui/Button";
import { Presence } from "./ui/Presence";

// The version stock reports when its build sets none.
const HOST_VERSION = "0.0.0";

// Stock's box and frame classes, resolved per mode since there's no tailwind-merge here.
const INLINE_BOX =
  "block! static! size-full overflow-hidden m-0 border-0 bg-transparent p-0 text-inherit";
const INLINE_BORDERED_BOX =
  "block! static! size-full overflow-hidden m-0 rounded-lg border border-border bg-transparent p-0 text-inherit";
const FULLSCREEN_BOX =
  "fixed inset-0 m-0 flex h-dvh max-h-none w-dvw max-w-none flex-col overflow-hidden border-0 bg-background p-0";
const INLINE_FRAME = "block h-full w-full border-0";
const FULLSCREEN_FRAME = "block min-h-0 w-full flex-1 border-0";

/** What a rendered app holds: its document's URL, the call that opened it and its tool's definition. */
interface IMcpApp extends IMediaUrl {
  ToolCall: { Arguments: unknown; Result: McpAppCallToolResult | undefined } | null;
  ToolDefinition: unknown;
}

interface IAppTarget {
  EnvironmentId: string;
  ThreadId: string;
  ItemId: string;
}

// Follows the turn-item detail and tool-info queries McpAppFrame reads in
// apps/web/src/components/chat/McpAppFrame.tsx.
function* loadAppContext(draft: IMcpApp, target: IAppTarget, tool: string): IOpenGenerator {
  try {
    const item = yield* open(turnItemEffect(target));
    if (item?.type === "dynamic_tool") {
      draft.ToolCall = {
        Arguments: item.input,
        Result: (item.output as { result?: McpAppCallToolResult } | undefined)?.result,
      };
    }
  } catch (error) {
    serverError(error);
  }
  try {
    const info = (yield* open(
      mcpAppEffect({ ...target, Request: { Kind: "toolInfo", Name: tool } }),
    )) as { tool?: unknown } | null;
    draft.ToolDefinition = info?.tool;
  } catch (error) {
    serverError(error);
  }
}

type IAppAnswer = { Value: unknown } | { Error: string };

function* askServer(
  _draft: IMcpApp,
  target: IAppTarget,
  request: IMcpAppRequest,
): IOpenGenerator<IAppAnswer> {
  try {
    return { Value: yield* open(mcpAppEffect({ ...target, Request: request })) };
  } catch (error) {
    return { Error: serverError(error).message };
  }
}

const fullscreenSupported =
  typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype;

const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
// Excludes activation left by input elsewhere in the app.
const PAGE_ACTIVATION_MS = 5_000;

// Frame input doesn't bubble here, and an app can refocus itself, so focus alone can't exclude
// activation from input elsewhere in the app.
let lastPageInputAt = Number.NEGATIVE_INFINITY;
if (typeof window !== "undefined") {
  const note = () => {
    lastPageInputAt = performance.now();
  };
  if (navigator.userActivation?.isActive) note();
  for (const type of ["pointerdown", "pointerup", "touchend", "keydown"] as const) {
    window.addEventListener(type, note, true);
  }
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Browsers may start the download after the click's task.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Follows resolveConfirmDialogCopy in apps/web/src/components/ConfirmDialogHost.tsx.
function confirmCopy(message: string): { Title: string; Description: string | null } {
  const lines = message.trim().split("\n");
  const index = lines.findIndex((line) => /[?？]$/.test(line.trim()));
  if (index < 0) return { Title: "Confirm action", Description: message.trim() };
  const description = lines
    .filter((_, at) => at !== index)
    .join("\n")
    .trim();
  return { Title: lines[index]!.trim(), Description: description || null };
}

const refuse = (message: string) => new McpAppHostRefusal({ message });

// Follows McpAppFrame in apps/web/src/components/chat/McpAppFrame.tsx.
export function McpAppFrame(props: {
  app: McpAppReference;
  /** The thread that ran the tool, which differs from the shown one for an inherited row. */
  threadId: string;
  itemId: string;
}) {
  const environment = Environment.use();
  const thread = OpenThread.use();
  const session = ThreadSession.use();
  const app = untrack(() => props.app);
  const target = (): IAppTarget => ({
    EnvironmentId: environment.state.EnvironmentId,
    ThreadId: props.threadId,
    ItemId: props.itemId,
  });
  const local = useComponentState<IMcpApp>(() => ({
    ...EMPTY_MEDIA_URL,
    ToolCall: null,
    ToolDefinition: undefined,
  }));
  const resource = {
    _tag: "attachment" as const,
    attachmentId: app.attachmentId,
    fileName: mcpAppFileName(app),
    mimeType: "text/html",
    disposition: "inline" as const,
    renderIntent: "mcp-app" as const,
  };
  const mint = () => local.dispatch(loadMediaUrl, environment.state.EnvironmentId, resource);
  onMount(() => {
    void mint();
    void local.dispatch(loadAppContext, target(), app.tool);
  });
  const theme = createMemo(() => pageTheme(environment.colorScheme()));
  const awaitingUser = () =>
    thread.pendingApprovalIds().length > 0 || thread.pendingQuestionIds().length > 0;
  const [width, setWidth] = createSignal(0);
  const [height, setHeight] = createSignal(MCP_APP_DEFAULT_HEIGHT);
  const [navigatedAway, setNavigatedAway] = createSignal(false);
  const [displayMode, setDisplayMode] = createSignal<McpAppDisplayMode>("inline");
  const [closed, setClosed] = createSignal(false);
  const [generation, setGeneration] = createSignal(0);
  const [asking, setAsking] = createSignal<{ Message: string; Answer: (yes: boolean) => void }>();
  const [box, setBox] = createSignal<HTMLDivElement>();
  const [frame, setFrame] = createSignal<HTMLIFrameElement>();
  const [host, setHost] = createSignal<McpAppHost | null>(null);

  // The frame keeps its first URL for each document, since a new one would reload the app.
  const page = createMemo<{ Generation: number; Src: string | null }>(
    (held) => {
      const current = generation();
      if (held.Generation === current && held.Src !== null) return held;
      const url = local.state.Url;
      if (url === null) return { Generation: current, Src: null };
      // The app paints before `ui/initialize`, so it reads the first scheme from its URL.
      const absolute = new URL(url, location.href);
      absolute.searchParams.set(MCP_APP_COLOR_SCHEME_PARAM, untrack(theme).appearance);
      return { Generation: current, Src: absolute.toString() };
    },
    { Generation: 0, Src: null },
  );
  const src = () => page().Src;

  // An approval goes inline so it stays above the app.
  createEffect(() => {
    if (awaitingUser()) setDisplayMode("inline");
  });

  const ask = (message: string) => {
    setDisplayMode("inline");
    return new Promise<boolean>((resolve) => {
      asking()?.Answer(false);
      setAsking({
        Message: message,
        Answer: (yes) => {
          setAsking(undefined);
          resolve(yes);
        },
      });
    });
  };
  const request = async (ask: IMcpAppRequest) => {
    const answer = await local.dispatch(askServer, target(), ask);
    if (answer === undefined || "Error" in answer) {
      throw refuse(answer?.Error.trim() ? answer.Error : "Request failed.");
    }
    return answer.Value;
  };

  const hostContext = (): McpAppHostContext => ({
    theme: theme().appearance,
    styles: { variables: mcpAppStyleVariables(theme().variables) },
    displayMode: displayMode(),
    availableDisplayModes: fullscreenSupported ? ["inline", "fullscreen"] : ["inline"],
    containerDimensions:
      displayMode() === "fullscreen"
        ? {
            width: frame()?.clientWidth || window.innerWidth,
            height: frame()?.clientHeight || window.innerHeight,
          }
        : { width: width(), maxHeight: MCP_APP_MAX_HEIGHT },
    platform: "web",
    locale: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    userAgent: `t3-code/${HOST_VERSION}`,
    deviceCapabilities: {
      touch: window.matchMedia("(pointer: coarse)").matches,
      hover: window.matchMedia("(hover: hover)").matches,
    },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    ...(local.state.ToolDefinition === undefined
      ? {}
      : { toolInfo: { tool: local.state.ToolDefinition } }),
  });

  // The host belongs to this frame element, which a reopened document replaces.
  const attachFrame = (element: HTMLIFrameElement) => {
    setFrame(element);
    // Navigation keeps the frame's window, so a second load is refused: the new page could pose
    // as the app.
    let loads = 0;
    element.addEventListener("load", () => {
      loads += 1;
      if (loads > 1) {
        made.dispose();
        setNavigatedAway(true);
      }
    });
    const made = makeMcpAppHost({
      app,
      hostVersion: HOST_VERSION,
      // Opaque origins need "*"; the window reference keeps delivery to this frame.
      post: (message) => element.contentWindow?.postMessage(message, "*"),
      hostContext: () => untrack(hostContext),
      callTool: async ({ name, arguments: args }) => {
        const info = (await request({ Kind: "toolInfo", Name: name })) as {
          callable: boolean;
          readOnly: boolean;
          title?: string;
        };
        if (!info.callable) throw refuse("This app cannot call that tool.");
        if (!info.readOnly) {
          const approved = await ask(
            `Allow ${app.server} to run ${info.title ?? name}?\n${JSON.stringify(args, null, 2)}`,
          );
          if (!approved) throw refuse("Declined by the user.");
        }
        return (await request({
          Kind: "callTool",
          Name: name,
          Arguments: args,
        })) as McpAppCallToolResult;
      },
      readResource: ({ uri }) => request({ Kind: "readResource", Uri: uri }),
      openLink: async (url) => {
        if (document.activeElement !== element || !navigator.userActivation?.isActive) {
          throw refuse("Links open only from a click in the app.");
        }
        window.open(url, "_blank", "noopener,noreferrer");
      },
      sendMessage: async (text) => {
        const approved = await ask(`Send this message from ${app.server}?\n${text}`);
        if (!approved) throw refuse("Declined by the user.");
        const failed = await session.sendAppMessage(text);
        if (failed) throw refuse(failed);
      },
      updateModelContext: async (context) => {
        await request({
          Kind: "updateModelContext",
          ConversationThreadId: session.state.ThreadId,
          ...(context.content === undefined ? {} : { Content: [...context.content] }),
          ...(context.structuredContent === undefined
            ? {}
            : { StructuredContent: context.structuredContent }),
        });
      },
      requestDisplayMode: async (mode) => {
        const other = document.querySelector("[data-mcp-app-fullscreen]");
        if (
          mode === "fullscreen" &&
          (!fullscreenSupported ||
            document.activeElement !== element ||
            !navigator.userActivation?.isActive ||
            performance.now() - lastPageInputAt < PAGE_ACTIVATION_MS ||
            untrack(awaitingUser) ||
            untrack(asking) !== undefined ||
            (other !== null && other !== box()))
        ) {
          return untrack(displayMode);
        }
        setDisplayMode(mode);
        return mode;
      },
      downloadFile: async (files) => {
        const names = files.map((file) => file.name).join(", ");
        if (!(await ask(`Save ${names} from ${app.server}?`))) {
          throw refuse("Declined by the user.");
        }
        for (const file of files) {
          let bytes: Uint8Array | undefined;
          let mimeType = file.mimeType ?? "application/octet-stream";
          if (file._tag === "embedded") {
            bytes = file.bytes;
          } else {
            const read = (await request({ Kind: "readResource", Uri: file.uri })) as {
              contents: unknown[];
            };
            const content = read.contents[0];
            bytes = mcpResourceBytes(content);
            const declared = (content as { mimeType?: unknown } | undefined)?.mimeType;
            if (typeof declared === "string") mimeType = declared;
          }
          if (bytes === undefined) throw refuse(`${file.name} has no contents.`);
          if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
            throw refuse(`${file.name} is too large to save.`);
          }
          saveBlob(new Blob([bytes.slice()], { type: mimeType }), file.name);
        }
      },
      onRequestTeardown: () => {
        if (untrack(displayMode) === "fullscreen") {
          setDisplayMode("inline");
          return;
        }
        // A replacement document may have mounted while this one wound down.
        void made.teardown().then(() => {
          if (untrack(host) === made) setClosed(true);
        });
      },
      onSizeChanged: (size) => {
        // Full screen reports the viewport's height, which inline sizing ignores.
        if (untrack(displayMode) === "fullscreen") return;
        if (size.height !== undefined) setHeight(clampMcpAppHeight(size.height));
      },
    });
    setHost(made);
    const receive = (event: MessageEvent) => {
      if (event.source !== null && event.source === element.contentWindow) made.receive(event.data);
    };
    window.addEventListener("message", receive);
    onCleanup(() => {
      window.removeEventListener("message", receive);
      void made.teardown();
      if (untrack(host) === made) setHost(null);
      if (untrack(frame) === element) setFrame(undefined);
    });
  };

  // The app lives in another window, so each change to what it reads is sent to it.
  createEffect(() => {
    theme();
    width();
    displayMode();
    void local.state.ToolDefinition;
    host()?.updateHostContext();
  });
  // Each new document needs the call again.
  createEffect(() => {
    const call = local.state.ToolCall;
    src();
    if (call !== null) host()?.setToolCall({ arguments: call.Arguments, result: call.Result });
  });

  const attachBox = (element: HTMLDivElement) => {
    setBox(element);
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
      // Full screen reports the viewport, which can change height alone.
      if (fullscreenSupported && element.matches(":popover-open"))
        untrack(host)?.updateHostContext();
    });
    observer.observe(element);
    onCleanup(() => {
      observer.disconnect();
      if (untrack(box) === element) setBox(undefined);
    });
  };
  // The box is in the top layer exactly while its full-screen chrome is mounted, so every way
  // out of full screen closes the popover.
  const attachFullscreenChrome = (chrome: HTMLDivElement) => {
    const parent = chrome.parentElement;
    if (parent === null) return;
    if (!parent.matches(":popover-open")) parent.showPopover();
    onCleanup(() => {
      if (parent.matches(":popover-open")) parent.hidePopover();
    });
  };
  const fullscreen = () => displayMode() === "fullscreen";

  return (
    <>
      <Show
        when={!closed()}
        fallback={
          <div class="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-muted-foreground text-xs">
            <span>The {app.server} app was closed</span>
            <Button
              size="xs"
              variant="ghost"
              onClick={async () => {
                // Signs the document again first, so the reopened frame never loads an expired URL.
                await mint();
                setGeneration((value) => value + 1);
                setNavigatedAway(false);
                setClosed(false);
              }}
            >
              Show app
            </Button>
          </div>
        }
      >
        {/* Keeps the inline height during full screen, so the timeline doesn't jump. */}
        <div style={{ height: `${height()}px` }}>
          <div
            ref={attachBox}
            // Keeps the frame's parent, which would reload it; the top layer escapes the timeline.
            popover={fullscreenSupported ? "auto" : undefined}
            onToggle={(event) => {
              if ((event as ToggleEvent).newState === "closed") setDisplayMode("inline");
            }}
            onFocusOut={(event) => {
              const next = event.relatedTarget;
              if (fullscreen() && next instanceof Node && !event.currentTarget.contains(next)) {
                setDisplayMode("inline");
              }
            }}
            data-mcp-app-fullscreen={fullscreen() ? "" : undefined}
            class={
              fullscreen()
                ? FULLSCREEN_BOX
                : app.prefersBorder === true
                  ? INLINE_BORDERED_BOX
                  : INLINE_BOX
            }
          >
            <Show when={fullscreen()}>
              <div
                ref={attachFullscreenChrome}
                class="flex h-10 shrink-0 items-center justify-between border-border border-b px-3 text-sm"
              >
                <span class="truncate">{app.server}</span>
                <Button
                  aria-label="Exit full screen"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setDisplayMode("inline")}
                >
                  <Minimize2 class="size-4" />
                </Button>
              </div>
            </Show>
            <Show
              when={!navigatedAway()}
              fallback={
                <p class="flex size-full items-center justify-center text-muted-foreground text-xs">
                  The {app.server} app left its page and was stopped
                </p>
              }
            >
              <Show
                when={src()}
                keyed
                fallback={
                  <Show when={local.state.Failed}>
                    <p class="flex size-full items-center justify-center text-muted-foreground text-xs">
                      Unable to load the {app.server} app
                    </p>
                  </Show>
                }
              >
                {(shown) => (
                  <iframe
                    ref={attachFrame}
                    src={shown}
                    title={`${app.server} app`}
                    // Leaving out allow-same-origin keeps the app out of the session.
                    sandbox="allow-scripts allow-forms"
                    allow={mcpAppAllowAttribute(app.permissions)}
                    class={fullscreen() ? FULLSCREEN_FRAME : INLINE_FRAME}
                    style={{ "color-scheme": theme().appearance }}
                  />
                )}
              </Show>
            </Show>
          </div>
        </div>
      </Show>
      <Presence when={asking()}>
        {(held) => {
          const copy = confirmCopy(held().Message);
          return (
            <AlertDialog onClose={() => held().Answer(false)}>
              <AlertDialogPopup>
                <AlertDialogHeader>
                  <AlertDialogTitle>{copy.Title}</AlertDialogTitle>
                  <Show when={copy.Description}>
                    <AlertDialogDescription class="whitespace-pre-line">
                      {copy.Description}
                    </AlertDialogDescription>
                  </Show>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogClose variant="outline">Cancel</AlertDialogClose>
                  <Button onClick={() => held().Answer(true)}>Confirm</Button>
                </AlertDialogFooter>
              </AlertDialogPopup>
            </AlertDialog>
          );
        }}
      </Presence>
    </>
  );
}
