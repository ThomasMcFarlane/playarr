#!/usr/bin/env node
// Guard: every poster/title card (Home rails, Library, Search, Playlists, detail "more like this", music) renders at
// exactly the Library grid card's size at every stage size and in both themes. Library's default grid card
// (`.tv-title-grid .tv-title-card`, screen view, medium size) is the canonical card.
//   node scripts/card-size-e2e.mjs [--no-build] [--dist dir] [--table] [--shots dir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { boot, opt } from "./e2e-common.mjs";

const TOL = 1;
const THEMES_ALL = ["dark", "light"];
// The two TV stage sizes in both themes, plus the tablet-landscape and phone layouts (dark only) which size the card on
// their own columns.
const SIZES = [[1920, 1080, THEMES_ALL], [1280, 720, THEMES_ALL], [1024, 768, ["dark"]], [390, 844, ["dark"]]];
const table = process.argv.includes("--table");
const shots = opt("shots", "");
if (shots) mkdirSync(shots, { recursive: true });

const { check, open, finish } = await boot({ movies: 40, series: 12, artists: 12, playlists: 2, playlistItems: 12, watchlist: 6 });

/** Metrics of the first matching card: card box, art box, caption size, art-to-caption gap. */
const measure = async (page, sel, nth = 0) => {
  // Measure layout size, not the focus lift: the first card is focused and scales/translates.
  await page.addStyleTag({ content: '[class*="-card"], [class*="-art"], [class*="search-result"] { transform: none !important; transition: none !important; }' });
  return page.evaluate(([selector, index]) => {
    const els = [...document.querySelectorAll(selector)].filter((e) => e.getBoundingClientRect().width > 0);
    const el = els[index];
    if (!el) return null;
    const box = (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top }; };
    const art = el.querySelector('[class*="-art"]');
    const cap = el.querySelector("strong");
    const a = art ? box(art) : null;
    // The caption text's own top (a caption may carry its gap as padding, so the element box is not comparable).
    const c = cap ? (() => { const range = document.createRange(); range.selectNodeContents(cap); return range.getBoundingClientRect(); })() : null;
    return {
      card: box(el),
      art: a,
      font: cap ? parseFloat(getComputedStyle(cap).fontSize) : null,
      gap: a && c ? c.top - (a.top + a.h) : null,
      count: els.length,
    };
  }, [sel, nth]);
};

// The cover (2:3) view has its own canonical card: the Library cover grid. Home follows it when Home is set to covers.
const COVER_SURFACES = [
  { name: "Library cover grid", path: "/movies?view=cover", sel: ".tv-title-grid .tv-title-card", canonical: true },
  { name: "Home rail (cover view)", path: "/", sel: ".tv-home-rails .tv-home-card", homeCover: true },
];

const SURFACES = (ids) => [
  { name: "Library movies", path: "/movies", sel: ".tv-title-grid .tv-title-card", canonical: true },
  { name: "Library series", path: "/series", sel: ".tv-title-grid .tv-title-card" },
  { name: "Home rail", path: "/", sel: ".tv-home-rails .tv-home-card" },
  { name: "Search results", path: "/search?q=a", sel: ".tv-search-result" },
  { name: "Playlists directory", path: "/playlists", sel: ".tv-playlist-directory-card" },
  { name: "Playlist items", path: `/playlists?playlist=${ids.playlist}`, sel: ".tv-home-card" },
  { name: "Detail more-like-this", path: `/movies/${ids.movie}`, sel: "[data-tv-track-id=similar] a.media-card" },
  { name: "Music wall", path: "/music", sel: ".tv-title-grid .tv-title-card" },
];

const rows = [];
for (const theme of THEMES_ALL) {
  for (const [width, height, themes] of SIZES) {
    if (!themes.includes(theme)) continue;
    const ids = { playlist: "00000000-0000-4000-8000-000000000100", movie: "" };
    const { context, page } = await open("/movies", { width, height, theme });
    await page.evaluate((t) => { localStorage.setItem("playarr-theme", t); document.documentElement.dataset.theme = t; }, theme);
    await page.reload();
    await page.waitForTimeout(1200);
    ids.movie = await page.evaluate(() => document.querySelector(".tv-title-grid .tv-title-card")?.getAttribute("href")?.split("/").pop() ?? "");
    let canon = null;
    for (const s of [...SURFACES(ids), ...COVER_SURFACES]) {
      if (s.canonical && s.name.includes("cover")) canon = null;
      await page.evaluate((cover) => { try { localStorage.setItem("playarr-home-view", cover ? "cover" : "thumbnail"); } catch {} }, Boolean(s.homeCover));
      await page.goto(new URL(s.path, page.url()).href);
      await page.waitForTimeout(1100);
      const m = await measure(page, s.sel);
      const label = `${theme} ${width}x${height} ${s.name}`;
      if (shots && (s.canonical || s.name === "Home rail" || s.name === "Detail more-like-this" || s.name === "Search results")) {
        await page.screenshot({ path: join(shots, `${s.name.replace(/\W+/g, "-").toLowerCase()}-${theme}-${width}.png`) });
      }
      if (s.canonical) canon = m;
      rows.push({ label, m, canon });
      if (table) console.log(label.padEnd(44), m ? `card ${m.card.w.toFixed(1)}x${m.card.h.toFixed(1)} art ${m.art?.w.toFixed(1)}x${m.art?.h.toFixed(1)} font ${m.font} gap ${m.gap?.toFixed(1)}` : "NOT FOUND");
      if (!m) { check(`${label}: card present`, false, "no card rendered"); continue; }
      if (!canon) continue;
      const near = (a, b) => Math.abs(a - b) <= TOL;
      check(`${label}: card ${m.card.w.toFixed(1)}x${m.card.h.toFixed(1)} = Library ${canon.card.w.toFixed(1)}x${canon.card.h.toFixed(1)}`,
        near(m.card.w, canon.card.w) && near(m.card.h, canon.card.h));
      check(`${label}: art ${m.art?.w.toFixed(1)}x${m.art?.h.toFixed(1)} = Library`, Boolean(m.art) && near(m.art.w, canon.art.w) && near(m.art.h, canon.art.h));
      check(`${label}: caption size ${m.font}px and gap ${m.gap?.toFixed(1)} = Library`, m.font === canon.font && m.gap !== null && near(m.gap, canon.gap));
    }
    await context.close();
  }
}
await finish();
