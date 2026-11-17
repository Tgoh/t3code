import { resolveMediaSource } from "@t3tools/client-runtime/media-source";
import { type AssetResource, ThreadId } from "@t3tools/contracts";
import type { JSX } from "solid-js";
import type { IActionGenerator, IEntity } from "treflex";

import { assetUrlEffect, type IAssetUrl } from "./Infrastructure/commandEffects";
import { serverError } from "./Infrastructure/serverError";

export interface IMarkdownImageUrl extends IEntity {
  Url: string | null;
  Size: IAssetUrl["Size"] | null;
  Failed: boolean;
}

export function* loadImageUrl(
  draft: IMarkdownImageUrl,
  environmentId: string,
  resource: AssetResource,
): IActionGenerator {
  try {
    const asset = yield* assetUrlEffect({ EnvironmentId: environmentId, Resource: resource });
    draft.Url = asset.Url;
    draft.Size = asset.Size ?? null;
  } catch (error) {
    serverError(error);
    draft.Failed = true;
  }
}

export type IMarkdownImageTarget =
  | { Direct: string }
  | { Resource: AssetResource; Fragment: string };

export function markdownImageTarget(
  href: string,
  workspaceRoot: string | undefined,
  threadId: string | undefined,
): IMarkdownImageTarget | null {
  const source = resolveMediaSource(href, {
    threadId: threadId === undefined ? undefined : ThreadId.make(threadId),
    workspaceRoot,
    imageEmbed: true,
  });
  if (source === null || source.kind !== "image") return null;
  if (source.access === "direct") return { Direct: source.uri };
  if (source.access === "unavailable") return null;
  return { Resource: source.resource, Fragment: source.srcFragment };
}

export const sameTarget = (
  left: IMarkdownImageTarget | null,
  right: IMarkdownImageTarget | null,
): boolean => JSON.stringify(left) === JSON.stringify(right);

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
