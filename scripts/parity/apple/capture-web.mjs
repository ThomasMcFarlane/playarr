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
async function login(username) {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username, password, device_id: deviceId, device_name: "parity-web",
      client_platform: "web", client_version: "parity",
    }),
  });
  if (!res.ok) throw new Error(`login failed for ${username}: ${res.status}`);
  return res.json();
}
const tok = await login(cfg.user);
const auth = { authorization: `Bearer ${tok.access_token}` };

async function workId(kind, title) {
  const res = await fetch(`${base}/api/v1/catalog?kind=${kind}&limit=100`, { headers: auth });
  const body = await res.json();
  const hit = (body.items ?? body).find((w) => w.title === title);
  if (!hit) throw new Error(`work not found: ${kind} ${title}`);
  return hit.id;
}

const browser = await chromium.launch();
// One context per user. A layout may ask for a device-like context (dpr, touch, mobile viewport).
async function contextFor(user) {
  const t = user === cfg.user ? tok : await login(user);
  const context = await browser.newContext({
    viewport: cfg.viewport, deviceScaleFactor: cfg.dpr ?? 1, isMobile: !!cfg.mobile, hasTouch: !!cfg.mobile,
    reducedMotion: "reduce", timezoneId: "UTC", locale: "en-GB",
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
  }, { base, tok: t, deviceId, user });
  await context.clock.setFixedTime(new Date(cfg.frozenTime));
  return context;
}
const contexts = new Map();
const results = [];
for (const s of cfg.screens) {
  const user = s.user ?? cfg.user;
  if (!contexts.has(user)) contexts.set(user, await contextFor(user));
  const page = await contexts.get(user).newPage();
  let route = s.web.path;
  if (s.web.work) {
    const id = await workId(s.web.work.kind, s.web.work.title);
    route = `/${s.web.work.kind === "series" ? "series" : "movies"}/${id}`;
  }
  await page.goto(base + route, { waitUntil: "load", timeout: 60000 });
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(outDir, `${s.id}.png`) });
  results.push({ id: s.id, route, url: page.url() });
  console.log(`web ${s.id} -> ${page.url()}`);
  await page.close();
}
fs.writeFileSync(path.join(outDir, "web-routes.json"), JSON.stringify(results, null, 2));
await browser.close();
