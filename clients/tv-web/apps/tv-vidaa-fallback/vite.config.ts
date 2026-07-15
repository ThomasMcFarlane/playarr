import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// This shell's own version, baked into the bundle at build time and read
// back at runtime as `__APP_VERSION__` -- see `src/index.tsx` and
// `@streamarr-tv/ui-tv`'s `TvApp` "check on launch" version-check banner.
const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

// Served as an installable PWA over HTTPS (not packaged like webOS/Tizen),
// so a root-relative base is fine here, unlike the other two TV shells.
export default defineConfig({
  base: "/",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    outDir: "dist",
    target: "es2019",
  },
});
