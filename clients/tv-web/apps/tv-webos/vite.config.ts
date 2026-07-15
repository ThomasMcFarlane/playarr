import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// webOS packages a directory of static assets (via `ares-package`) and
// serves them from the device's local filesystem, not from a URL root --
// relative asset paths (`base: "./"`) are required for icons/scripts to
// resolve once installed on the TV.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    target: "es2019", // webOS 4.x's Chromium (M53-ish on older sets) -- keep the syntax target conservative
  },
});
