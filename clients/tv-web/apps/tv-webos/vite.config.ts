import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// This shell's own version, baked into the bundle at build time and read
// back at runtime as `__APP_VERSION__` -- see `src/index.tsx` and
// `@streamarr-tv/ui-tv`'s `TvApp` "check on launch" version-check banner.
const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

// webOS packages a directory of static assets (via `ares-package`) and
// serves them from the device's local filesystem, not from a URL root --
// relative asset paths (`base: "./"`) are required for icons/scripts to
// resolve once installed on the TV.
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    outDir: "dist",
    target: "es2019", // webOS 4.x's Chromium (M53-ish on older sets) -- keep the syntax target conservative
  },
});
