import type { ProjectIconColor } from "@t3tools/contracts";
import type { ProjectFaviconCache } from "@t3tools/client-runtime/project-favicon-cache";
import { getProjectFaviconResourceKey } from "@t3tools/shared/projectFavicon";

import type { IWireProject } from "./Infrastructure/wire";

export interface IProjectFaviconTarget {
  EnvironmentId: string;
  Cwd: string;
  FaviconPath: string | null;
}

export type IProjectIconFace =
  | { Kind: "image"; Src: string }
  | { Kind: "monogram"; Text: string; Color: ProjectIconColor }
  | { Kind: "emoji"; Emoji: string }
  | { Kind: "lucide"; Name: string; Color: ProjectIconColor };

type IIconProject = Pick<IWireProject, "title" | "workspaceRoot" | "faviconPath" | "projectIcon">;

// Order copies PROJECT_ICON_COLORS in apps/web/src/projectIconColors.ts: the hash below indexes
// it, so a reorder changes every project's colour.
export const PROJECT_ICON_COLORS: readonly ProjectIconColor[] = [
  "gray",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];

const normalize = (name: string): string => name.normalize("NFKC").trim();

// Follows projectMonogram in apps/web/src/projectIdentity.ts.
export function projectMonogram(name: string): string {
  const words = normalize(name).match(/[\p{L}\p{N}]+/gu) ?? [];
  const firstWord = words[0];
  if (!firstWord) return "PR";
  const glyphs = Array.from(firstWord);
  const first = glyphs[0] ?? "P";
  const second =
    glyphs.slice(1).find((glyph) => /\p{N}/u.test(glyph)) ??
    (words.length > 1 ? Array.from(words.at(-1) ?? "")[0] : glyphs.at(-1)) ??
    first;
  return Array.from(`${first}${second}`.toUpperCase()).slice(0, 2).join("");
}

// Follows projectColor in apps/web/src/projectIdentity.ts.
export function projectColor(name: string): ProjectIconColor {
  const seed = normalize(name).toLocaleLowerCase("en-US") || "project";
  let index = 0;
  for (const glyph of seed) {
    index = (index * 31 + (glyph.codePointAt(0) ?? 0)) % PROJECT_ICON_COLORS.length;
  }
  return PROJECT_ICON_COLORS[index] ?? "blue";
}

export function faviconTarget(
  environmentId: string,
  project: IIconProject | undefined,
): IProjectFaviconTarget | null {
  if (project === undefined || project.projectIcon != null) return null;
  return {
    EnvironmentId: environmentId,
    Cwd: project.workspaceRoot,
    FaviconPath: project.faviconPath ?? null,
  };
}

export const faviconKey = (target: IProjectFaviconTarget): string =>
  getProjectFaviconResourceKey(target.EnvironmentId, target.Cwd, target.FaviconPath);

// Follows ProjectFavicon in apps/web/src/components/ProjectFavicon.tsx: an override wins, then the
// workspace's image once it resolves and until it fails to load, then the title's monogram.
export function projectIconFace(
  project: IIconProject | undefined,
  src: string | null | undefined,
  failedSrc: string | null,
): IProjectIconFace {
  const icon = project?.projectIcon;
  if (icon?.kind === "monogram") return { Kind: "monogram", Text: icon.text, Color: icon.color };
  if (icon?.kind === "emoji") return { Kind: "emoji", Emoji: icon.emoji };
  if (icon?.kind === "lucide") return { Kind: "lucide", Name: icon.name, Color: icon.color };
  if (src != null && src !== failedSrc) return { Kind: "image", Src: src };
  const title = project?.title ?? "Unknown project";
  return { Kind: "monogram", Text: projectMonogram(title), Color: projectColor(title) };
}

export const FAVICON_REFRESH_MS = 30 * 60_000;
// Matches ASSET_URL_MAX_IN_FLIGHT in packages/client-runtime/src/state/assets.ts.
export const FAVICON_MAX_IN_FLIGHT = 6;

/**
 * One resolved source per workspace icon, shared by every badge that shows it. A key asks the
 * server once per refresh interval however many badges request it, and at most a few keys ask
 * at once. `undefined` in the exposed record is unresolved, `null` is no image.
 */
export function createProjectFaviconSource(input: {
  readonly mint: (target: IProjectFaviconTarget, signal: AbortSignal) => Promise<string>;
  readonly cache: Pick<ProjectFaviconCache, "hydrate" | "peek" | "resolve">;
  readonly expose: (srcs: Readonly<Record<string, string | null>>) => void;
  readonly signal: AbortSignal;
  readonly now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const srcs: Record<string, string | null> = {};
  const requestedAt = new Map<string, number>();
  const waiting: Array<() => Promise<void>> = [];
  let active = 0;
  let exposeQueued = false;

  const set = (key: string, src: string | null) => {
    if (input.signal.aborted || srcs[key] === src) return;
    srcs[key] = src;
    if (exposeQueued) return;
    exposeQueued = true;
    queueMicrotask(() => {
      exposeQueued = false;
      if (!input.signal.aborted) input.expose({ ...srcs });
    });
  };

  const pump = () => {
    while (active < FAVICON_MAX_IN_FLIGHT && waiting.length > 0) {
      const job = waiting.shift()!;
      active += 1;
      void job().finally(() => {
        active -= 1;
        pump();
      });
    }
  };

  const resolve = async (target: IProjectFaviconTarget, key: string) => {
    const cacheTarget = {
      environmentId: target.EnvironmentId as never,
      cwd: target.Cwd,
      faviconPath: target.FaviconPath,
    };
    const url = await input.mint(target, input.signal).catch(() => null);
    if (input.signal.aborted) return;
    set(key, await input.cache.resolve(cacheTarget, url, input.signal).catch(() => null));
  };

  return {
    request(target: IProjectFaviconTarget) {
      const key = faviconKey(target);
      const at = requestedAt.get(key);
      if (at !== undefined && now() - at < FAVICON_REFRESH_MS) return;
      requestedAt.set(key, now());
      void input.cache.hydrate().then(() => {
        if (srcs[key] !== undefined) return;
        const cached = input.cache.peek({
          environmentId: target.EnvironmentId as never,
          cwd: target.Cwd,
          faviconPath: target.FaviconPath,
        });
        if (cached !== null) set(key, cached);
      });
      waiting.push(() => resolve(target, key));
      pump();
    },
  };
}
