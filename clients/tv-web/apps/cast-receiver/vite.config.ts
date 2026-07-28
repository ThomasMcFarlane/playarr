import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// This app's own version, baked into the bundle at build time and read back
// at runtime as `__APP_VERSION__` -- same pattern as `web/vite.config.ts`.
const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

export default defineConfig({
  base: "/cast/",
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    outDir: "dist",
    // Down-levels ?./??/async generators for older Cast-device Chromium
    // (real hardware runs several major versions behind desktop Chrome)
    // without constraining the source itself -- this only affects the
    // compiled output's syntax floor, same intent as `web/vite.config.ts`'s
    // own `build.target`.
    target: "es2017",
    sourcemap: true,
  },
});
