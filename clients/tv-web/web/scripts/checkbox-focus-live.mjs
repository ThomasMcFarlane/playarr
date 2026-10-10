#!/usr/bin/env node
// Live repro of the checkbox focus trap with the PLAYARR_DEVICE_TEST_* account from ~/.secrets (never printed).
//   node scripts/checkbox-focus-live.mjs [--site https://playarr.app]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { launchChromium } from "./chromium-launch.mjs";

const i = process.argv.indexOf("--site");
const site = i >= 0 ? process.argv[i + 1] : "https://playarr.app";
const env = Object.fromEntries(readFileSync(join(homedir(), ".secrets"), "utf8").split("\n").filter((l) => /^PLAYARR_DEVICE_TEST_/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]));
const apiBase = env.PLAYARR_DEVICE_TEST_SERVER_URL.replace(/\/$/, "");
const res = await fetch(`${apiBase}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: env.PLAYARR_DEVICE_TEST_USERNAME, password: env.PLAYARR_DEVICE_TEST_PASSWORD, device_id: "33333333-3333-4333-8333-333333333333", device_name: "checkbox-focus", client_platform: "web", client_version: "check" }) });
const s = await res.json();
if (!s.access_token) { console.log(`FAIL  login failed (${res.status})`); process.exit(1); }
const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await context.addInitScript(({ apiBase, s }) => {
  try {
    localStorage.setItem("playarr:apiBaseUrl", apiBase);
    const session = { accessToken: s.access_token, refreshToken: s.refresh_token, tokenType: "Bearer", expiresAt: Date.now() + s.expires_in * 1000 };
    localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{ profileKey: "e2e", apiBaseUrl: apiBase, userId: s.user_id, name: "Viewer", deviceId: "e2e-device", session }]));
    localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "e2e", apiBaseUrl: apiBase, userId: s.user_id }));
  } catch {}
}, { apiBase, s });
const page = await context.newPage();
await page.goto(`${site}/settings/your-data`);
await page.waitForTimeout(2500);
const box = page.locator('input[type="checkbox"]').first();
if (!(await box.count())) { console.log("FAIL  no checkbox on live page"); process.exit(1); }
const out = {};
for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]) {
  await box.focus();
  await page.keyboard.press(key);
  await page.waitForTimeout(400);
  out[key] = await page.evaluate(() => document.activeElement?.type === "checkbox" ? "stays on checkbox" : "moved");
}
console.log(JSON.stringify(out));
await browser.close();
