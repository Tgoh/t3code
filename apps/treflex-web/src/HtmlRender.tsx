import {
  type KeybindingCommand,
  type KeybindingShortcut,
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
  THREAD_JUMP_KEYBINDING_COMMANDS,
} from "@t3tools/contracts";
import {
  HTML_RENDER_COLUMN_WIDTH,
  HTML_RENDER_CONTAIN_SCROLL_FRAGMENT,
  HTML_RENDER_DEFAULT_FONTS,
  htmlRenderFileName,
  htmlRenderFrameHeight,
  type HtmlRenderReference,
  htmlRenderResult,
  type HtmlRenderShortcut,
  htmlRenderShortcutsMessage,
  htmlRenderTheme,
  htmlRenderThemeFragment,
  htmlRenderThemeMessage,
  readHtmlRenderContentHeight,
  readHtmlRenderImageRequest,
  readHtmlRenderKeyDown,
  readHtmlRenderLinkRequest,
} from "@t3tools/shared/htmlRender";
import {
  isMacPlatform,
  matchesKeybindingShortcut,
  normalizeEventKey,
} from "@t3tools/shared/keybindings";
import {
  T3_CODE_DARK_THEME_COLORS,
  T3_CODE_LIGHT_THEME_COLORS,
} from "@t3tools/shared/themePalettes";
import { useComponentState } from "treflex-solid";
import {
  createMemo,
  createSignal,
  createTrackedEffect,
  onCleanup,
  onSettled,
  Show,
  untrack,
} from "solid-js";

import type { IColorScheme } from "./colorScheme";
import Environment from "./Environment";
import { Maximize2, Minus, Plus, X } from "./icons";
import { ImageDialog } from "./ImageDialog";
import { clockNow } from "./timestamps";
import { EMPTY_MEDIA_URL, type IMediaUrl, loadMediaUrl, MIN_URL_LIFE_MS } from "./markdownImage";
import { Button } from "./ui/Button";
import { Dialog, DialogPopup, DialogTitle } from "./ui/Dialog";
import { ERROR_TEXT } from "./ui/notice";
import { Presence } from "./ui/Presence";

// Follows HTML_RENDER_SHORTCUT_COMMANDS in apps/web/src/components/files/BrowserDocumentFrame.tsx.
/**
 * The page reports the keys, and a page script can report any key it likes, so only commands
 * that change what the reader sees are here, never one that changes a thread.
 */
const HTML_RENDER_SHORTCUT_COMMANDS: ReadonlySet<KeybindingCommand> = new Set([
  "commandPalette.toggle",
  "filePicker.toggle",
  "projectSearch.toggle",
  "chat.find",
  "sidebar.toggle",
  "rightPanel.toggle",
  "rightPanel.toggleMaximized",
  "threadPanel.toggle",
  "terminal.toggle",
  "preview.toggle",
  "navigation.back",
  "navigation.forward",
  "thread.previous",
  "thread.next",
  ...THREAD_JUMP_KEYBINDING_COMMANDS,
  ...MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
]);

// Follows getStandardThemeColors in apps/web/src/themePalette.ts; this client has no theme presets.
const STANDARD_COLORS = {
  light: T3_CODE_LIGHT_THEME_COLORS,
  dark: { ...T3_CODE_DARK_THEME_COLORS, canvas: "#000000" },
};

export const pageTheme = (scheme: IColorScheme) =>
  htmlRenderTheme(STANDARD_COLORS[scheme], scheme, HTML_RENDER_DEFAULT_FONTS);

const shortcutKey = (shortcut: HtmlRenderShortcut) =>
  [
    shortcut.key,
    shortcut.metaKey ? "meta" : "",
    shortcut.ctrlKey ? "ctrl" : "",
    shortcut.shiftKey ? "shift" : "",
    shortcut.altKey ? "alt" : "",
  ].join("|");

const observeWidth = (box: HTMLElement, set: (width: number) => void) => {
  set(box.clientWidth);
  const observer = new ResizeObserver(([entry]) => {
    if (entry) set(Math.round(entry.contentRect.width));
  });
  observer.observe(box);
  onCleanup(() => observer.disconnect());
};

const MAX_MEASURED_CONTENT_HEIGHTS = 200;

// The height each render's page last reported, so a remounted frame opens at it before its page loads.
const measuredContentHeights = new Map<string, number>();

function rememberContentHeight(attachmentId: string, height: number) {
  measuredContentHeights.delete(attachmentId);
  measuredContentHeights.set(attachmentId, height);
  if (measuredContentHeights.size > MAX_MEASURED_CONTENT_HEIGHTS) {
    const oldest = measuredContentHeights.keys().next().value;
    if (oldest !== undefined) measuredContentHeights.delete(oldest);
  }
}

// Follows HtmlRenderFrame in apps/web/src/components/chat/HtmlRenderFrame.tsx.
export function HtmlRenderFrame(props: { htmlRender: HtmlRenderReference }) {
  const environment = Environment.use();
  const resource = untrack(() => ({
    _tag: "attachment" as const,
    attachmentId: props.htmlRender.attachmentId,
    fileName: htmlRenderFileName(props.htmlRender.title),
    mimeType: "text/html",
    disposition: "inline" as const,
  }));
  const asset = useComponentState<IMediaUrl>(() => ({ ...EMPTY_MEDIA_URL }));
  const mint = () => asset.dispatch(loadMediaUrl, environment.state.EnvironmentId, resource);
  onSettled(() => {
    void mint();
  });
  const [width, setWidth] = createSignal(HTML_RENDER_COLUMN_WIDTH);
  const [contentHeight, setContentHeight] = createSignal(
    measuredContentHeights.get(resource.attachmentId),
  );
  const height = () => htmlRenderFrameHeight(props.htmlRender, width(), contentHeight());
  // The frame keeps the first URL it loads, so a later mint doesn't reload the page.
  const src = createMemo<string | null>((first = null) => first ?? asset.state.Url);
  const [expandedSrc, setExpandedSrc] = createSignal<string | null>(null);
  const [unavailable, setUnavailable] = createSignal(false);
  const expand = async () => {
    setUnavailable(false);
    const expiresAt = asset.state.ExpiresAt;
    if (expiresAt === null || expiresAt - clockNow() <= MIN_URL_LIFE_MS) await mint();
    const url = asset.state.Failed ? null : asset.state.Url;
    if (url === null) setUnavailable(true);
    else setExpandedSrc(url);
  };
  return (
    <div>
      <div
        ref={(box) => observeWidth(box, setWidth)}
        class="group/html-render relative"
        style={{ height: `${height()}px` }}
      >
        <Show
          when={src()}
          fallback={
            <Show when={asset.state.Failed}>
              <p class="flex size-full items-center justify-center text-muted-foreground text-xs">
                Unable to load {props.htmlRender.title}
              </p>
            </Show>
          }
        >
          {(shown) => (
            <>
              <HtmlRenderDocument
                src={shown()}
                title={props.htmlRender.title}
                class="block size-full"
                containScroll
                onContentHeight={(measured) => {
                  rememberContentHeight(resource.attachmentId, measured);
                  setContentHeight(measured);
                }}
              />
              <div class="absolute end-2 top-2 flex gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/html-render:opacity-100 pointer-coarse:opacity-100">
                <Button
                  aria-label="Open full screen"
                  data-tip="Open full screen"
                  data-tip-side="left"
                  size="icon-xs"
                  variant="glass"
                  onClick={() => void expand()}
                >
                  <Maximize2 class="size-3.5" />
                </Button>
              </div>
            </>
          )}
        </Show>
      </div>
      <Show when={unavailable()}>
        <p role="alert" class={ERROR_TEXT}>
          Page unavailable. Reconnect to the environment and try again.
        </p>
      </Show>
      <Presence when={expandedSrc()}>
        {(shown) => (
          <HtmlRenderDialog
            src={shown()}
            htmlRender={props.htmlRender}
            onClose={() => setExpandedSrc(null)}
          />
        )}
      </Presence>
    </div>
  );
}

// Follows HtmlRenderDocument in apps/web/src/components/files/BrowserDocumentFrame.tsx.
/** Keeps its first URL while mounted, since signing it again must not reload the page. */
function HtmlRenderDocument(props: {
  src: string;
  title: string;
  class: string;
  /** Keeps the page's scrollIntoView calls from scrolling the host, for frames inline in the chat. */
  containScroll?: boolean;
  onContentHeight: (height: number) => void;
}) {
  const environment = Environment.use();
  const theme = createMemo(() => pageTheme(environment.colorScheme()));
  const src = untrack(
    () =>
      `${props.src.split("#", 1)[0]}${htmlRenderThemeFragment(theme())}${props.containScroll ? HTML_RENDER_CONTAIN_SCROLL_FRAGMENT : ""}`,
  );
  const [frame, setFrame] = createSignal<HTMLIFrameElement>();
  const [loaded, setLoaded] = createSignal(false);
  const [image, setImage] = createSignal<{ src: string; name: string } | null>(null);
  const post = (message: unknown) => frame()?.contentWindow?.postMessage(message, "*");
  const mac = isMacPlatform(navigator.platform);
  const resolve = (shortcut: KeybindingShortcut): HtmlRenderShortcut => ({
    key: shortcut.key,
    metaKey: shortcut.metaKey || (shortcut.modKey && mac),
    ctrlKey: shortcut.ctrlKey || (shortcut.modKey && !mac),
    shiftKey: shortcut.shiftKey,
    altKey: shortcut.altKey,
  });
  // Replays only Cmd/Ctrl chords exclusive to allowed commands, whatever their `when`; live
  // resolution could otherwise type in the composer.
  const shortcuts = createMemo(() => {
    const bindings = environment.keybindings();
    const blocked = bindings
      .filter((binding) => !HTML_RENDER_SHORTCUT_COMMANDS.has(binding.command))
      .map((binding) => resolve(binding.shortcut));
    const allowed = new Map<string, HtmlRenderShortcut>();
    for (const { command, shortcut } of bindings) {
      if (
        HTML_RENDER_SHORTCUT_COMMANDS.has(command) &&
        (shortcut.metaKey || shortcut.ctrlKey || shortcut.modKey)
      ) {
        const resolved = resolve(shortcut);
        allowed.set(shortcutKey(resolved), resolved);
      }
    }
    return { allowed: [...allowed.values()], blocked };
  });
  const postTheme = () => post(htmlRenderThemeMessage(theme()));
  const postShortcuts = () =>
    post(htmlRenderShortcutsMessage(shortcuts().allowed, shortcuts().blocked));
  createTrackedEffect(() => {
    postTheme();
  });
  createTrackedEffect(() => {
    postShortcuts();
  });
  // Pages can forge key and code pairs: a pair matching another binding is refused, and a named
  // key must match the shortcut.
  const isShortcut = (key: NonNullable<ReturnType<typeof readHtmlRenderKeyDown>>) => {
    const matches = (shortcut: HtmlRenderShortcut) =>
      matchesKeybindingShortcut(key, { ...shortcut, modKey: false }, navigator.platform);
    const allowed = shortcuts().allowed.filter(matches);
    return (
      allowed.length > 0 &&
      !shortcuts().blocked.some(matches) &&
      (key.key.length === 1 ||
        key.key === "Dead" ||
        allowed.some((shortcut) => shortcut.key === normalizeEventKey(key.key)))
    );
  };
  // Links, keys and images need frame focus and recent reader activity: a page can take focus by
  // script, so this blocks opens on load, though not a page that waits for the reader's next input.
  const onMessage = (element: HTMLIFrameElement, event: MessageEvent) => {
    const height = readHtmlRenderContentHeight(event.data);
    if (height !== undefined) {
      props.onContentHeight(height);
      return;
    }
    if (document.activeElement !== element || navigator.userActivation?.isActive === false) return;
    const link = readHtmlRenderLinkRequest(event.data);
    if (link !== undefined) {
      window.open(link.url, "_blank", "noopener,noreferrer");
      element.contentWindow?.postMessage(htmlRenderResult(link.id), "*");
      return;
    }
    const key = readHtmlRenderKeyDown(event.data);
    if (key !== undefined) {
      if (isShortcut(key)) {
        element.dispatchEvent(
          new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true }),
        );
      }
      return;
    }
    const request = readHtmlRenderImageRequest(event.data);
    if (request !== undefined) setImage(request.images[request.index] ?? null);
  };
  // Listens from the ref, before the first load, since a fast page posts its height at once.
  const attach = (element: HTMLIFrameElement) => {
    setFrame(element);
    const listener = (event: MessageEvent) => {
      if (event.source === element.contentWindow) onMessage(element, event);
    };
    window.addEventListener("message", listener);
    onCleanup(() => window.removeEventListener("message", listener));
  };
  return (
    <>
      <iframe
        ref={attach}
        src={src}
        title={props.title}
        // Never allow-same-origin: the opaque origin keeps the page out of the app's session.
        sandbox="allow-scripts allow-forms"
        allow="fullscreen"
        loading="lazy"
        onLoad={() => {
          setLoaded(true);
          postTheme();
          postShortcuts();
        }}
        // Matches the blank document's scheme to avoid a white flash in dark mode, then follows the app.
        class={`border-0 scheme-light ${props.class}`}
        style={loaded() ? { "color-scheme": theme().appearance } : undefined}
      />
      <Presence when={image()}>
        {(shown) => (
          <ImageDialog src={shown().src} alt={shown().name} onClose={() => setImage(null)} />
        )}
      </Presence>
    </>
  );
}

// Follows HtmlRenderDialog in apps/web/src/components/chat/HtmlRenderDialog.tsx.
function HtmlRenderDialog(props: {
  src: string;
  htmlRender: HtmlRenderReference;
  onClose: () => void;
}) {
  const [zoom, setZoom] = createSignal(1);
  const [width, setWidth] = createSignal(HTML_RENDER_COLUMN_WIDTH);
  const [contentHeight, setContentHeight] = createSignal<number>();
  // Zoom divides the page's layout width, so the page reflows to fill the card at every level,
  // and the frame is as tall as the page so only the card scrolls.
  const height = () => htmlRenderFrameHeight(props.htmlRender, width() / zoom(), contentHeight());
  let close: HTMLButtonElement | undefined;
  return (
    <Dialog onClose={props.onClose}>
      <DialogPopup
        variant="media"
        showCloseButton={false}
        bottomStickOnMobile={false}
        class="row-start-1"
        initialFocus={() => close ?? null}
      >
        <DialogTitle class="sr-only">Expanded {props.htmlRender.title} preview</DialogTitle>
        {/* 1144px is the widest the server measures a page; pages are written for the reply column. */}
        <div class="relative w-[min(92vw,1176px)]">
          <Button
            ref={close}
            aria-label="Close"
            size="icon-xs"
            variant="media-close"
            class="absolute right-0 -top-10 z-20"
            onClick={() => props.onClose()}
          >
            <X />
          </Button>
          <div class="max-h-[min(86vh,calc(100vh-160px))] overflow-y-auto overscroll-contain rounded-lg bg-background p-4 shadow-2xl ring-1 ring-border/70">
            <div ref={(box) => observeWidth(box, setWidth)}>
              <div style={{ zoom: zoom(), height: `${height()}px` }}>
                <HtmlRenderDocument
                  src={props.src}
                  title={props.htmlRender.title}
                  class="block size-full"
                  onContentHeight={setContentHeight}
                />
              </div>
            </div>
          </div>
          <div class="mt-2 flex min-w-0 items-center justify-center gap-3 text-xs text-white/80">
            <span class="truncate">{props.htmlRender.title}</span>
            <div class="flex shrink-0 items-center gap-1">
              <Button
                aria-label="Zoom out"
                size="icon-sm"
                variant="overlay"
                disabled={zoom() === 0.5}
                onClick={() => setZoom((value) => value - 0.25)}
              >
                <Minus />
              </Button>
              <Button
                aria-label="Reset zoom"
                size="sm"
                variant="overlay"
                onClick={() => setZoom(1)}
              >
                {Math.round(zoom() * 100)}%
              </Button>
              <Button
                aria-label="Zoom in"
                size="icon-sm"
                variant="overlay"
                disabled={zoom() === 2}
                onClick={() => setZoom((value) => value + 0.25)}
              >
                <Plus />
              </Button>
            </div>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
