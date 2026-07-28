import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // Same rationale as clients/tv-web/web/vite.config.ts: the built app
    // is co-hosted by the backend in production (same origin, same port,
    // see playarr_api::build_router's `web_assets_dir`), so this app
    // also defaults to a same-origin API base URL. Proxying here
    // reproduces that for `pnpm run dev`.
    proxy: {
      // "^/api/" (not the bare-prefix "/api" this used to be), so a
      // client-side route whose path merely starts with the string "api"
      // -- e.g. this app's own /api-explorer page -- isn't swallowed by
      // the proxy and 404'd against the backend instead of being served
      // by the SPA. Every real backend route is under /api/v1/... or
      // /api/system/..., always with a slash right after "api", so this
      // still matches all of them.
      "^/api/": "http://localhost:8484",
      "/healthz": "http://localhost:8484",
      "/readyz": "http://localhost:8484",
    },
  },
  build: {
    outDir: "dist",
    target: "es2020",
  },
});
