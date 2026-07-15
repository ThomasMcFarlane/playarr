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
  },
  build: {
    outDir: "dist",
    target: "es2020",
  },
});
