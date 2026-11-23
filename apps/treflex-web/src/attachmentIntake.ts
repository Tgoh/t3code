import {
  clampFileAttachmentUploadBytes,
  fileAttachmentTooLargeMessage,
  formatAttachmentSize,
} from "@t3tools/client-runtime/state/attachments";
import {
  nextPastedTextFileName,
  pastedTextDisposition,
  wouldTextPasteExceedLimit,
} from "@t3tools/client-runtime/text-paste";
import {
  type ExecutionEnvironmentCapabilities,
  isProviderSendTurnSupportedImageMimeType,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
} from "@t3tools/contracts";
import { isSvgAttachment } from "@t3tools/shared/image";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/mediaPreview";
import { videoMimeType } from "@t3tools/shared/video";

export type IAttachmentKind = "image" | "file";

export interface IAdmittedFile {
  Kind: IAttachmentKind;
  File: File;
  PastedText: boolean;
}

const IMAGE_MIME_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const HEIC_MIME_TYPE = /^image\/hei(?:c|f)$/i;
const HEIC_EXTENSION = /\.(?:heic|heif)$/i;

function isGenericMimeType(type: string): boolean {
  const mimeType = type.toLowerCase();
  return mimeType === "" || mimeType === "application/octet-stream";
}

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? null : name.slice(dot + 1).toLowerCase();
}

function inferredImageMimeType(file: Pick<File, "name" | "type">): string | null {
  if (!isGenericMimeType(file.type)) return null;
  const extension = extensionOf(file.name);
  return extension === null ? null : (IMAGE_MIME_TYPE_BY_EXTENSION[extension] ?? null);
}

/** Finder and some browsers omit the MIME type when dragging HEIC photos. */
export function isHeicFile(file: Pick<File, "name" | "type">): boolean {
  return (
    HEIC_MIME_TYPE.test(file.type) ||
    (isGenericMimeType(file.type) && HEIC_EXTENSION.test(file.name))
  );
}

function isDngFile(file: Pick<File, "name" | "type">): boolean {
  const mimeType = file.type.split(";", 1)[0]?.trim().toLowerCase();
  return (
    file.name.toLowerCase().endsWith(".dng") ||
    mimeType === "image/dng" ||
    mimeType === "image/x-dng" ||
    mimeType === "image/x-adobe-dng"
  );
}

export function classifyAttachmentFile(
  file: Pick<File, "name" | "type">,
): IAttachmentKind | "unsupported-image" {
  if (isSvgAttachment({ name: file.name, mimeType: file.type })) return "file";
  if (isDngFile(file)) return "file";
  if (isHeicFile(file)) return "image";
  if (inferredImageMimeType(file)) return "image";
  if (!file.type.toLowerCase().startsWith("image/")) return "file";
  if (isProviderSendTurnSupportedImageMimeType(file.type)) return "image";
  return isWorkspaceImagePreviewPath(file.name) ? "file" : "unsupported-image";
}

export function fileAttachmentMimeType(file: Pick<File, "name" | "type">): string {
  if (isDngFile(file)) return "image/x-adobe-dng";
  if (isSvgAttachment({ name: file.name, mimeType: file.type })) return "image/svg+xml";
  return (
    videoMimeType({ name: file.name, mimeType: file.type }) ??
    (file.type || "application/octet-stream")
  );
}

function retyped(file: File, type: string): File {
  return file.type === type
    ? file
    : new File([file], file.name, { type, lastModified: file.lastModified });
}

/** Null when the server takes no file attachments. */
export function fileAttachmentLimit(capabilities: ExecutionEnvironmentCapabilities): number | null {
  const advertised = capabilities.fileAttachments?.maxUploadBytes;
  return advertised === undefined ? null : clampFileAttachmentUploadBytes(advertised);
}

const isOnlyFileNames = (text: string, files: ReadonlyArray<File>) => {
  const names = new Set(files.map((file) => file.name));
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .every((line) => names.has(line));
};

/**
 * A browser's Copy Image puts only an <img> in text/html; rich text sources put the text there.
 * Follows isImageOnlyClipboardHtml in apps/web/src/components/chat/composerAttachmentFiles.ts.
 */
export function isImageOnlyClipboardHtml(html: string): boolean {
  if (html.length === 0) return false;
  const body = new DOMParser().parseFromString(html, "text/html").body;
  return body.querySelector("img") !== null && (body.textContent ?? "").trim().length === 0;
}

/** Files win over the clipboard's text only when the text can't stand in for them. */
export function shouldHandleAttachmentPaste(input: {
  readonly files: ReadonlyArray<File>;
  readonly plainText: string;
  readonly bypassAutoAttachment?: boolean;
  readonly htmlIsOnlyImage?: boolean;
}): boolean {
  // Paste as Text keeps the text even when the source also put an image of it on the clipboard.
  if (input.bypassAutoAttachment && input.plainText.length > 0) return false;
  if (
    input.files.some(
      (file) => isDngFile(file) || isSvgAttachment({ name: file.name, mimeType: file.type }),
    )
  ) {
    return true;
  }
  const hasImage = input.files.some((file) => {
    const kind = classifyAttachmentFile(file);
    return kind === "image" || kind === "unsupported-image";
  });
  if (input.plainText.length === 0) {
    return hasImage || input.files.some((file) => classifyAttachmentFile(file) === "file");
  }
  // Rich text sources (Word, Pages) add a picture of the text. Copy Image adds the image URL as
  // text beside an <img>, and a Finder copy adds the file names.
  return (
    hasImage && (input.htmlIsOnlyImage === true || isOnlyFileNames(input.plainText, input.files))
  );
}

export function admitFiles(
  files: ReadonlyArray<File>,
  options: { Reserved: number; FileLimit: number | null; PastedText?: boolean },
): { Accepted: IAdmittedFile[]; Error: string | null } {
  let reserved = options.Reserved;
  const accepted: IAdmittedFile[] = [];
  let error: string | null = null;
  for (const file of files) {
    const kind = classifyAttachmentFile(file);
    if (reserved >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      error = `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files per message.`;
      continue;
    }
    if (kind === "unsupported-image") {
      error = `'${file.name}' is not a supported image type. Attach GIF, HEIC, HEIF, JPEG, PNG, or WebP images.`;
      continue;
    }
    if (kind === "image") {
      if (file.size <= 0) {
        error = `'${file.name}' could not be read as an image.`;
        continue;
      }
      const type = inferredImageMimeType(file) ?? file.type;
      accepted.push({ Kind: "image", File: retyped(file, type), PastedText: false });
    } else {
      if (options.FileLimit === null) {
        error = "This server does not support file attachments.";
        continue;
      }
      if (file.size <= 0) {
        error = `'${file.name}' is empty or could not be read.`;
        continue;
      }
      if (file.size > options.FileLimit) {
        error = fileAttachmentTooLargeMessage(file.name, options.FileLimit);
        continue;
      }
      accepted.push({
        Kind: "file",
        File: retyped(file, fileAttachmentMimeType(file)),
        PastedText: options.PastedText === true,
      });
    }
    reserved += 1;
  }
  return { Accepted: accepted, Error: error };
}

/** cyrb53, synchronous: crypto.subtle is missing on plain-http remote origins. */
function bytesFingerprint(bytes: Uint8Array): string {
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index]!;
    first = Math.imul(first ^ byte, 2654435761);
    second = Math.imul(second ^ byte, 1597334677);
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507);
  first ^= Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507);
  second ^= Math.imul(first ^ (first >>> 13), 3266489909);
  return `${second >>> 0}:${first >>> 0}`;
}

export function attachmentKey(
  kind: IAttachmentKind,
  file: Pick<File, "name" | "type" | "size">,
  bytes?: Uint8Array,
): string {
  const signature = `${file.type}\u0000${file.size}\u0000${file.name}`;
  return kind === "image" && bytes !== undefined
    ? `${signature}\u0000${bytesFingerprint(bytes)}`
    : signature;
}

export type IPastedTextDecision =
  | { Kind: "inline" }
  | { Kind: "attach"; File: File }
  | { Kind: "refuse"; Error: string };

/** A large paste becomes a text file attachment, as stock's composer folds it. */
export function foldPastedText(input: {
  Text: string;
  Bypass: boolean;
  DraftLength: number;
  Selection: { start: number; end: number };
  AttachedNames: ReadonlyArray<string>;
  Reserved: number;
  FileLimit: number | null;
}): IPastedTextDecision {
  const wouldExceedInputLimit = wouldTextPasteExceedLimit({
    valueLength: input.DraftLength,
    selection: input.Selection,
    textLength: input.Text.length,
    maxLength: PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  });
  const disposition = pastedTextDisposition({
    text: input.Text,
    bypassAutoAttachment: input.Bypass,
    wouldExceedInputLimit,
    canAttach: true,
  });
  if (disposition !== "attachment") return { Kind: "inline" };
  if (input.Reserved >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS || input.FileLimit === null) {
    return wouldExceedInputLimit
      ? {
          Kind: "refuse",
          Error:
            "Pasted text is too large for this message. Remove some text or an attachment, then paste again.",
        }
      : { Kind: "inline" };
  }
  const file = new File([input.Text], nextPastedTextFileName(input.AttachedNames), {
    type: "text/plain;charset=utf-8",
  });
  if (file.size > input.FileLimit) {
    return wouldExceedInputLimit
      ? {
          Kind: "refuse",
          Error:
            "Pasted text is too large to attach. Reduce the clipboard contents or save a smaller excerpt as a file.",
        }
      : { Kind: "inline" };
  }
  return { Kind: "attach", File: file };
}

/** A file chip's second line: type and size, or size alone for pasted text. */
export function attachmentDetail(name: string, sizeBytes: number, pastedText: boolean): string {
  const extension = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toUpperCase();
  const size = formatAttachmentSize(sizeBytes);
  return pastedText || extension === undefined ? size : `${extension} · ${size}`;
}

export function splitTransferredFiles(dataTransfer: DataTransfer): {
  files: File[];
  folders: File[];
} {
  const files: File[] = [];
  const folders: File[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file === null) continue;
    if (item.webkitGetAsEntry()?.isDirectory === true) folders.push(file);
    else files.push(file);
  }
  return { files, folders };
}
