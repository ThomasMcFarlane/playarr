#!/usr/bin/env node
// Download flow (1.9968, 1.9971), keyboard only, at 1920x1080 and 1280x720:
//  - season tracks and episode rows of a series have no Download button;
//  - long-press Enter on an episode opens the actions drawer; Download shows the scope choice (This episode, Whole
//    season, Whole series) and ONE quality Select (a closed field, not a list of qualities);
//  - the Select opens with Enter, Down moves, Enter chooses; Escape inside it closes only the list;
//  - "Whole season" plus a quality queues every episode of the season with that quality (mock API assertions);
//  - field and rows meet 44px, text contrast is at least 7:1.
//   node scripts/download-flow-e2e.mjs [--no-build] [--dist dir] [--shots dir]
import { mkdirSync } from "node:fs";
import { boot, opt } from "./e2e-common.mjs";

const EPISODES = 4;
const { check, open, finish, server } = await boot({ seasons: 2, seasonEpisodes: EPISODES, canDownload: true, movies: 4, series: 2 }, { realisticAuth: true });
const shots = opt("shots", "");
if (shots) mkdirSync(shots, { recursive: true });

const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const parse = (c) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
const longEnter = async (page) => { await page.keyboard.down("Enter"); await page.waitForTimeout(900); await page.keyboard.up("Enter"); };
const focusEpisode = async (page, index) => {
  await page.evaluate((i) => document.querySelectorAll("a.tv-episode-card")[i]?.focus(), index);
  await page.waitForTimeout(200);
};

for (const [width, height] of [[1920, 1080], [1280, 720]]) {
  const tag = `${width}`;
  server.downloadRequests.length = 0;
  const { context, page, errors } = await open("/series", { width, height });
  await page.waitForSelector("a[href*='/series/']");
  const href = await page.evaluate(() => document.querySelector("a[href*='/series/']").getAttribute("href"));
  await page.goto(new URL(href, page.url()).toString());
  await page.waitForSelector("a.tv-episode-card");
  await page.waitForTimeout(600);

  check(`${tag}: season tracks have no download button`, (await page.locator(".tv-track-action").count()) === 0);
  check(`${tag}: episode rows have no download button`, (await page.locator("a.tv-episode-card button, a.tv-episode-card [aria-haspopup='dialog']").count()) === 0);

  await focusEpisode(page, 1);
  await longEnter(page);
  await page.waitForSelector(".media-context-drawer");
  await page.waitForTimeout(600);
  await page.keyboard.press("ArrowDown"); // Play -> Download
  await page.keyboard.press("Enter");
  await page.waitForSelector(".download-quality-drawer .ui-select-trigger");
  await page.waitForTimeout(400);

  // The scope choice is the drawer's first segmented control; Keep until is a second one since 1.9987.
  const seg = await page.locator(".download-quality-drawer .tv-segmented").first().locator("button").allTextContents();
  check(`${tag}: scope choice offers exactly episode and season`, seg.length === 2 && /episode/i.test(seg[0]) && /season/i.test(seg[1]), JSON.stringify(seg));
  check(`${tag}: quality is a closed select, not a list`, (await page.locator(".download-quality-drawer .ui-select-option").count()) === 0 && (await page.locator(".download-quality-drawer [role=radio]").count()) === 0);
  const m = await page.evaluate(() => {
    const t = document.querySelector(".ui-select-trigger");
    const cs = getComputedStyle(t);
    return { h: t.getBoundingClientRect().height, color: cs.color, bg: cs.backgroundColor };
  });
  check(`${tag}: select field is at least 44px tall`, m.h >= 44, String(m.h));
  if (shots) await page.screenshot({ path: `${shots}/download-scope-${tag}.png` });

  // Scope: Whole season (keyboard: Tab from the close button until a segment, then Right).
  await page.locator(".download-quality-drawer .tv-segmented").first().locator("button").first().focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  const pressed = await page.locator(".download-quality-drawer .tv-segmented").first().locator("button[aria-pressed=true]").textContent();
  check(`${tag}: Whole season chosen with the keyboard`, /season/i.test(pressed ?? ""), pressed);

  // Quality select.
  await page.locator(".ui-select-trigger").focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector(".ui-select-list");
  const optionCount = await page.locator(".ui-select-option").count();
  check(`${tag}: select opens a list of qualities`, optionCount === 4, String(optionCount));
  check(`${tag}: no text input or combobox in the drawer (D-pad only)`, (await page.locator('.download-quality-drawer input[type="text"], .download-quality-drawer input[type="search"], .download-quality-drawer [role="combobox"]').count()) === 0);
  const a = await page.evaluate(() => {
    const o = document.querySelector(".ui-select-option:not(.is-active)");
    const probe = document.createElement("i");
    document.body.appendChild(probe);
    const token = (name) => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; };
    const out = { h: o.getBoundingClientRect().height, color: getComputedStyle(o).color, ink: token("--ink"), bg: token("--bg") };
    probe.remove();
    return out;
  });
  check(`${tag}: select rows are at least 44px`, a.h >= 44, String(a.h));
  check(`${tag}: select text is the ink token at 7:1 or more on the page background`, a.color === a.ink && ratio(parse(a.ink), parse(a.bg)) >= 7, `${a.color} ${a.ink} on ${a.bg}`);
  await page.waitForTimeout(500); // the segment colour transition (180ms) has finished
  const seg2 = await page.evaluate(() => {
    const probe = document.createElement("i");
    document.body.appendChild(probe);
    const token = (name) => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; };
    const out = { ink: token("--ink"), bg: token("--bg"), segs: [...document.querySelector(".download-quality-drawer .tv-segmented").querySelectorAll("button")].map((b) => ({ pressed: b.getAttribute("aria-pressed"), cls: b.className, background: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color, opacity: getComputedStyle(b).opacity })) };
    probe.remove();
    return out;
  });
  const sel = seg2.segs[1];
  const others = seg2.segs.filter((x) => x.pressed !== "true");
  check(`${tag}: selected segment keeps the selected style while the Select is open`, sel.pressed === "true" && sel.cls.includes("is-active") && sel.background === seg2.ink && sel.color === seg2.bg && sel.opacity === "1" && others.every((x) => x.background !== seg2.ink), JSON.stringify(seg2));
  if (shots) await page.screenshot({ path: `${shots}/download-select-open-${tag}.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check(`${tag}: Escape closes only the list`, (await page.locator(".ui-select-list").count()) === 0 && (await page.locator(".download-quality-drawer").count()) === 1);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".ui-select-list");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  const chosen = await page.locator(".ui-select-trigger .ui-select-value").textContent();
  check(`${tag}: Down, Down, Enter chooses 720p`, chosen === "720p", chosen);
  if (shots) await page.screenshot({ path: `${shots}/download-chosen-${tag}.png` });

  await page.locator(".download-quality-drawer .is-primary").focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  const reqs = server.downloadRequests;
  const season1 = new Set(Array.from({ length: EPISODES }, (_, i) => i).map((i) => reqs.find((r) => r.media_file_id.startsWith(`mf0-${i}-`))?.media_file_id));
  check(`${tag}: Whole season queued every episode of the season`, reqs.length === EPISODES && !season1.has(undefined), JSON.stringify(reqs));
  check(`${tag}: every request carries the chosen quality`, reqs.length > 0 && reqs.every((r) => r.quality_id === "720p"), JSON.stringify(reqs));

  // This episode only.
  server.downloadRequests.length = 0;
  await page.waitForTimeout(500);
  await focusEpisode(page, 2);
  await longEnter(page);
  await page.waitForSelector(".media-context-drawer");
  await page.waitForTimeout(600);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".ui-select-trigger");
  await page.waitForTimeout(300);
  await page.locator(".download-quality-drawer .is-primary").focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1000);
  check(`${tag}: default scope queues just this episode`, server.downloadRequests.length === 1, JSON.stringify(server.downloadRequests));
  check(`${tag}: no page errors`, errors.length === 0, errors.join("; "));
  await context.close();
}
await finish();
