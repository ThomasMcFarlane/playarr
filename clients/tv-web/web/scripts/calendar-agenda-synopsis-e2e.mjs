#!/usr/bin/env node
// Calendar agenda: the shared left details panel shows the focused entry's synopsis (an episode's own, or a
// movie's) when the calendar payload carries one, with the same style and 5-line clamp as the Library/Home
// panels, and nothing at all (no block, no placeholder) when the entry has none. At 1920 and 1280.
// The mock API (nav-perf/server.mjs, `calendarOverviews`) gives each day an episode with a synopsis, a movie
// with one and an episode without.
//
//   node scripts/calendar-agenda-synopsis-e2e.mjs [--no-build] [--dist dir]   (AGENDA_SHOTS=<dir> for screenshots)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { boot } from "./e2e-common.mjs";

const SHOTS = process.env.AGENDA_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const { check, open, finish } = await boot({ calendarOverviews: true });

const panel = (page) =>
  page.evaluate(() => {
    const root = document.querySelector(".calendar-details");
    const overview = root?.querySelector(".tv-preview-overview");
    const cs = overview ? getComputedStyle(overview) : null;
    return {
      eyebrow: root?.querySelector(".tv-provider")?.textContent ?? "",
      title: root?.querySelector("h2")?.textContent ?? "",
      overview: overview ? overview.textContent : null,
      clamp: cs ? cs.webkitLineClamp : null,
      boxShadow: cs ? cs.boxShadow : null,
      background: cs ? cs.backgroundColor : null,
      text: root?.textContent ?? "",
    };
  });

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
  const label = `${viewport.width}`;
  const { context, page } = await open("/calendar?view=agenda&date=2026-10-07&platform=tv-webos", { ...viewport, theme: "dark" });
  await page.waitForSelector(".calendar-entry:not(.calendar-entry-skeleton)", { timeout: 15000 });
  await page.waitForTimeout(500);
  const count = await page.evaluate(() => document.querySelectorAll(".calendar-entry:not(.calendar-entry-skeleton)").length);
  const seen = { episode: null, movie: null, none: null };
  for (let i = 0; i < Math.min(count, 14); i += 1) {
    await page.evaluate((n) => document.querySelectorAll(".calendar-entry:not(.calendar-entry-skeleton)")[n].focus(), i);
    await page.waitForTimeout(250);
    const p = await panel(page);
    const kind = /Film/.test(p.title) ? "movie" : "episode";
    if (p.overview === null) seen.none ??= p;
    else seen[kind] ??= p;
    if (p.overview !== null && !/^Mock (episode|movie) synopsis \d{4}-\d{2}-\d{2}\.$/.test(p.overview)) check(`${label}: synopsis text is the payload's`, false, p.overview);
    if (p.overview === null && /synopsis|No synopsis/i.test(p.text)) check(`${label}: no placeholder text when there is no synopsis`, false, p.text);
    if (SHOTS && i < 3) await page.screenshot({ path: join(SHOTS, `agenda-synopsis-${label}-${i}.png`) });
  }
  check(`${label}: a focused episode entry shows its own synopsis`, seen.episode !== null && /Mock episode synopsis/.test(seen.episode.overview), JSON.stringify(seen.episode));
  check(`${label}: a focused movie entry shows the movie synopsis`, seen.movie !== null && /Mock movie synopsis/.test(seen.movie.overview), JSON.stringify(seen.movie));
  check(`${label}: an entry without an overview shows no synopsis block`, seen.none !== null && !/synopsis/i.test(seen.none.text), JSON.stringify(seen.none));
  const style = seen.episode;
  check(`${label}: same 5-line clamp as the Library panel, no box`, style?.clamp === "5" && style.boxShadow === "none" && style.background === "rgba(0, 0, 0, 0)", JSON.stringify(style));
  await context.close();
}
await finish();
