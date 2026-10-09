#!/usr/bin/env node
// Opening or closing a shell-column panel (Filters) must not refresh the page and must animate smoothly (owner report,
// 9 October 2026: "it jumps in, then resets and animates half ... both open and close cause the content in the page to
// refresh").
//
// For Movies, Series, Search and Calendar at 1920x1080 and 1280x720, in both themes, keyboard (Enter on Filters, then
// Escape) and click: across open and close assert
//   - 0 data requests to the API, bar the panel's own language facets (applying a filter may refetch; opening and closing may not),
//   - 0 remounts of the page content (every element under .app-main that is not the drawer stays the same node) and no
//     route transition (`data-route-motion`, `route-enter-*` animations) replaying on the page,
//   - a monotonic open: once the drawer appears its left edge only moves right-to-left and its opacity only rises,
//   - the panel is exactly the viewport height on every frame of open and close,
//   - a monotonic close that mirrors it: the ghost's left edge only moves left-to-right.
//
//   node scripts/nav-panel-open-e2e.mjs [--no-build] [--dist dir] [--only movies,series,search,calendar]
import { boot, opt } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ movies: 60, series: 30 });
const EPS = 0.75;

const RECORD = () => {
  // Tag the page content so a remount (a new node) shows up as an untagged or disconnected element.
  const content = [...document.querySelectorAll(".app-main *")].filter((el) => !el.closest(".tv-filter-drawer, [data-drawer-ghost]") && el.tagName !== "IMG");
  window.__tagged = content;
  window.__rec = { drawer: [], motion: [], routeAnimations: 0 };
  window.__slides = new Set();
  window.__nodes = new Set();
  const tick = () => {
    const panel = document.querySelector(".tv-filter-drawer:not([data-drawer-ghost])") ?? document.querySelector("[data-drawer-ghost]");
    const ghost = Boolean(panel?.hasAttribute("data-drawer-ghost"));
    if (panel) {
      if (!ghost) window.__nodes.add(panel);
      const b = panel.getBoundingClientRect();
      window.__rec.drawer.push({ ghost, left: b.left, top: b.top, height: b.height, vh: window.innerHeight, opacity: Number(getComputedStyle(panel).opacity) });
    }
    const main = document.querySelector(".app-main");
    window.__rec.motion.push(main?.getAttribute("data-route-motion") ?? null);
    for (const a of document.getAnimations()) {
      if (a.animationName === "tv-filter-drawer-in") window.__slides.add(a);
      if (String(a.animationName ?? "").startsWith("route-enter")) window.__rec.routeAnimations += 1;
    }
    window.__raf = requestAnimationFrame(tick);
  };
  window.__raf = requestAnimationFrame(tick);
};

const STOP = () => {
  cancelAnimationFrame(window.__raf);
  const gone = window.__tagged.filter((el) => !el.isConnected).length;
  return { ...window.__rec, slides: window.__slides.size, nodes: window.__nodes.size, gone, total: window.__tagged.length };
};

const monotonic = (values, dir) => values.every((v, i) => !i || (dir > 0 ? v >= values[i - 1] - EPS : v <= values[i - 1] + EPS));

const pages = [
  ["movies", "/movies", "[data-library-index]"],
  ["series", "/series", "[data-library-index]"],
  ["search", "/search?q=a", ".tv-search-results, [data-search-result], .page"],
  ["calendar", "/calendar", ".calendar-scroll"],
];

const only = opt("only", "").split(",").filter(Boolean);
for (const [name, path, ready] of pages) {
  if (only.length && !only.includes(name)) continue;
  // Each width, theme and input mode is covered on every page without the full cross product (keeps CI short).
  for (const [width, height, theme, mode] of [
    [1920, 1080, "dark", "keyboard"],
    [1920, 1080, "light", "click"],
    [1280, 720, "dark", "click"],
    [1280, 720, "light", "keyboard"],
  ]) {
    {
      {
        const label = `${name} ${width}x${height} ${theme} ${mode}`;
        const { context, page, errors } = await open("/", { width, height, theme });
        try {
          // Arrive by an in-app navigation, so a route transition has run (and expired) before the panel is used.
          await page.evaluate((to) => {
            history.pushState({}, "", to);
            dispatchEvent(new PopStateEvent("popstate"));
          }, path);
          await page.waitForSelector(ready, { timeout: 8000 });
          await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
          // Let the arrival transition, skeletons and first fetches finish.
          await page.waitForTimeout(2500);
          const requests = [];
          const onRequest = (request) => {
            const url = new URL(request.url());
            // The panel's own facet list is fetched once when it opens; it is not page content.
            if (url.pathname.startsWith("/api/") && url.pathname !== "/api/v1/catalog/languages") requests.push(`${request.method()} ${url.pathname}${url.search}`);
          };
          page.on("request", onRequest);
          const launcher = page.locator("[data-shell-action-column] [data-filters-button]").first();
          await page.evaluate(RECORD);
          if (mode === "keyboard") {
            await launcher.focus();
            await page.keyboard.press("Enter");
          } else {
            await launcher.click();
          }
          await page.waitForSelector(".tv-filter-drawer", { timeout: 5000 });
          await page.waitForTimeout(1200);
          if (mode === "keyboard") await page.keyboard.press("Escape");
          else await page.locator(".tv-filter-drawer .drawer-close").click();
          await page.waitForTimeout(1200);
          page.off("request", onRequest);
          const rec = await page.evaluate(STOP);
          const live = rec.drawer.filter((d) => !d.ghost);
          const ghost = rec.drawer.filter((d) => d.ghost);
          check(`${label}: 0 API requests across open and close`, requests.length === 0, requests.join(", "));
          check(`${label}: 0 page-content remounts`, rec.gone === 0 && rec.total > 5, `${rec.gone} of ${rec.total} nodes replaced`);
          check(`${label}: no route transition replays`, rec.motion.every((m) => m === null) && rec.routeAnimations === 0, `${[...new Set(rec.motion)]} ${rec.routeAnimations}`);
          check(`${label}: the slide-in runs once on one drawer node`, rec.slides === 1 && rec.nodes === 1, `${rec.slides} slide animations, ${rec.nodes} nodes`);
          check(`${label}: open is monotonic (${live.length} frames)`, live.length > 0 && monotonic(live.map((d) => d.left), -1) && monotonic(live.map((d) => d.opacity), 1), live.slice(0, 40).map((d) => d.left.toFixed(0)).join(","));
          check(`${label}: close mirrors it (${ghost.length} frames)`, ghost.length > 0 && monotonic(ghost.map((d) => d.left), 1), ghost.slice(0, 40).map((d) => d.left.toFixed(0)).join(","));
          check(`${label}: panel is full viewport height on every frame`, rec.drawer.length > 0 && rec.drawer.every((d) => Math.abs(d.height - d.vh) < 1 && Math.abs(d.top) < 1), rec.drawer.filter((d) => Math.abs(d.height - d.vh) >= 1).slice(0, 5).map((d) => `${d.height}/${d.vh}`).join(","));
          check(`${label}: no page errors`, errors.length === 0, errors.join(";"));
        } catch (error) {
          check(label, false, String(error?.message ?? error).split("\n")[0]);
        }
        await context.close();
      }
    }
  }
}

await finish();
