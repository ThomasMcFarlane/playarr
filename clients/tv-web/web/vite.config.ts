import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

// This app's own version, baked into the bundle at build time and read back
// at runtime as `__APP_VERSION__` -- see `src/lib/appUpdate.ts`'s OTA
// update flow (compared against both `GET /api/system/version`'s
// compatibility table and the CDN build manifest's `bundleVersion`).
const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

function workspaceSourceAliases(): Record<string, string> {
  const root = fileURLToPath(new URL("../packages/", import.meta.url));
  const aliases: Record<string, string> = {};
  for (const dir of readdirSync(root)) {
    const src = `${root}${dir}/src/`;
    if (!existsSync(`${src}index.ts`)) continue;
    // Subpath first: "@playarr-tv/api-client/react" must not match the bare-name prefix alias.
    if (existsSync(`${src}hooks.ts`) && dir === "api-client") aliases[`@playarr-tv/${dir}/react`] = `${src}hooks.ts`;
    aliases[`@playarr-tv/${dir}`] = `${src}index.ts`;
  }
  return aliases;
}

// The debug-mode screen mirror (src/debug/) is test tooling for devices without screenshots. It is
// compiled in only for `--mode debug-mirror`, which writes to its own output directory. This guard
// fails any other build whose output mentions the mirror's sentinel, so it cannot ship by accident.
const MIRROR_SENTINEL = "PLAYARR_DEBUG_MIRROR_SENTINEL";
function mirrorGuard(mode: string): Plugin {
  return {
    name: "playarr-debug-mirror-guard",
    apply: "build",
    generateBundle(_options, bundle) {
      if (mode === "debug-mirror") return;
      for (const [name, item] of Object.entries(bundle)) {
        const code = item.type === "chunk" ? item.code : typeof item.source === "string" ? item.source : "";
        if (code.includes(MIRROR_SENTINEL) || /__mirror\/frame/.test(code)) {
          throw new Error(`debug screen mirror code found in ${name}; it must only be built with --mode debug-mirror`);
        }
      }
    },
  };
}

// `--mode server` builds the client for hosting by Playarr Server itself under /tv/
// (so a TV that can only reach an http:// server avoids mixed content).
export default defineConfig(({ mode }) => ({
  base: mode === "server" ? "/tv/" : "/",
  plugins: [react(), mirrorGuard(mode)],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __PLAYARR_PLATFORM__: JSON.stringify(null),
    __PLAYARR_DEBUG_MIRROR__: JSON.stringify(mode === "debug-mirror"),
  },
  server: {
    port: 5173,
    // Allow devdeploy / Emissary hostnames (Vite host-check blocks otherwise).
    allowedHosts: true,
    // Production Playarr is hosted at playarr.app and connects directly to
    // the server selected by the viewer. Proxying here keeps local development
    // convenient against a backend listening on the standard development port.
    proxy: {
      // Dense local mock for 4K nav-perf measurement (see goal worktree).
      // Production / default local backend remains localhost:8484.
      "/api": process.env.PLAYARR_DEV_API_PROXY ?? "http://localhost:8484",
      "/healthz": process.env.PLAYARR_DEV_API_PROXY ?? "http://localhost:8484",
      "/readyz": process.env.PLAYARR_DEV_API_PROXY ?? "http://localhost:8484",
    },
  },
  test: {
    // Resolve workspace packages from source so the suite runs in a clean checkout without a
    // prior `tsc` build (their package.json entry points name dist/).
    alias: workspaceSourceAliases(),
  },
  build: {
    outDir: mode === "server" ? "dist-server" : mode === "debug-mirror" ? "dist-debug-mirror" : "dist",
    target: "es2020",
  },
}));
