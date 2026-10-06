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

const browser = await chromium.launch(process.env.PARITY_CHROME_CHANNEL ? { channel: process.env.PARITY_CHROME_CHANNEL } : {});
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

// Media file id of a work's first playable file (film: its own file; series: first episode).
async function mediaFileId(title) {
  const res = await fetch(`${base}/api/v1/catalog?limit=100`, { headers: auth });
  const hit = ((await res.json()).items ?? []).find((w) => w.title === title);
  if (!hit) throw new Error(`work not found: ${title}`);
  const d = await (await fetch(`${base}/api/v1/catalog/${hit.id}`, { headers: auth })).json();
  const id = d.media_file_id ?? d.seasons?.[0]?.episodes?.[0]?.media_file_id ?? d.children?.series?.[0]?.episodes?.[0]?.media_file_id;
  if (!id) throw new Error(`no media file for ${title}`);
  return id;
}

async function runStep(page, step) {
  switch (step.type) {
    case "pauseAt":
      // Headless has no user gesture: nudge playback until frames are buffered, then pause on a fixed frame.
      await page.waitForFunction(() => {
        const v = document.querySelector("video");
        if (v?.paused) v.play().catch(() => {});
        return (v?.readyState ?? 0) >= 2;
      }, null, { timeout: 100000, polling: 500 });
      await page.evaluate(async (t) => {
        const v = document.querySelector("video");
        v.pause();
        if (Math.abs(v.currentTime - t) > 0.01) {
          await new Promise((res) => { v.addEventListener("seeked", res, { once: true }); v.currentTime = t; setTimeout(res, 8000); });
        }
        v.pause();
      }, step.seconds ?? 2);
      await page.waitForTimeout(400);
      break;
    case "revealControls": {
      const vp = page.viewportSize();
      await page.mouse.move(vp.width / 2, vp.height / 2);
      await page.waitForSelector(".player-controls", { state: "visible", timeout: 10000 }).catch(() => {});
      break;
    }
    case "openQualityMenu":
      for (let i = 0; i < 4; i += 1) {
        await page.mouse.move(40 + i * 7, 300 + i * 7);
        await page.locator(".player-quality:not(.player-track-selector) > button").first().click({ timeout: 6000, force: true }).catch(() => {});
        if (await page.locator(".player-quality-menu").count()) break;
      }
      await page.waitForSelector(".player-quality-menu", { timeout: 10000 });
      break;
    case "wait":
      await page.waitForTimeout(step.ms ?? 500);
      break;
    default:
      throw new Error(`unknown step ${step.type}`);
  }
}

const contexts = new Map();
const results = [];
for (const s of cfg.screens) {
  const user = s.user ?? cfg.user;
  if (!contexts.has(user)) contexts.set(user, await contextFor(user));
  if (s.web.path === "/__none") continue;
  const page = await contexts.get(user).newPage();
  // Captures must not change fixture state: swallow playback progress and session event writes.
  await page.route(/\/api\/v1\/playback\/(progress|[^/]+\/progress|sessions\/[^/]+\/events)/, (route) =>
    route.request().method() === "GET" ? route.continue() : route.fulfill({ status: 204, body: "" }));
  let route = s.web.path;
  if (s.web.file) route = `/player/${await mediaFileId(s.web.file.title)}`;
  if (s.web.work) {
    const id = await workId(s.web.work.kind, s.web.work.title);
    route = `/${s.web.work.kind === "series" ? "series" : "movies"}/${id}`;
  }
  await page.goto(base + route, { waitUntil: "load" });
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
  await page.waitForTimeout(5000);
  for (const step of s.web.steps ?? []) await runStep(page, step);
  if (s.web.steps?.length) await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, `${s.id}.png`) });
  // Layout dump (rect, font, colour per visible element) so the native layout can be fixed from numbers.
  const dom = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
      const cs = getComputedStyle(el);
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").slice(0, 60);
      const painted = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.borderTopWidth !== "0px" || cs.backgroundImage !== "none";
      if (!own && !painted && el.tagName !== "IMG" && el.tagName !== "svg") continue;
      out.push({
        tag: el.tagName.toLowerCase(), cls: String(el.getAttribute("class") ?? "").slice(0, 80), text: own,
        x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
        font: own ? `${cs.fontSize}/${cs.fontWeight}/${cs.letterSpacing}/${cs.fontFamily.slice(0, 30)}` : undefined,
        color: own ? cs.color : undefined, bg: cs.backgroundColor !== "rgba(0, 0, 0, 0)" ? cs.backgroundColor : undefined,
        radius: cs.borderTopLeftRadius !== "0px" ? cs.borderTopLeftRadius : undefined, opacity: cs.opacity !== "1" ? cs.opacity : undefined,
      });
    }
    return out;
  });
  fs.mkdirSync(path.join(outDir, "dom"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "dom", `${s.id}.json`), JSON.stringify(dom));
  results.push({ id: s.id, route, url: page.url() });
  console.log(`web ${s.id} -> ${page.url()}`);
  await page.close();
}
fs.writeFileSync(path.join(outDir, "web-routes.json"), JSON.stringify(results, null, 2));
await browser.close();
