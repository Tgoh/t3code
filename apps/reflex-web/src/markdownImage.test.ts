import type { AssetResource } from "@t3tools/contracts";
import type { Tokens } from "marked";
import { createTestRuntime } from "treflex";
import { describe, expect, it } from "vite-plus/test";

import { fileLinkFromHref } from "./fileLinks";
import type { IAssetUrl } from "./Infrastructure/commandEffects";
import {
  type IMediaUrl,
  loadMediaUrl,
  markdownImageTarget,
  mediaLinkTarget,
  opensInEditor,
  webMediaLinkTarget,
} from "./markdownImage";
import { createMarkdownLexer } from "./markdownTokens";
import { ServerError } from "./Infrastructure/serverError";

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

  async function load(reply: () => IAssetUrl, failed = false) {
    const asked: unknown[] = [];
    const runtime = createTestRuntime<IMediaUrl>(
      { $Id: "Media", Url: null, Size: null, Failed: failed },
      {
        assetUrl: (effect: { EnvironmentId: string; Resource: AssetResource }) => {
          asked.push([effect.EnvironmentId, effect.Resource]);
          return reply();
        },
      },
    );
    await runtime.dispatch(loadMediaUrl, "Media", "env-1", resource);
    return { state: runtime.state, asked };
  }

  it("asks the server to sign the file and keeps its size", async () => {
    const { state, asked } = await load(() => ({
      Url: "/api/assets/signed",
      Size: { Width: 800, Height: 600 },
    }));
    expect(asked).toEqual([["env-1", resource]]);
    expect(state).toMatchObject({
      Url: "/api/assets/signed",
      Size: { Width: 800, Height: 600 },
      Failed: false,
    });
  });

  it("marks a file the server refuses as failed", async () => {
    const { state } = await load(() => {
      throw new ServerError("not found");
    });
    expect(state).toMatchObject({ Url: null, Failed: true });
  });

  it("clears an earlier failure when a retry signs the file", async () => {
    const { state } = await load(() => ({ Url: "/api/assets/again" }), true);
    expect(state).toMatchObject({ Url: "/api/assets/again", Failed: false });
  });
});
