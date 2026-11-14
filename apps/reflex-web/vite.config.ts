import {
  DEV_PROXIED_ORIGIN_PRESERVING_PREFIXES,
  DEV_PROXIED_PATH_PREFIXES,
} from "@t3tools/shared/devProxy";
import "vite-plus/test/config";
import { defineConfig } from "vite-plus";
import solidPlugin from "vite-plugin-solid";

const backend = `http://localhost:${process.env.T3CODE_PORT ?? 13773}/`;

export default defineConfig(({ mode }) => ({
  plugins: [solidPlugin()],
  // Treflex ships as source; pre-bundling would give the app a second copy of its contexts.
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
      : { include: ["src/**/*.test.ts"] }),
  },
  server: {
    host: "localhost",
    port: 5734,
    strictPort: true,
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
