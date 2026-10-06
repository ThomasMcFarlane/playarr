#!/usr/bin/env node
// Captures the web client reference for the Apple parity workflow.
// usage: capture-web.mjs <screens.json> <server-url> <out-dir>
// The web client must be served by the fixture server (PLAYARR_WEB_ASSETS_DIR).
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [screensFile, base, outDir] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(screensFile, "utf8"));
const { FIXTURE_PASSWORD: password } = await import(path.join(here, "../../fixtures/catalog.mjs"));
fs.mkdirSync(outDir, { recursive: true });

const deviceId = "11111111-1111-4111-8111-111111111111";
const loginRes = await fetch(`${base}/api/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    username: cfg.user, password, device_id: deviceId, device_name: "parity-web",
    client_platform: "web", client_version: "parity",
  }),
});
if (!loginRes.ok) throw new Error(`login failed: ${loginRes.status}`);
const tok = await loginRes.json();
const auth = { authorization: `Bearer ${tok.access_token}` };

async function workId(kind, title) {
  const res = await fetch(`${base}/api/v1/catalog?kind=${kind}&limit=100`, { headers: auth });
  const body = await res.json();
  const hit = (body.items ?? body).find((w) => w.title === title);
  if (!hit) throw new Error(`work not found: ${kind} ${title}`);
  return hit.id;
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: cfg.viewport, deviceScaleFactor: 1, reducedMotion: "reduce", timezoneId: "UTC", locale: "en-GB",
});
await context.addInitScript(({ base, tok, deviceId, user }) => {
  try {
    localStorage.setItem("playarr:apiBaseUrl", base);
    const session = {
      accessToken: tok.access_token, refreshToken: tok.refresh_token, tokenType: "Bearer",
      expiresAt: Date.now() + tok.expires_in * 1000,
    };
    localStorage.setItem("playarr.profileSessions.v4", JSON.stringify([{
      profileKey: "fx", apiBaseUrl: base, userId: tok.user_id, name: user, deviceId, session,
    }]));
    localStorage.setItem("playarr.activeProfile.v1", JSON.stringify({ profileKey: "fx", apiBaseUrl: base, userId: tok.user_id }));
    localStorage.setItem("playarr-theme", "dark");
  } catch { /* storage unavailable */ }
}, { base, tok, deviceId, user: cfg.user });
await context.clock.setFixedTime(new Date(cfg.frozenTime));

const page = await context.newPage();
const results = [];
for (const s of cfg.screens) {
  if (s.web.path === "/__none") continue;
  let route = s.web.path;
  if (s.web.work) {
    const id = await workId(s.web.work.kind, s.web.work.title);
    route = `/${s.web.work.kind === "series" ? "series" : "movies"}/${id}`;
  }
  await page.goto(base + route, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, `${s.id}.png`) });
  results.push({ id: s.id, route, url: page.url() });
  console.log(`web ${s.id} -> ${page.url()}`);
}
fs.writeFileSync(path.join(outDir, "web-routes.json"), JSON.stringify(results, null, 2));
await browser.close();
