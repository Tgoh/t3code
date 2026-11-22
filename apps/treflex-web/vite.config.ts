// @effect-diagnostics nodeBuiltinImport:off -- Build config, run by Vite outside any Effect runtime.
import {
  DEV_PROXIED_ORIGIN_PRESERVING_PREFIXES,
  DEV_PROXIED_PATH_PREFIXES,
} from "@t3tools/shared/devProxy";
import tailwindcss from "@tailwindcss/vite";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import "vite-plus/test/config";
import { defineConfig, type Plugin } from "vite-plus";
import solidPlugin from "vite-plugin-solid";

import { serviceWorker as worker, type WorkerBuild } from "./src/sw";

const backend = `http://localhost:${process.env.T3CODE_PORT ?? 13773}/`;

/** Writes dist/sw.js from src/sw.ts, with the build's file list and the shell to precache. */
function serviceWorker(): Plugin {
  return {
    name: "treflex-service-worker",
    apply: "build",
    writeBundle({ dir }) {
      if (dir === undefined) return;
      const read = (path: string) => NodeFS.readFileSync(NodePath.join(dir, path), "utf8");
      const all = NodeFS.readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => NodePath.relative(dir, NodePath.join(entry.parentPath, entry.name)))
        .map((path) => `/${path.replaceAll("\\", "/")}`)
        .filter((path) => path !== "/sw.js")
        .toSorted();
      const hashed = all.filter((path) => path.startsWith("/assets/"));
      const linked = [...read("index.html").matchAll(/(?:src|href)="(\/[^"]+)"/g)].map(
        (match) => match[1]!,
      );
      const fonts = linked
        .filter((path) => path.endsWith(".css"))
        .flatMap((path) => [...read(path).matchAll(/url\((\/assets\/[^)]+)\)/g)])
        .map((match) => match[1]!);
      const shell = ["/", ...new Set([...linked, ...fonts].filter((path) => all.includes(path)))];
      const hash = NodeCrypto.createHash("sha256").update(hashed.join("\n"));
      // Unhashed files, index.html among them, change without changing a name.
      for (const path of all) {
        if (!path.startsWith("/assets/"))
          hash.update(NodeFS.readFileSync(NodePath.join(dir, path)));
      }
      const build: WorkerBuild = {
        id: hash.digest("hex").slice(0, 12),
        shell,
        files: [...new Set([...hashed, ...shell])],
        bypass: DEV_PROXIED_PATH_PREFIXES,
      };
      NodeFS.writeFileSync(
        NodePath.join(dir, "sw.js"),
        `(${worker.toString()})(${JSON.stringify(build)});\n`,
      );
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [solidPlugin(), tailwindcss(), serviceWorker()],
  // Pre-bundling would give the app a second copy of treflex's contexts.
  optimizeDeps: { exclude: ["treflex", "treflex-solid"] },
  build: { target: "esnext" },
  ...(mode === "bench" ? { define: { "import.meta.env.DEV": "false" } } : {}),
  // Solid's default Node export is its server build, which has no reactive runtime.
  resolve: { conditions: ["solid", "browser"] },
  ssr: { resolve: { conditions: ["solid", "browser"] } },
  test: {
    environment: "node",
    server: { deps: { inline: ["treflex", "treflex-solid"] } },
    ...(mode === "bench"
      ? {
          include: ["bench/**/*.bench.ts"],
          testTimeout: 0,
          disableConsoleIntercept: true,
          // Production's setting. In dev the budgeted walk adds a full-tree pause every so many writes.
          env: { TREFLEX_VERIFY_INDEX: process.env.TREFLEX_VERIFY_INDEX ?? "off" },
        }
      : { include: ["src/**/*.test.ts"], setupFiles: ["treflex/vitest"] }),
  },
  server: {
    host: "localhost",
    port: Number(process.env.TREFLEX_WEB_PORT ?? 5734),
    strictPort: true,
    // Reached from other devices through Tailscale Serve, which keeps the tailnet hostname.
    allowedHosts: [".ts.net"],
    proxy: Object.fromEntries(
      DEV_PROXIED_PATH_PREFIXES.map((prefix) => [
        prefix,
        {
          target: backend,
          changeOrigin: !DEV_PROXIED_ORIGIN_PRESERVING_PREFIXES.has(prefix),
          ...(prefix === "/ws" || prefix === "/api" ? { ws: true } : {}),
        },
      ]),
    ),
  },
}));
