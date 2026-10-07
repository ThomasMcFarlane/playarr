// Guards the owner's rule: the debug screen mirror must never be part of a production bundle.
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const SENTINEL = "PLAYARR_DEBUG_MIRROR_SENTINEL";

type Output = { output: Array<{ type: string; code?: string; source?: string | Uint8Array }> };

async function bundleText(mode: string): Promise<string> {
  const result = (await build({
    root,
    mode,
    logLevel: "silent",
    configFile: `${root}/vite.config.ts`,
    build: { write: false, minify: false },
  })) as Output | Output[];
  const outputs = Array.isArray(result) ? result : [result];
  return outputs
    .flatMap((o) => o.output)
    .map((i) => (i.type === "chunk" ? i.code : typeof i.source === "string" ? i.source : ""))
    .join("\n");
}

describe("debug screen mirror bundle guard", () => {
  it("is absent from the production bundle", async () => {
    const text = await bundleText("production");
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain("__mirror/frame");
    expect(text).not.toMatch(/html-to-image/i);
  }, 240_000);

  it("is absent from the server-hosted bundle", async () => {
    const text = await bundleText("server");
    expect(text).not.toContain(SENTINEL);
  }, 240_000);

  it("is present in the debug-mirror bundle", async () => {
    const text = await bundleText("debug-mirror");
    expect(text).toContain(SENTINEL);
  }, 240_000);
});
