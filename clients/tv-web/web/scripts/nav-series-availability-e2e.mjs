#!/usr/bin/env node
// A playable series page never says "No availability data yet" (or any "no availability" text).
//
// The per-series availability-lag statistic is a release-to-import average. With no samples it carries no
// information, so the page shows nothing for it, rather than a message that contradicts the Play button.
//
//   node scripts/nav-series-availability-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";
import { startServer } from "./nav-perf/server.mjs";

const { check, open, finish, server: empty } = await boot({ series: 6, seasons: 2, seasonEpisodes: 3, resumePlanDelayMs: 0 }, { realisticAuth: true });
const dist = process.argv.includes("--dist") ? process.argv[process.argv.indexOf("--dist") + 1] : new URL("../dist", import.meta.url).pathname;
const sampled = await startServer({ distDir: dist, series: 6, seasons: 2, seasonEpisodes: 3, resumePlanDelayMs: 0, lagAverageSeconds: 3 * 3600 });
const NONE = /no availability|not available yet|no data yet/i;

async function visit(label, server, width, height) {
  const { context, page, errors } = await open("/series", { width, height, server });
  await page.waitForSelector(".tv-title-card");
  await page.locator(".tv-title-card").first().click();
  await page.waitForSelector("[data-resume-action]", { timeout: 8000 });
  await page.waitForTimeout(1500); // let the lag statistic load and settle
  const state = await page.evaluate(() => ({
    text: document.body.innerText,
    lag: document.querySelector("[data-testid='availability-lag']")?.textContent ?? null,
  }));
  check(`${label}: page is playable (resume or play action present)`, (await page.locator("[data-resume-action]").count()) > 0);
  check(`${label}: no "No availability" text anywhere`, !NONE.test(state.text), state.text.match(NONE)?.[0] ?? "");
  await context.close();
  return { state, errors };
}

for (const [width, height] of [[1920, 1080], [1280, 720]]) {
  const a = await visit(`no samples ${width}`, undefined, width, height);
  check(`no samples ${width}: the lag note is not rendered`, a.state.lag === null, String(a.state.lag));
  check(`no samples ${width}: no page errors`, a.errors.length === 0, a.errors.join(";"));
  const b = await visit(`samples ${width}`, sampled, width, height);
  check(`samples ${width}: the lag note shows the average`, /3 hours/.test(b.state.lag ?? ""), String(b.state.lag));
}

await sampled.close();
await finish();
