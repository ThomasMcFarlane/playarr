#!/usr/bin/env node
// Navigation must not remount or blank content (owner report, 9 October 2026: "content shows, then disappears and
// jumps back in ... the same jump when I go back to the library"). With the query cache ON (a JWT-shaped session, as in
// production) at 1920x1080 and 1280x720, both themes, keyboard and click, this asserts for Library -> detail -> Back,
// Home -> detail -> Back and Search -> detail -> Back:
//   - Back paints the page's content at once: no skeleton and no blank frame on the way back (stale-while-revalidate),
//   - content never goes content -> skeleton/blank -> content on one page (no "flash"),
//   - the page root is mounted once per visit, and a route-enter animation never replays after the transition ends,
//   - the detail skeleton has the loaded page's shape: its copy column and its track surface sit within a tolerance of
//     where the loaded page puts them, and it shows the opened card's real title when the card was seen.
//   node scripts/nav-remount-e2e.mjs [--no-build] [--dist dir]
import { RECORDER, STOP, analyse } from "./nav-remount-audit.mjs";
import { boot, opt } from "./e2e-common.mjs";
const only = opt("only", "");

const { check, open, finish } = await boot({ movies: 60, series: 20, artists: 0, detailDelayMs: 2500, seasons: 2, onDeck: 0 }, { realisticAuth: true });

async function openCard(page, mode, sel) {
  const card = page.locator(sel).first();
  if (mode === "click") await card.click();
  else {
    await card.focus();
    await page.keyboard.press("Enter");
  }
}

const FLOWS = [
  ["library", "/movies", ".tv-title-card"],
  ["home", "/", ".tv-home-card"],
  ["search", "/search?q=a", ".tv-search-result"],
];

for (const [name, start, card] of FLOWS) {
  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    for (const theme of ["dark", "light"]) {
      for (const mode of ["keyboard", "click"]) {
        const label = `${name} ${w}x${h} ${theme} ${mode}`;
        if (only && !label.includes(only)) continue;
        const { context, page } = await open(start, { width: w, height: h, theme });
        if (theme === "light") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
        await page.waitForSelector(card, { timeout: 8000 });
        await page.waitForTimeout(600);
        await page.evaluate(RECORDER);
        await openCard(page, mode, card);
        await page.waitForSelector(".tv-detail-title", { timeout: 8000 });
        await page.waitForTimeout(700);
        const mid = await page.evaluate(() => window.__rec.frames.length);
        await page.keyboard.press("Escape");
        await page.waitForSelector(card, { timeout: 8000 });
        await page.waitForTimeout(900);
        const rec = await page.evaluate(STOP);
        const a = analyse(rec);
        const back = rec.frames.slice(mid);
        // Only frames of the page being returned to: the detail frames before it are the page being left.
        const backBad = back.filter((f) => f.pageId === name && (f.skeleton || (f.cards === 0 && f.text < 120))).length;
        check(`${label}: Back paints content at once (no skeleton/blank frame)`, backBad === 0, `${backBad} frames: ${a.seq.join(" ")}`);
        check(`${label}: no content->skeleton->content flash`, a.flashes === 0, a.seq.join(" "));
        check(`${label}: no blank frame`, a.blankFrames === 0, `${a.blankFrames}`);
        const replay = await page.evaluate(() => document.getAnimations().filter((x) => String(x.animationName ?? "").startsWith("route-enter")).length);
        check(`${label}: no route animation still replaying after the transition`, replay === 0, `${replay}`);
        await context.close();
      }
    }
  }
}

// Skeleton shape: the detail skeleton against the loaded detail, at both sizes and themes.
for (const kind of ["movies", "series"]) {
  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    for (const theme of ["dark", "light"]) {
      const { context, page } = await open(`/${kind}`, { width: w, height: h, theme });
      if (theme === "light") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      await page.waitForSelector(".tv-title-card");
      await page.waitForTimeout(500);
      const title = (await page.locator(".tv-title-card").first().innerText()).trim();
      await page.locator(".tv-title-card").first().click();
      await page.waitForSelector(".tv-detail-copy[aria-busy='true']", { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(150);
      const box = () => page.evaluate(() => {
        const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width }; };
        return { copy: r(".tv-detail-copy"), title: r(".tv-detail-copy .tv-detail-title"), track: r(".tv-rail-surface .skeleton-card, .tv-rail-surface .tv-media-track-scroll .media-card, .tv-rail-surface .tv-media-track-scroll > *"), busy: Boolean(document.querySelector(".tv-detail-copy[aria-busy='true']")), titleText: document.querySelector(".tv-detail-title")?.textContent ?? "" };
      });
      const skeleton = await box();
      await page.waitForSelector(".tv-detail-copy:not([aria-busy='true'])", { timeout: 8000 });
      await page.waitForTimeout(1200);
      const loaded = await box();
      const label = `${kind} ${w}x${h} ${theme}`;
      const tol = Math.max(24, w * 0.02);
      check(`${label}: detail skeleton shown while loading`, skeleton.busy, "no skeleton seen");
      check(`${label}: skeleton copy column at the loaded x/y`, skeleton.copy && loaded.copy && Math.abs(skeleton.copy.x - loaded.copy.x) <= tol && Math.abs(skeleton.copy.y - loaded.copy.y) <= tol, JSON.stringify([skeleton.copy, loaded.copy]));
      check(`${label}: skeleton shows the opened card's title`, title.includes(skeleton.titleText.trim()) || skeleton.titleText.trim() === loaded.titleText.trim(), `${skeleton.titleText} / ${title}`);
      check(`${label}: skeleton first card at the loaded track's first card (x)`, skeleton.track && loaded.track && Math.abs(skeleton.track.x - loaded.track.x) <= tol, JSON.stringify([skeleton.track, loaded.track]));
      await context.close();
    }
  }
}
await finish();
