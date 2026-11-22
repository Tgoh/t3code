import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import {
  createProjectFaviconCache,
  createProjectFaviconImageLoader,
  PROJECT_FAVICON_MAX_DATA_URL_LENGTH,
  PROJECT_FAVICON_THUMBNAIL_SIZE,
} from "@t3tools/client-runtime/project-favicon-cache";
import { request } from "@t3tools/client-runtime/rpc";
import { projectFaviconResource, resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { IResourceImplementation } from "treflex";

import { createProjectFaviconSource, type IProjectFaviconTarget } from "../projectIcon";
import { connectionRuntime } from "./connection";

declare module "treflex" {
  interface IResourceTypeRegistry {
    projectFavicons: {
      Params: { EnvironmentId: string };
      Methods: { request(target: IProjectFaviconTarget): void };
      Value: Readonly<Record<string, string | null>>;
    };
  }
}

// Storage and downscaling follow apps/web/src/assets/projectFaviconCache.ts. Each port is its own
// origin, so this database isn't shared with stock web.
const DATABASE_NAME = "t3code:project-favicons";
const DATABASE_VERSION = 2;
const STORE_NAME = "images";
let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    opening.addEventListener("upgradeneeded", () => {
      for (const name of opening.result.objectStoreNames) {
        if (name !== STORE_NAME) opening.result.deleteObjectStore(name);
      }
      if (!opening.result.objectStoreNames.contains(STORE_NAME)) {
        opening.result.createObjectStore(STORE_NAME);
      }
    });
    opening.addEventListener("success", () => resolve(opening.result));
    opening.addEventListener("error", () => reject(opening.error));
    opening.addEventListener("blocked", () => reject(new Error("Project icon cache is blocked.")));
  }));
}

async function withStore<A>(
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest<A> | void,
) {
  const transaction = (await openDatabase()).transaction(STORE_NAME, mode);
  const pending = use(transaction.objectStore(STORE_NAME));
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () => reject(transaction.error));
    transaction.addEventListener("error", () => reject(transaction.error));
  });
  return pending?.result;
}

async function downscale(
  image: { readonly mimeType: string; readonly bytes: Uint8Array<ArrayBuffer> },
  signal: AbortSignal,
) {
  const bitmap = await createImageBitmap(new Blob([image.bytes], { type: image.mimeType }));
  try {
    signal.throwIfAborted();
    const canvas = document.createElement("canvas");
    for (const size of [PROJECT_FAVICON_THUMBNAIL_SIZE, PROJECT_FAVICON_THUMBNAIL_SIZE / 2]) {
      const scale = Math.min(1, size / bitmap.width, size / bitmap.height);
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/webp", 0.85);
      if (dataUrl.length <= PROJECT_FAVICON_MAX_DATA_URL_LENGTH) return dataUrl;
    }
    throw new Error("Project icon thumbnail exceeds the cache limit.");
  } finally {
    bitmap.close();
  }
}

const imageCache = createProjectFaviconCache({
  storage: {
    list: async () => (await withStore("readonly", (store) => store.getAll())) ?? [],
    put: async (key, entry) => {
      await withStore("readwrite", (store) => store.put(entry, key));
    },
    remove: async (key) => {
      await withStore("readwrite", (store) => store.delete(key));
    },
  },
  load: createProjectFaviconImageLoader({ downscale }),
});

const httpBaseUrl = `${location.origin}/`;

export const projectFavicons: IResourceImplementation<"projectFavicons"> = (params, r) => {
  const environmentId = EnvironmentId.make(params.EnvironmentId);
  const source = createProjectFaviconSource({
    cache: imageCache,
    signal: r.signal,
    expose: (srcs) => r.expose(srcs),
    mint: async (target, signal) => {
      const { relativeUrl } = await connectionRuntime.runPromise(
        EnvironmentRegistry.EnvironmentRegistry.pipe(
          Effect.flatMap((registry) =>
            registry.run(
              environmentId,
              request(WS_METHODS.assetsCreateUrl, {
                resource: projectFaviconResource(target.Cwd, target.FaviconPath),
              }),
            ),
          ),
        ),
        { signal },
      );
      const url = resolveAssetUrl(httpBaseUrl, relativeUrl);
      if (url === null) throw new Error("Project icon URL is invalid.");
      return url;
    },
  });
  r.methods({ request: (_ctx, target) => source.request(target) });
  r.expose({});
};
