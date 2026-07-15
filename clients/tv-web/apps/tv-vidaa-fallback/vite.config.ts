import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served as an installable PWA over HTTPS (not packaged like webOS/Tizen),
// so a root-relative base is fine here, unlike the other two TV shells.
export default defineConfig({
  base: "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    target: "es2019",
  },
});
