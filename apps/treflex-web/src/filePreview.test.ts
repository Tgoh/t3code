import { describe, expect, it } from "vite-plus/test";

import {
  attachmentCopyLabel,
  attachmentNeedsText,
  clampFileLine,
  diffPathForWorkspace,
  fileBreadcrumbs,
  markdownBaseDir,
  panelFilePath,
  previewPath,
  readErrorMessage,
  revisionedUrl,
  workspaceCopyable,
  workspaceMediaKind,
} from "./filePreview";
import { keptRead } from "./FilePanel";

describe("the file a preview opens", () => {
  it("drops trailing separators but keeps a bare drive's", () => {
    expect(panelFilePath("src/lib/")).toBe("src/lib");
    expect(panelFilePath("C:/")).toBe("C:/");
    expect(panelFilePath("/")).toBe("/");
  });

  it("has no file for the workspace folder itself", () => {
    expect(previewPath(".", "/repo")).toBeNull();
    expect(previewPath("/repo", "/repo")).toBeNull();
    expect(previewPath("src/a.ts", "/repo")).toBe("src/a.ts");
    expect(previewPath("/elsewhere/b.ts", "/repo")).toBe("/elsewhere/b.ts");
  });

  it("names the project for a workspace path and the root for a host path", () => {
    expect(fileBreadcrumbs("app", "src/a.ts").map((crumb) => crumb.Label)).toEqual([
      "app",
      "src",
      "a.ts",
    ]);
    expect(fileBreadcrumbs("app", "C:\\Users\\me\\x.md").map((crumb) => crumb.Path)).toEqual([
      "C:\\",
      "C:\\Users",
      "C:\\Users\\me",
      "C:\\Users\\me\\x.md",
    ]);
  });
});

describe("revealing a line", () => {
  it("keeps the line inside the file, counting every line ending", () => {
    expect(clampFileLine("a\nb\r\nc\rd", 3)).toBe(3);
    expect(clampFileLine("a\nb\r\nc\rd", 40)).toBe(4);
    expect(clampFileLine("a", 0)).toBe(1);
  });
});

describe("a preview's text", () => {
  it("copies a workspace file only whole, and never media", () => {
    expect(workspaceCopyable({ Contents: "x", Truncated: false }, false)).toBe("x");
    expect(workspaceCopyable({ Contents: "x", Truncated: true }, false)).toBeNull();
    expect(workspaceCopyable({ Contents: "", Truncated: false }, false)).toBeNull();
    expect(workspaceCopyable({ Contents: "x", Truncated: false }, true)).toBeNull();
  });

  it("copies an attachment's cut-off text as a preview", () => {
    expect(attachmentCopyLabel(false, false)).toBe("Copy contents");
    expect(attachmentCopyLabel(false, true)).toBe("Copy preview");
    expect(attachmentCopyLabel(true, true)).toBe("Copied");
  });

  it("reads an attachment's text only for kinds shown as text", () => {
    expect(
      ["text", "markdown", "mermaid", "html"].every((kind) => attachmentNeedsText(kind as never)),
    ).toBe(true);
    expect(attachmentNeedsText("image")).toBe(false);
    expect(attachmentNeedsText("pdf")).toBe(false);
    expect(attachmentNeedsText("unsupported")).toBe(false);
  });

  it("explains the server's refusals in stock's words, and passes others through", () => {
    const refusal = (Failure: string | null, Operation: string | null = null) =>
      readErrorMessage({ Message: "raw", Failure, Operation, AttemptedPath: null, Cwd: null });
    expect(refusal("binary_file")).toBe("The file is binary and cannot be displayed as text.");
    expect(refusal("operation_failed", "realpath-workspace-root")).toBe(
      "The workspace folder could not be accessed.",
    );
    expect(refusal("operation_failed", "open")).toBe(
      "The file could not be accessed or read. It may be missing or inaccessible.",
    );
    expect(refusal(null)).toBe("raw");
  });
});

describe("a diff's file in the workspace", () => {
  it.each([
    [{ filePath: "src/a.ts", workspaceRoot: "/repo", repositoryRoot: "/repo" }, "src/a.ts"],
    [{ filePath: "/repo/src/a.ts", workspaceRoot: "/repo", repositoryRoot: undefined }, "src/a.ts"],
    [{ filePath: "/other/a.ts", workspaceRoot: "/repo", repositoryRoot: undefined }, null],
    // A workspace below its repository root sees only the repository's paths under it.
    [{ filePath: "app/src/a.ts", workspaceRoot: "/repo/app", repositoryRoot: "/repo" }, "src/a.ts"],
    [{ filePath: "lib/b.ts", workspaceRoot: "/repo/app", repositoryRoot: "/repo" }, null],
    [{ filePath: "../x.ts", workspaceRoot: "/repo", repositoryRoot: "/repo" }, null],
    [{ filePath: "src\\..\\x.ts", workspaceRoot: "C:\\repo", repositoryRoot: "C:\\repo" }, null],
    [{ filePath: "App\\a.ts", workspaceRoot: "C:\\repo\\app", repositoryRoot: "C:\\repo" }, "a.ts"],
  ])("places %o at %s", (input, expected) => {
    expect(diffPathForWorkspace(input)).toBe(expected);
  });
});

describe("a previewed file's surroundings", () => {
  it("writes a Markdown file's relative links from its own folder", () => {
    expect(markdownBaseDir("docs/guide.md", "/repo")).toBe("/repo/docs");
    expect(markdownBaseDir("README.md", "/repo")).toBe("/repo");
  });

  it("keys a media URL on the file's revision, else the workspace's changes", () => {
    expect(revisionedUrl("/a?s=1", null, 0)).toBe("/a?s=1");
    expect(revisionedUrl("/a?s=1", null, 2)).toBe("/a?s=1&workspace-revision=2");
    expect(revisionedUrl("/a", "r 1", 2)).toBe("/a?file-revision=r%201");
  });

  it("tells media from text by its path", () => {
    expect(workspaceMediaKind("a.png")).toBe("image");
    expect(workspaceMediaKind("a.mp4")).toBe("video");
    expect(workspaceMediaKind("a.mp3")).toBe("audio");
    expect(workspaceMediaKind("a.ts")).toBeNull();
  });
});

describe("a reread", () => {
  const shown = { Kind: "text", Contents: "a", ByteLength: 1, Truncated: false } as const;
  const refusal = (Failure: string) =>
    ({
      Kind: "error",
      Message: "no",
      Failure,
      Operation: null,
      AttemptedPath: null,
      Cwd: null,
    }) as const;

  it("keeps the shown contents through a dropped read or a refusal, unless the path stopped being a file", () => {
    expect(keptRead(shown, { Kind: "failed", Message: "socket closed" })).toBe(shown);
    expect(keptRead(shown, refusal("operation_failed"))).toBe(shown);
    expect(keptRead(shown, refusal("path_not_file"))).toEqual(refusal("path_not_file"));
    expect(keptRead(null, refusal("operation_failed"))).toEqual(refusal("operation_failed"));
  });

  it("keeps the held read when the contents didn't change, so views over it stay put", () => {
    expect(keptRead(shown, { ...shown })).toBe(shown);
    expect(keptRead(shown, { ...shown, Contents: "b", ByteLength: 1 })).toEqual({
      ...shown,
      Contents: "b",
    });
  });
});
