// Usage: node layers.mjs <distDir> [route]
// Lists the compositor layers (count, size, compositing reasons) and the
// elements carrying filters, backdrop-filters, masks or running animations on a
// screen after some remote navigation. Used to find what keeps layers alive.
import { chromium } from "playwright-core";
import { startServer } from "./server.mjs";
import { homedir } from "node:os";
const s = await startServer({ distDir: process.argv[2] });
const b = await chromium.launch({ executablePath: `${homedir()}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`, args: ["--use-angle=vulkan","--enable-features=Vulkan","--enable-gpu-rasterization","--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 3840, height: 2160 } });
const base = `http://127.0.0.1:${s.port}`;
await ctx.addInitScript(({ base }) => {
  localStorage.setItem("playarr:apiBaseUrl", base);
  const session = { accessToken: "t", refreshToken: "r", tokenType: "Bearer", expiresAt: Date.now() + 86400000 };
  localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "p", apiBaseUrl: base, userId: "00000000-0000-4000-8000-000000000001", name: "P", deviceId: "d", session }]));
  localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "p", apiBaseUrl: base, userId: "00000000-0000-4000-8000-000000000001" }));
}, { base });
const page = await ctx.newPage();
await page.goto(`${base}${process.argv[3] ?? "/movies"}`);
await page.waitForSelector("[data-library-index]");
await page.waitForTimeout(2500);
for (let i = 0; i < 12; i++) { await page.keyboard.press(i % 4 === 3 ? "ArrowRight" : "ArrowDown"); await page.waitForTimeout(120); }
await page.waitForTimeout(800);
const cdp = await ctx.newCDPSession(page);
let layers = null;
cdp.on("LayerTree.layerTreeDidChange", (e) => { layers = e.layers ?? layers; });
await cdp.send("LayerTree.enable");
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(1000);
console.log("layers", layers?.length);
const reasons = {};
let big = 0;
for (const l of layers ?? []) {
  const r = (await cdp.send("LayerTree.compositingReasons", { layerId: l.layerId }).catch(() => ({ compositingReasonIds: [] }))).compositingReasonIds;
  for (const x of r) reasons[x] = (reasons[x] ?? 0) + 1;
  if (l.width * l.height > 2e6) big++;
}
console.log(reasons, "big(>2MP):", big);
console.log((layers ?? []).sort((a,b)=>b.width*b.height-a.width*a.height).slice(0,8).map(l=>`${l.width}x${l.height} drawsContent=${l.drawsContent}`));
const info = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    const bits = [];
    if (cs.backdropFilter !== "none") bits.push("backdrop:" + cs.backdropFilter);
    if (cs.filter !== "none") bits.push("filter:" + cs.filter.slice(0, 30));
    if (cs.willChange !== "auto") bits.push("will-change:" + cs.willChange);
    if (cs.animationName !== "none") bits.push("anim:" + cs.animationName + "/" + cs.animationFillMode + "/" + cs.animationIterationCount);
    if (cs.mixBlendMode !== "normal") bits.push("blend");
    if (cs.maskImage !== "none") bits.push("mask");
    if (bits.length) out.push(`${el.tagName}.${(el.className?.toString() ?? "").slice(0, 50)} ${bits.join(" ")}`);
  }
  return out;
});
console.log(info.join("\n"));
await b.close(); await s.close();
