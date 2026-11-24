import type { AssetResource } from "@t3tools/contracts";
import type { Tokens } from "marked";
import { createTestRuntime } from "treflex";
import { describe, expect, it } from "vite-plus/test";

import { fileLinkFromHref } from "./fileLinks";
import type { IAssetUrl } from "./Infrastructure/commandEffects";
import {
  EMPTY_MEDIA_URL,
  type IMediaUrl,
  loadMediaUrl,
  mediaFailed,
  markdownImageTarget,
  mediaLinkTarget,
  opensInEditor,
  retryMediaUrl,
  webMediaLinkTarget,
} from "./markdownImage";
import { createMarkdownLexer } from "./markdownTokens";
import { serverFailure } from "./Infrastructure/serverError";

const THREAD = "thread-1";
const ROOT = "G:\\Sorted\\Project";

function imageHref(markdown: string): string {
  const [paragraph] = createMarkdownLexer(false)(markdown).Blocks as [Tokens.Paragraph];
  return (paragraph.tokens.find((token) => token.type === "image") as Tokens.Image).href;
}

const file = (path: string, relative = false, kind = "image") => ({
  Kind: kind,
  Resource: {
    _tag: "media-file",
    threadId: THREAD,
    path,
    ...(relative ? { hostOnly: true } : {}),
  },
  Fragment: "",
});

describe("markdownImageTarget", () => {
  it.each([
    [
      "![Shot](G:\\Sorted\\Code\\t3code-dev-home\\screenshots\\a.png)",
      file("G:\\Sorted\\Code\\t3code-dev-home\\screenshots\\a.png"),
    ],
    ["![Shot](<G:\\My Shots\\a b.png>)", file("G:\\My Shots\\a b.png")],
    ["![Shot](file:///G:/Sorted/a.png)", file("G:/Sorted/a.png")],
    ["![Shot](shots/a.png)", file("G:\\Sorted\\Project\\shots\\a.png", true)],
    ["![Shot](/home/me/a.png)", file("/home/me/a.png")],
    ["![Shot](G:\\Sorted\\a.png#dark)", { ...file("G:\\Sorted\\a.png"), Fragment: "#dark" }],
    ["![Shot](https://example.com/a.png)", { Kind: "image", Direct: "https://example.com/a.png" }],
    [
      "![Shot](data:image/png;base64,AAAA)",
      { Kind: "image", Direct: "data:image/png;base64,AAAA" },
    ],
    ["![Shot](~/a.png)", null],
    [
      "![Demo](C:\\Users\\Tgoh\\Downloads\\treflex-demo-25s.mp4)",
      file("C:\\Users\\Tgoh\\Downloads\\treflex-demo-25s.mp4", false, "video"),
    ],
    ["![Clip](clips/a.webm)", file("G:\\Sorted\\Project\\clips\\a.webm", true, "video")],
    ["![Clip](https://example.com/a.mp4)", { Kind: "video", Direct: "https://example.com/a.mp4" }],
    ["![Song](G:\\Sorted\\a.mp3)", file("G:\\Sorted\\a.mp3", false, "audio")],
    ["![Song](notes/a.wav)", file("G:\\Sorted\\Project\\notes\\a.wav", false, "audio")],
    ["![Song](https://example.com/a.ogg)", { Kind: "audio", Direct: "https://example.com/a.ogg" }],
    ["![Song](~/a.mp3)", null],
  ])("%s", (markdown, expected) => {
    expect(markdownImageTarget(imageHref(markdown), ROOT, THREAD)).toEqual(expected);
  });

  it("blocks a network path outside the workspace, and needs a thread and a root", () => {
    expect(markdownImageTarget("\\\\other-host\\share\\a.png", ROOT, THREAD)).toBeNull();
    expect(markdownImageTarget("G:\\Sorted\\a.png", ROOT, undefined)).toBeNull();
    expect(markdownImageTarget("G:\\Sorted\\a.mp3", ROOT, undefined)).toBeNull();
    expect(markdownImageTarget("shots/a.png", undefined, THREAD)).toBeNull();
  });
});

describe("mediaLinkTarget", () => {
  const target = (href: string, threadId: string | null = THREAD) =>
    mediaLinkTarget(fileLinkFromHref(href, ROOT)!, ROOT, threadId ?? undefined);

  it.each([
    [
      "C:\\Users\\Tgoh\\Downloads\\treflex-demo-25s.mp4",
      file("C:/Users/Tgoh/Downloads/treflex-demo-25s.mp4", false, "video"),
    ],
    ["shots/a.png", file("G:\\Sorted\\Project\\shots\\a.png")],
    ["G:\\Sorted\\a.PNG:12", file("G:/Sorted/a.PNG")],
    ["G:\\Sorted\\a.mp3", null],
    ["src/a.ts", null],
  ])("%s", (href, expected) => {
    expect(target(href)).toEqual(expected);
  });

  it("needs a thread to sign the file", () => {
    expect(target("G:\\Sorted\\a.mp4", null)).toBeNull();
  });
});

describe("webMediaLinkTarget", () => {
  it.each([
    ["https://example.com/a.mp4", { Kind: "video", Direct: "https://example.com/a.mp4" }],
    ["https://example.com/a.png?x=1", { Kind: "image", Direct: "https://example.com/a.png?x=1" }],
    ["https://example.com/a.mp3", null],
    ["https://example.com/page", null],
    ["mailto:me@example.com", null],
  ])("%s", (href, expected) => {
    expect(webMediaLinkTarget(href)).toEqual(expected);
  });
});

describe("opensInEditor", () => {
  it.each([
    [{ metaKey: false, ctrlKey: true }, "Win32", true],
    [{ metaKey: true, ctrlKey: false }, "Win32", false],
    [{ metaKey: true, ctrlKey: false }, "MacIntel", true],
    [{ metaKey: false, ctrlKey: true }, "MacIntel", false],
    [{ metaKey: false, ctrlKey: false }, "Win32", false],
  ])("%o on %s", (event, platform, expected) => {
    expect(opensInEditor(event, platform)).toBe(expected);
  });
});

describe("loadMediaUrl", () => {
  const resource: AssetResource = file("G:\\Sorted\\a.png").Resource as AssetResource;
  const HOUR = 60 * 60_000;

  function media(reply: () => IAssetUrl, held: Partial<IMediaUrl> = {}, now = 0) {
    const asked: unknown[] = [];
    const runtime = createTestRuntime<IMediaUrl>(
      { $Id: "Media", ...EMPTY_MEDIA_URL, ...held },
      {
        assetUrl: (effect: { EnvironmentId: string; Resource: AssetResource }) => {
          asked.push([effect.EnvironmentId, effect.Resource]);
          return reply();
        },
        clockNow: () => now,
      },
    );
    return { runtime, asked };
  }

  async function load(reply: () => IAssetUrl, held: Partial<IMediaUrl> = {}) {
    const { runtime, asked } = media(reply, held);
    await runtime.dispatch(loadMediaUrl, "Media", "env-1", resource);
    return { state: runtime.state, asked };
  }

  it("asks the server to sign the file and keeps its size, expiry and revision", async () => {
    const { state, asked } = await load(() => ({
      Url: "/api/assets/signed",
      ExpiresAt: HOUR,
      Size: { Width: 800, Height: 600 },
      FileRevision: "r1",
    }));
    expect(asked).toEqual([["env-1", resource]]);
    expect(state).toMatchObject({
      Url: "/api/assets/signed",
      ExpiresAt: HOUR,
      Size: { Width: 800, Height: 600 },
      FileRevision: "r1",
      Failed: false,
    });
  });

  it("marks a file the server refuses as failed", async () => {
    const { state } = await load(() => {
      throw serverFailure("not found");
    });
    expect(state).toMatchObject({ Url: null, Failed: true });
  });

  it("clears an earlier failure when a retry signs the file", async () => {
    const { state } = await load(() => ({ Url: "/api/assets/again", ExpiresAt: HOUR }), {
      Failed: true,
    });
    expect(state).toMatchObject({ Url: "/api/assets/again", Failed: false });
  });

  it("signs the file again when a URL fails to load after it expired, and only once", async () => {
    let minted = 0;
    const { runtime, asked } = media(
      () => ({ Url: `/api/assets/renewed-${(minted += 1)}`, ExpiresAt: 3 * HOUR }),
      { Url: "/api/assets/old", ExpiresAt: HOUR },
      2 * HOUR,
    );
    await runtime.dispatch(mediaFailed, "Media", "env-1", resource);
    expect(asked).toHaveLength(1);
    expect(runtime.state).toMatchObject({ Url: "/api/assets/renewed-1", Failed: false });

    await runtime.dispatch(mediaFailed, "Media", "env-1", resource);
    expect(asked).toHaveLength(1);
    expect(runtime.state).toMatchObject({ Url: "/api/assets/renewed-1", Failed: true });
  });

  it("signs a URL again that fails within five minutes of its expiry", async () => {
    const { runtime, asked } = media(
      () => ({ Url: "/api/assets/renewed", ExpiresAt: 2 * HOUR }),
      { Url: "/api/assets/old", ExpiresAt: HOUR },
      HOUR - 4 * 60_000,
    );
    await runtime.dispatch(mediaFailed, "Media", "env-1", resource);
    expect(asked).toHaveLength(1);
    expect(runtime.state).toMatchObject({ Url: "/api/assets/renewed", Failed: false });
  });

  it("clears the URL on a retry, so a view keyed on it waits for the new one", async () => {
    let release!: () => void;
    const { runtime } = media(
      () => {
        return new Promise<IAssetUrl>((resolve) => {
          release = () => resolve({ Url: "/api/assets/retried", ExpiresAt: HOUR });
        }) as never;
      },
      { Url: "/api/assets/expired", ExpiresAt: HOUR, Failed: true },
    );
    const retried = runtime.dispatch(retryMediaUrl, "Media", "env-1", resource);
    await Promise.resolve();
    expect(runtime.state).toMatchObject({ Url: null, Failed: false });
    release();
    await retried;
    expect(runtime.state).toMatchObject({ Url: "/api/assets/retried", Failed: false });
  });
});
