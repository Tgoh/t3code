import { classifyMarkdownImageSource } from "@t3tools/client-runtime/markdown-images";
import { resolveMediaSource } from "@t3tools/client-runtime/media-source";
import { type AssetResource, ThreadId } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { mediaKindFromPath, mediaMimeTypeFromExtension } from "@t3tools/shared/mediaPreview";
import { fileBasename } from "@t3tools/shared/path";
import type { JSX } from "solid-js";
import type { IActionGenerator, IEntity } from "treflex";

import type { IFileLink } from "./fileLinks";
import { assetUrlEffect, type IAssetUrl } from "./Infrastructure/commandEffects";
import { clockNowEffect } from "./Infrastructure/preferences";
import { serverError } from "./Infrastructure/serverError";

export interface IMediaUrl extends IEntity {
  Url: string | null;
  Size: IAssetUrl["Size"] | null;
  /** When the server stops accepting `Url`, in epoch milliseconds. */
  ExpiresAt: number | null;
  Failed: boolean;
}

export const EMPTY_MEDIA_URL = { Url: null, Size: null, ExpiresAt: null, Failed: false };

// Follows KEEP_URL_MIN_LIFE_MS in packages/client-runtime/src/state/assets.ts.
export const MIN_URL_LIFE_MS = 5 * 60_000;

export function* loadMediaUrl(
  draft: IMediaUrl,
  environmentId: string,
  resource: AssetResource,
): IActionGenerator {
  draft.Failed = false;
  try {
    const asset = yield* assetUrlEffect({ EnvironmentId: environmentId, Resource: resource });
    draft.Url = asset.Url;
    draft.ExpiresAt = asset.ExpiresAt;
    draft.Size = asset.Size ?? null;
  } catch (error) {
    serverError(error);
    draft.Failed = true;
  }
}

/**
 * A lazy image, or a video seeking, loads from its URL long after it was signed. One that failed
 * near or past its expiry is signed again; a fresh URL that fails is a missing file.
 */
export function* mediaFailed(
  draft: IMediaUrl,
  environmentId: string,
  resource: AssetResource,
): IActionGenerator {
  const now = yield* clockNowEffect();
  if (draft.ExpiresAt === null || draft.ExpiresAt - now > MIN_URL_LIFE_MS) {
    draft.Failed = true;
    return;
  }
  draft.Url = null;
  yield* loadMediaUrl(draft, environmentId, resource);
}

export type IMediaKind = "image" | "video" | "audio";

export type IMediaTarget = { Kind: IMediaKind } & (
  | { Direct: string }
  | { Resource: AssetResource; Fragment: string }
);

const threadIdOf = (threadId: string | undefined) =>
  threadId === undefined ? undefined : ThreadId.make(threadId);

// Follows the `img` renderer in apps/web/src/components/ChatMarkdown.tsx: audio is classified
// before images and videos, and its resource never carries `hostOnly`.
function audioTarget(
  href: string,
  workspaceRoot: string | undefined,
  threadId: string | undefined,
): IMediaTarget | null {
  const source = classifyMarkdownImageSource(href, workspaceRoot);
  if (source._tag === "Direct") return { Kind: "audio", Direct: source.uri };
  if (source._tag !== "WorkspaceFile" || threadId === undefined) return null;
  return {
    Kind: "audio",
    Resource: { _tag: "media-file", threadId: ThreadId.make(threadId), path: source.path },
    Fragment: "",
  };
}

export function markdownImageTarget(
  href: string,
  workspaceRoot: string | undefined,
  threadId: string | undefined,
): IMediaTarget | null {
  if (mediaKindFromPath(href) === "audio") return audioTarget(href, workspaceRoot, threadId);
  const source = resolveMediaSource(href, {
    threadId: threadIdOf(threadId),
    workspaceRoot,
    imageEmbed: true,
  });
  if (source === null || source.access === "unavailable") return null;
  if (source.access === "direct") return { Kind: source.kind, Direct: source.uri };
  return { Kind: source.kind, Resource: source.resource, Fragment: source.srcFragment };
}

// Follows `canPreviewMedia` in ChatMarkdown.tsx's `fileLinkChip` and `resolveMarkdownMediaPreview`
// in apps/web/src/components/chat/ExpandedImagePreview.tsx. Audio isn't previewable there.
export function mediaLinkTarget(
  link: IFileLink,
  workspaceRoot: string | undefined,
  threadId: string | undefined,
): IMediaTarget | null {
  const name = fileBasename(link.FilePath);
  if (mediaMimeTypeFromExtension(name.slice(name.lastIndexOf("."))) === null) return null;
  const source = resolveMediaSource(link.FilePath, {
    threadId: threadIdOf(threadId),
    workspaceRoot,
    resolvedFilePath: link.FilePath,
  });
  if (source === null || source.access !== "environment") return null;
  return { Kind: source.kind, Resource: source.resource, Fragment: "" };
}

// Follows the media branch of ChatMarkdown.tsx's `a` click handler.
export function webMediaLinkTarget(href: string): IMediaTarget | null {
  if (!/^https?:\/\/[^/]/i.test(href)) return null;
  const kind = mediaKindFromPath(href);
  return kind === null || kind === "audio" ? null : { Kind: kind, Direct: href };
}

// Follows shouldOpenMarkdownFileLinkInEditor in apps/web/src/markdown-links.ts.
export function opensInEditor(
  event: Pick<MouseEvent, "metaKey" | "ctrlKey">,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): boolean {
  if (platform.length === 0) return false;
  return isMacPlatform(platform)
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

export const sameTarget = (left: IMediaTarget | null, right: IMediaTarget | null): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

// Follows authoredImageSizeStyle in apps/web/src/components/chat/ChatMarkdownMedia.tsx.
export function imageSizeStyle(size: IAssetUrl["Size"] | null): JSX.CSSProperties | undefined {
  if (size == null) return undefined;
  const { Width: width, Height: height } = size;
  return {
    width: `${width}px`,
    height: "auto",
    "aspect-ratio": `${width} / ${height}`,
    "max-width": `min(100%, 30rem, ${(30 * width) / height}rem)`,
  };
}

// Follows apps/web/src/lib/videoFirstFrame.ts: a paused video at 0 shows no frame on iOS.
export function prepareVideoFirstFrame(video: HTMLVideoElement): void {
  if (
    video.autoplay ||
    !video.paused ||
    video.seeking ||
    video.currentTime !== 0 ||
    video.played.length > 0 ||
    !Number.isFinite(video.duration) ||
    video.duration <= 0
  ) {
    return;
  }
  const fragment = video.src.split("#", 2)[1];
  if (fragment && new URLSearchParams(fragment).has("t")) return;
  try {
    video.currentTime = Math.min(0.1, video.duration / 2);
  } catch {
    // A rejected seek must leave the native Play control usable.
  }
}
