import type { AssetResource } from "@t3tools/contracts";
import type { Tokens } from "marked";
import { createTestRuntime } from "treflex";
import { describe, expect, it } from "vite-plus/test";

import type { IAssetUrl } from "./Infrastructure/commandEffects";
import { type IMarkdownImageUrl, loadImageUrl, markdownImageTarget } from "./markdownImage";
import { createMarkdownLexer } from "./markdownTokens";
import { ServerError } from "./Infrastructure/serverError";
import { watchRuntime } from "./testing/watchRuntime";

const THREAD = "thread-1";
const ROOT = "G:\\Sorted\\Project";

function imageHref(markdown: string): string {
  const [paragraph] = createMarkdownLexer(false)(markdown).Blocks as [Tokens.Paragraph];
  return (paragraph.tokens.find((token) => token.type === "image") as Tokens.Image).href;
}

const file = (path: string, relative = false) => ({
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
    ["![Shot](https://example.com/a.png)", { Direct: "https://example.com/a.png" }],
    ["![Shot](data:image/png;base64,AAAA)", { Direct: "data:image/png;base64,AAAA" }],
    ["![Shot](~/a.png)", null],
    ["![Clip](G:\\Sorted\\clip.mp4)", null],
  ])("%s", (markdown, expected) => {
    expect(markdownImageTarget(imageHref(markdown), ROOT, THREAD)).toEqual(expected);
  });

  it("blocks a network path outside the workspace, and needs a thread and a root", () => {
    expect(markdownImageTarget("\\\\other-host\\share\\a.png", ROOT, THREAD)).toBeNull();
    expect(markdownImageTarget("G:\\Sorted\\a.png", ROOT, undefined)).toBeNull();
    expect(markdownImageTarget("shots/a.png", undefined, THREAD)).toBeNull();
  });
});

describe("loadImageUrl", () => {
  const resource: AssetResource = file("G:\\Sorted\\a.png").Resource as AssetResource;

  async function load(reply: () => IAssetUrl) {
    const asked: unknown[] = [];
    const runtime = createTestRuntime<IMarkdownImageUrl>(
      { $Id: "Image", Url: null, Size: null, Failed: false },
      {
        assetUrl: (effect: { EnvironmentId: string; Resource: AssetResource }) => {
          asked.push([effect.EnvironmentId, effect.Resource]);
          return reply();
        },
      },
    );
    watchRuntime(runtime);
    await runtime.dispatch(loadImageUrl, "Image", "env-1", resource);
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
});
