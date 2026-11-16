import { describe, expect, it } from "vite-plus/test";

import {
  createProjectFaviconSource,
  FAVICON_MAX_IN_FLIGHT,
  FAVICON_REFRESH_MS,
  faviconKey,
  faviconTarget,
  type IProjectFaviconTarget,
  projectIconFace,
} from "./projectIcon";

const project = (extra: object = {}) =>
  ({ title: "t3code", workspaceRoot: "G:/code/t3code", ...extra }) as never;

describe("projectIconFace", () => {
  it("prefers an override to the workspace image", () => {
    const src = "data:image/png;base64,AA==";
    expect(
      projectIconFace(project({ projectIcon: { kind: "emoji", emoji: "🚀" } }), src, null),
    ).toEqual({ Kind: "emoji", Emoji: "🚀" });
    expect(
      projectIconFace(
        project({ projectIcon: { kind: "monogram", text: "TC", color: "red" } }),
        src,
        null,
      ),
    ).toEqual({ Kind: "monogram", Text: "TC", Color: "red" });
    expect(
      projectIconFace(
        project({ projectIcon: { kind: "lucide", name: "rocket", color: "blue" } }),
        src,
        null,
      ),
    ).toEqual({ Kind: "lucide", Name: "rocket", Color: "blue" });
  });

  it("shows the image once resolved, and the title's monogram before, without one, or after it fails", () => {
    const src = "https://host/api/assets/abc/icon.png";
    expect(projectIconFace(project(), src, null)).toEqual({ Kind: "image", Src: src });
    for (const shown of [
      projectIconFace(project(), undefined, null),
      projectIconFace(project(), null, null),
      projectIconFace(project(), src, src),
    ]) {
      expect(shown).toMatchObject({ Kind: "monogram", Text: "T3" });
    }
    expect(projectIconFace(project(), "https://host/other.png", src).Kind).toBe("image");
  });

  it("asks for no image when an override is set or the project is unknown", () => {
    expect(faviconTarget("env", undefined)).toBeNull();
    expect(
      faviconTarget("env", project({ projectIcon: { kind: "emoji", emoji: "🚀" } })),
    ).toBeNull();
    expect(faviconTarget("env", project({ faviconPath: "public/icon.svg" }))).toEqual({
      EnvironmentId: "env",
      Cwd: "G:/code/t3code",
      FaviconPath: "public/icon.svg",
    });
  });
});

function harness(cached: Record<string, string> = {}) {
  let clock = 0;
  const minted: string[] = [];
  const releases: Array<() => void> = [];
  const exposed: Array<Readonly<Record<string, string | null>>> = [];
  const abort = new AbortController();
  const source = createProjectFaviconSource({
    signal: abort.signal,
    now: () => clock,
    expose: (srcs) => exposed.push(srcs),
    mint: (target) => {
      minted.push(target.Cwd);
      return new Promise((resolve, reject) =>
        releases.push(() =>
          target.Cwd.includes("broken") ? reject(new Error("no")) : resolve(`url:${target.Cwd}`),
        ),
      );
    },
    cache: {
      hydrate: async () => {},
      peek: (target) => cached[target.cwd] ?? null,
      resolve: async (target, url) =>
        url === null ? (cached[target.cwd] ?? null) : `data:image/png;base64,${target.cwd}`,
    },
  });
  const settle = async () => {
    for (let round = 0; round < 10; round++) await Promise.resolve();
  };
  return {
    source,
    minted,
    exposed,
    advance: (ms: number) => (clock += ms),
    release: async () => {
      releases.splice(0).forEach((release) => release());
      await settle();
    },
    settle,
  };
}

const target = (cwd: string): IProjectFaviconTarget => ({
  EnvironmentId: "env",
  Cwd: cwd,
  FaviconPath: null,
});

describe("createProjectFaviconSource", () => {
  it("asks once per icon however many badges request it, until the refresh interval", async () => {
    const run = harness();
    for (let badge = 0; badge < 50; badge++) run.source.request(target("a"));
    await run.release();
    expect(run.minted).toEqual(["a"]);
    expect(run.exposed.at(-1)).toEqual({ [faviconKey(target("a"))]: "data:image/png;base64,a" });
    run.advance(FAVICON_REFRESH_MS);
    run.source.request(target("a"));
    expect(run.minted).toEqual(["a", "a"]);
  });

  it("keeps only a few requests in flight across many projects", async () => {
    const run = harness();
    for (let index = 0; index < 20; index++) run.source.request(target(`p${index}`));
    expect(run.minted).toHaveLength(FAVICON_MAX_IN_FLIGHT);
    await run.release();
    expect(run.minted).toHaveLength(FAVICON_MAX_IN_FLIGHT * 2);
    while (run.minted.length < 20) await run.release();
    await run.release();
    expect(Object.keys(run.exposed.at(-1) ?? {})).toHaveLength(20);
  });

  it("shows a stored thumbnail before the server answers, and keeps it when the server can't", async () => {
    const run = harness({ broken: "data:image/png;base64,stored" });
    run.source.request(target("broken"));
    await run.settle();
    expect(run.exposed.at(-1)).toEqual({
      [faviconKey(target("broken"))]: "data:image/png;base64,stored",
    });
    await run.release();
    expect(run.exposed.at(-1)?.[faviconKey(target("broken"))]).toBe("data:image/png;base64,stored");
  });
});
