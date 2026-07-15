import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// This app's own version, baked into the bundle at build time and read back
// at runtime as `__APP_VERSION__` -- see `src/lib/appUpdate.ts`'s OTA
// update flow (compared against both `GET /api/system/version`'s
// compatibility table and the CDN build manifest's `bundleVersion`).
const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  server: {
    port: 5173,
    // The built app is co-hosted by the backend in production (see
    // streamarr_api::build_router's `web_assets_dir`) and defaults to a
    // same-origin API base URL accordingly (see ApiClientProvider.tsx).
    // Proxying here reproduces that "same origin" story for `pnpm run dev`
    // too, so a fresh checkout works against a locally running backend with
    // zero required Settings-page configuration.
    proxy: {
      "/api": "http://localhost:8080",
      "/healthz": "http://localhost:8080",
      "/readyz": "http://localhost:8080",
    },
  },
  build: {
    outDir: "dist",
    target: "es2020",
  },
});
