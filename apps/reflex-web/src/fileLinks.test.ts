import { describe, expect, it } from "vite-plus/test";

import {
  chipLabel,
  fileLinkFromCode,
  fileLinkFromHref,
  fileLinkPathsKey,
  isEditorLinkHref,
  labelNamesFile,
  parentSuffixes,
  prosePathParts,
} from "./fileLinks";

const CWD = "G:\\Work\\app";

describe("fileLinkFromHref", () => {
  it.each([
    [
      "src/a.ts:42",
      { FilePath: "G:\\Work\\app\\src\\a.ts", TargetPath: "G:\\Work\\app\\src\\a.ts:42", Line: 42 },
    ],
    ["src/a.ts#L3-L9", { FilePath: "G:\\Work\\app\\src\\a.ts", Line: 3, EndLine: 9 }],
    ["G:\\Other\\b.cs", { FilePath: "G:/Other/b.cs", TargetPath: "G:/Other/b.cs" }],
    ["file:///G:/Other/c.md", { FilePath: "G:/Other/c.md" }],
    ["/home/me/d.py:10:4", { FilePath: "/home/me/d.py", Line: 10, Column: 4 }],
  ])("links %s", (href, expected) => {
    expect(fileLinkFromHref(href, CWD)).toMatchObject(expected);
  });

  it.each(["https://example.com/a.ts", "#section", "vscode://file/G:/a.ts:3", "mailto:me@x.y"])(
    "leaves %s alone",
    (href) => {
      expect(fileLinkFromHref(href, CWD)).toBeNull();
    },
  );

  it("needs a workspace to place a relative path", () => {
    expect(fileLinkFromHref("src/a.ts", undefined)).toBeNull();
  });
});

describe("fileLinkFromCode", () => {
  it.each([
    ["file.ts:42", "G:\\Work\\app\\file.ts:42"],
    ["src/Markdown.tsx", "G:\\Work\\app\\src\\Markdown.tsx"],
    ["C:\\tools\\run.ps1", "C:\\tools\\run.ps1"],
  ])("links `%s`", (code, target) => {
    expect(fileLinkFromCode(code, CWD)?.TargetPath).toBe(target);
  });

  it.each(["const a = 1", "npm run dev", "example.com/a", "v1.2.3", "a/b", "foo.bar()"])(
    "keeps `%s` as code",
    (code) => {
      expect(fileLinkFromCode(code, CWD)).toBeNull();
    },
  );
});

describe("prosePathParts", () => {
  it("splits out rooted paths and trims trailing punctuation", () => {
    expect(prosePathParts("See /home/me/a.ts:3, then /usr/lib/x.so.")).toEqual([
      "See ",
      { Path: "/home/me/a.ts:3" },
      ", then ",
      { Path: "/usr/lib/x.so" },
      ".",
    ]);
  });

  it("leaves routes and plain text whole", () => {
    expect(prosePathParts("GET /api/users.json returns")).toEqual(["GET /api/users.json returns"]);
    expect(prosePathParts("nothing here")).toEqual(["nothing here"]);
  });
});

describe("labels", () => {
  it("names parents only where basenames collide", () => {
    const text = "Changed [a](src/one/index.ts) and `src/two/index.ts:5` and `lib/util.ts`.";
    const suffixes = parentSuffixes(fileLinkPathsKey(text, CWD));
    expect(chipLabel(fileLinkFromHref("src/one/index.ts", CWD)!, suffixes)).toBe(
      "index.ts · src/one",
    );
    expect(chipLabel(fileLinkFromCode("src/two/index.ts:5", CWD)!, suffixes)).toBe(
      "index.ts · src/two · L5",
    );
    expect(chipLabel(fileLinkFromCode("lib/util.ts", CWD)!, suffixes)).toBe("util.ts");
  });

  it("keeps its key while streamed text adds no file", () => {
    expect(fileLinkPathsKey("See `a.ts:1` and more", CWD)).toBe(
      fileLinkPathsKey("See `a.ts:1` and more words still", CWD),
    );
  });

  it("drops a link's text only when it names the file", () => {
    expect(labelNamesFile("a.ts", "src/a.ts")).toBe(true);
    expect(labelNamesFile("src/a.ts:4", "src/a.ts:4")).toBe(true);
    expect(labelNamesFile("the parser", "src/a.ts")).toBe(false);
  });
});

describe("isEditorLinkHref", () => {
  it.each([
    ["vscode://file/G:/a.ts:3", true],
    ["cursor://file/home/me/a.ts", true],
    ["vscode://ms-python.python/run", false],
    ["https://example.com", false],
    ["not a url", false],
  ])("%s → %s", (href, expected) => {
    expect(isEditorLinkHref(href)).toBe(expected);
  });
});
