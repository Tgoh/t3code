// @effect-diagnostics globalTimers:off -- The service worker's network wait, outside any Effect runtime.
export interface WorkerBuild {
  readonly id: string;
  /** Precached on install. */
  readonly shell: ReadonlyArray<string>;
  /** Every path the worker may answer from its cache. */
  readonly files: ReadonlyArray<string>;
  /** Path prefixes the worker never touches. */
  readonly bypass: ReadonlyArray<string>;
}

interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}

interface WorkerScope {
  readonly location: Location;
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
}

/**
 * vite.config.ts writes this function's source to dist/sw.js and calls it with the build, so it
 * runs in the worker and can use nothing from outside its own body.
 */
export function serviceWorker(build: WorkerBuild) {
  const scope = self as unknown as WorkerScope;
  const prefix = "reflex-";
  const current = prefix + build.id;
  const index = "/";
  const networkWaitMs = 3000;
  const files = new Set(build.files);

  const fetchOk = async (path: string) => {
    const response = await fetch(path, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response;
  };

  const install = async () => {
    const cache = await caches.open(current);
    await Promise.all(build.shell.map(async (path) => cache.put(path, await fetchOk(path))));
    // Hashed files are immutable, so whatever an earlier build cached and this one still ships carries over.
    for (const name of await caches.keys()) {
      if (!name.startsWith(prefix) || name === current) continue;
      const older = await caches.open(name);
      for (const request of await older.keys()) {
        const path = new URL(request.url).pathname;
        if (!path.startsWith("/assets/") || !files.has(path) || (await cache.match(path))) continue;
        const response = await older.match(request);
        if (response) await cache.put(path, response);
      }
    }
  };

  const activate = async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(prefix) && name !== current) await caches.delete(name);
    }
    await scope.clients.claim();
  };

  const file = async (request: Request, path: string) => {
    const hit = await caches.match(path);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok) await (await caches.open(current)).put(path, response.clone());
    return response;
  };

  const fetchPage = async (url: string) => {
    const response = await fetch(url, { cache: "no-cache" });
    if (response.ok) await (await caches.open(current)).put(index, response.clone());
    // Safari refuses a redirected response for a navigation.
    return response.redirected ? new Response(response.body, response) : response;
  };

  const page = async (network: Promise<Response>) => {
    const cached = caches.match(index);
    const slow = new Promise((resolve) => setTimeout(resolve, networkWaitMs))
      .then(() => cached)
      .then((hit) => hit ?? network);
    try {
      return await Promise.race([network, slow]);
    } catch {
      return (await cached) ?? Response.error();
    }
  };

  scope.addEventListener("install", (event) => {
    event.waitUntil(install().then(() => scope.skipWaiting()));
  });

  scope.addEventListener("activate", (event) => {
    event.waitUntil(activate());
  });

  scope.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin !== scope.location.origin) return;
    const path = url.pathname;
    if (build.bypass.some((bypass) => path === bypass || path.startsWith(`${bypass}/`))) return;
    if (files.has(path) && path !== index) {
      event.respondWith(file(request, path));
    } else if (request.mode === "navigate") {
      const network = fetchPage(request.url);
      event.waitUntil(network.catch(() => {}));
      event.respondWith(page(network));
    }
  });
}
