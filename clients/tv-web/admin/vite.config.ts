import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // Same rationale as clients/tv-web/web/vite.config.ts: the built app
    // is co-hosted by the backend in production (same origin, same port,
    // see streamarr_api::build_router's `web_assets_dir`), so this app
    // also defaults to a same-origin API base URL. Proxying here
    // reproduces that for `pnpm run dev`.
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
