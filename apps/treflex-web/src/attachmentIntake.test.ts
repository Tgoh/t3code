import { describe, expect, it } from "vite-plus/test";

import {
  admitFiles,
  attachmentDetail,
  attachmentKey,
  classifyAttachmentFile,
  fileAttachmentLimit,
  foldPastedText,
  shouldHandleAttachmentPaste,
} from "./attachmentIntake";

const MB = 1024 * 1024;
const file = (name: string, type: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type });

describe("classifying attachments", () => {
  it("sends provider image types as images and everything else as files", () => {
    expect(classifyAttachmentFile(file("shot.png", "image/png"))).toBe("image");
    expect(classifyAttachmentFile(file("notes.md", "text/markdown"))).toBe("file");
    expect(classifyAttachmentFile(file("notes.md", ""))).toBe("file");
    expect(classifyAttachmentFile(file("logo.svg", "image/svg+xml"))).toBe("file");
    expect(classifyAttachmentFile(file("raw.dng", "image/x-adobe-dng"))).toBe("file");
  });

  it("takes HEIC as an image to convert, and refuses images providers can't take", () => {
    expect(classifyAttachmentFile(file("photo.heic", "image/heic"))).toBe("image");
    expect(classifyAttachmentFile(file("photo.HEIF", ""))).toBe("image");
    expect(classifyAttachmentFile(file("scan.xyz", "image/x-unknown"))).toBe("unsupported-image");
  });
});

describe("duplicate attachments", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  it("matches an image by its name, type, size and bytes", () => {
    const shot = { name: "shot.png", type: "image/png", size: 3 };
    expect(attachmentKey("image", shot, bytes(1, 2, 3))).toBe(
      attachmentKey("image", shot, bytes(1, 2, 3)),
    );
    expect(attachmentKey("image", shot, bytes(1, 2, 3))).not.toBe(
      attachmentKey("image", shot, bytes(1, 2, 4)),
    );
    expect(attachmentKey("image", shot, bytes(1, 2, 3))).not.toBe(
      attachmentKey("image", { ...shot, name: "other.png" }, bytes(1, 2, 3)),
    );
  });

  it("matches a file by its name, type and size, as stock does", () => {
    const notes = { name: "notes.md", type: "text/markdown", size: 3 };
    expect(attachmentKey("file", notes)).toBe(attachmentKey("file", notes));
    expect(attachmentKey("file", notes)).not.toBe(attachmentKey("file", { ...notes, size: 4 }));
  });
});

describe("admitting files", () => {
  const limit = 50 * MB;

  it("types an untyped image by its extension and a file by its kind", () => {
    const { Accepted, Error } = admitFiles([file("shot.png", ""), file("clip.mov", "")], {
      Reserved: 0,
      FileLimit: limit,
    });
    expect(Error).toBeNull();
    expect(Accepted.map((entry) => [entry.Kind, entry.File.type])).toEqual([
      ["image", "image/png"],
      ["file", "video/quicktime"],
    ]);
  });

  it("keeps what fits and reports the last refusal with stock's wording", () => {
    const { Accepted, Error } = admitFiles(
      [file("big.zip", "application/zip", limit + 1), file("ok.md", "text/markdown")],
      { Reserved: 0, FileLimit: limit },
    );
    expect(Accepted.map((entry) => entry.File.name)).toEqual(["ok.md"]);
    expect(Error).toBe("'big.zip' exceeds the 50 MB attachment limit.");

    expect(
      admitFiles([file("empty.txt", "text/plain", 0)], { Reserved: 0, FileLimit: limit }).Error,
    ).toBe("'empty.txt' is empty or could not be read.");
    expect(
      admitFiles([file("a.md", "text/markdown")], { Reserved: 0, FileLimit: null }).Error,
    ).toBe("This server does not support file attachments.");
    expect(
      admitFiles([file("scan.xyz", "image/x-unknown")], { Reserved: 0, FileLimit: limit }).Error,
    ).toBe(
      "'scan.xyz' is not a supported image type. Attach GIF, HEIC, HEIF, JPEG, PNG, or WebP images.",
    );
  });

  it("takes an image over the provider's limit, which preparation shrinks", () => {
    const { Accepted, Error } = admitFiles([file("huge.jpg", "image/jpeg", 10 * MB + 1)], {
      Reserved: 0,
      FileLimit: limit,
    });
    expect(Error).toBeNull();
    expect(Accepted.map((entry) => entry.Kind)).toEqual(["image"]);
  });

  it("stops at the per-message attachment cap, counting what's already attached", () => {
    const { Accepted, Error } = admitFiles(
      [file("a.md", "text/markdown"), file("b.md", "text/markdown")],
      {
        Reserved: 99,
        FileLimit: limit,
      },
    );
    expect(Accepted.map((entry) => entry.File.name)).toEqual(["a.md"]);
    expect(Error).toBe("You can attach up to 100 files per message.");
  });

  it("marks a folded paste as pasted text", () => {
    const { Accepted } = admitFiles([file("pasted-text.txt", "text/plain")], {
      Reserved: 0,
      FileLimit: limit,
      PastedText: true,
    });
    expect(Accepted[0]?.PastedText).toBe(true);
  });

  it("takes the server's limit, capped at what a turn may carry", () => {
    expect(fileAttachmentLimit({ repositoryIdentity: false })).toBeNull();
    expect(
      fileAttachmentLimit({
        repositoryIdentity: false,
        fileAttachments: { maxUploadBytes: 500 * MB },
      }),
    ).toBe(50 * MB);
  });
});

describe("pasting", () => {
  it("lets the clipboard's text win over a non-image file, as a copied file in Explorer has both", () => {
    const markdown = [file("notes.md", "text/markdown")];
    expect(shouldHandleAttachmentPaste({ files: markdown, plainText: "notes.md" })).toBe(false);
    expect(shouldHandleAttachmentPaste({ files: markdown, plainText: "" })).toBe(true);
  });

  it("attaches an image beside text only for Copy Image or a copied file, never for rich text", () => {
    const shot = [file("shot.png", "image/png")];
    expect(shouldHandleAttachmentPaste({ files: shot, plainText: "" })).toBe(true);
    // Word and Pages put a picture of the copied text beside it.
    expect(shouldHandleAttachmentPaste({ files: shot, plainText: "Quarterly notes" })).toBe(false);
    expect(
      shouldHandleAttachmentPaste({
        files: shot,
        plainText: "https://example.com/shot.png",
        htmlIsOnlyImage: true,
      }),
    ).toBe(true);
    expect(shouldHandleAttachmentPaste({ files: shot, plainText: "shot.png" })).toBe(true);
    expect(
      shouldHandleAttachmentPaste({
        files: shot,
        plainText: "shot.png",
        bypassAutoAttachment: true,
      }),
    ).toBe(false);
    expect(
      shouldHandleAttachmentPaste({ files: [file("logo.svg", "image/svg+xml")], plainText: "x" }),
    ).toBe(true);
  });

  const paste = (text: string, overrides: Partial<Parameters<typeof foldPastedText>[0]> = {}) =>
    foldPastedText({
      Text: text,
      Bypass: false,
      DraftLength: 0,
      Selection: { start: 0, end: 0 },
      AttachedNames: [],
      Reserved: 0,
      FileLimit: 50 * MB,
      ...overrides,
    });
  const large = "x".repeat(32 * 1024);

  it("keeps a short paste inline and folds a large one into a numbered text file", () => {
    expect(paste("hello").Kind).toBe("inline");
    const folded = paste(large, { AttachedNames: ["pasted-text.txt"] });
    expect(folded.Kind === "attach" && [folded.File.name, folded.File.size]).toEqual([
      "pasted-text-2.txt",
      32 * 1024,
    ]);
  });

  it("keeps a large paste inline when asked", () => {
    expect(paste(large, { Bypass: true }).Kind).toBe("inline");
  });

  it("refuses a paste the message can't hold when it can't be attached either", () => {
    expect(paste(large, { FileLimit: null }).Kind).toBe("inline");
    expect(paste("x".repeat(120_001), { FileLimit: null })).toEqual({
      Kind: "refuse",
      Error:
        "Pasted text is too large for this message. Remove some text or an attachment, then paste again.",
    });
  });
});

describe("file chips", () => {
  it("show the type and size, or just the size for pasted text", () => {
    expect(attachmentDetail("notes.md", 2048, false)).toBe("MD · 2 KB");
    expect(attachmentDetail("pasted-text.txt", 40 * 1024, true)).toBe("40 KB");
    expect(attachmentDetail("Makefile", 10, false)).toBe("1 KB");
  });
});
