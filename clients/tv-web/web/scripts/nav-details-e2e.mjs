#!/usr/bin/env node
// The focused item's extended details (the runtime on the library's left panel) are cached, prefetched and
// never queued behind a backlog.
//
//  1. Cached: once the focus has rested, its neighbours are fetched in the background, so stepping onto one
//     shows the runtime in the same frame as the new title (key to details within one frame).
//  2. Holding an arrow keeps at most one current plus two background detail requests in flight, and does not
//     start one request per card it passes over.
//  3. No stale render: after rapid moves, the panel shows the settled item's own runtime, and no frame ever
//     paired a title with another item's runtime.
//
// The mock API answers a detail call after 250 ms, so a backlog or a missing prefetch would show.
//
//   node scripts/nav-details-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";
import { mockRuntimeMinutes } from "./nav-perf/server.mjs";

const { check, open, finish } = await boot({ detailDelayMs: 250, movies: 80, series: 4 }, { realisticAuth: true });
const DETAIL = /\/api\/v1\/catalog\/[^/?#]+$/;
/** The current request plus two background ones. */
const MAX_IN_FLIGHT = 3;

const label = (id) => {
  const total = mockRuntimeMinutes(id);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours <= 0) return `${minutes} min`;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
};
const expectedLabels = (ids) => Object.fromEntries(ids.map((id) => [id, label(id)]));

const INSTALL = () => {
  const state = { frame: 0, keys: [], changes: [] };
  window.__details = state;
  const count = () => {
    state.frame += 1;
    requestAnimationFrame(count);
  };
  requestAnimationFrame(count);
  const read = () => {
    const root = document.querySelector(".tv-library-preview");
    return {
      title: root?.querySelector("h2")?.textContent ?? "",
      runtime: root?.querySelector("[data-detail-field='runtime']")?.textContent ?? null,
    };
  };
  let last = read();
  new MutationObserver(() => {
    const now = read();
    if (now.title === last.title && now.runtime === last.runtime) return;
    state.changes.push({ ...now, frame: state.frame, t: performance.now() });
    last = now;
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
  addEventListener(
    "keydown",
    (event) => {
      if (event.key.startsWith("Arrow")) state.keys.push({ key: event.key, frame: state.frame, t: performance.now() });
    },
    true
  );
};

async function session() {
  const { context, page, errors } = await open("/movies");
  const flight = { now: 0, peak: 0, started: 0 };
  page.on("request", (request) => {
    if (!DETAIL.test(new URL(request.url()).pathname)) return;
    flight.now += 1;
    flight.started += 1;
    flight.peak = Math.max(flight.peak, flight.now);
  });
  const done = (request) => {
    if (DETAIL.test(new URL(request.url()).pathname)) flight.now = Math.max(0, flight.now - 1);
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  await page.waitForSelector("[data-library-index]");
  await page.evaluate(INSTALL);
  return { context, page, errors, flight };
}

/** Title to id of every mounted card, to check what a panel shows against whose detail it is. */
const cardIds = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll(".tv-title-card")].map((card) => [
        card.querySelector("strong")?.textContent ?? "",
        (card.getAttribute("href") ?? "").split("/").pop(),
      ])
    )
  );

// 1. Cached neighbours show their details in the frame of the key.
{
  const { context, page, errors } = await session();
  await page.waitForTimeout(2500); // focus rests: the neighbours are fetched at low priority
  const ids = await cardIds(page);
  const expected = expectedLabels(Object.values(ids));
  const byTitle = Object.fromEntries(Object.entries(ids).map(([title, id]) => [title, expected[id]]));
  await page.evaluate(() => (window.__details.changes.length = 0, (window.__details.keys.length = 0)));
  for (const key of ["ArrowRight", "ArrowDown", "ArrowRight", "ArrowDown", "ArrowLeft"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(900);
  }
  const { changes, keys } = await page.evaluate(() => window.__details);
  const titleChanges = changes.filter((change, index) => index === 0 || change.title !== changes[index - 1].title);
  check(`cached: ${titleChanges.length} title changes observed`, titleChanges.length >= 4, String(titleChanges.length));
  const missing = titleChanges.filter((change) => change.runtime === null);
  check("cached: every step onto a prefetched neighbour shows its runtime in the frame of the new title", missing.length === 0, JSON.stringify(missing));
  const lags = titleChanges.map((change) => {
    const key = [...keys].reverse().find((candidate) => candidate.t <= change.t);
    return key ? change.frame - key.frame : Infinity;
  });
  check(`cached: key to details worst ${Math.max(...lags)} frames (<= 2: the keydown frame and the next)`, Math.max(...lags) <= 2, lags.join(","));
  const wrong = changes.filter((change) => change.runtime !== null && byTitle[change.title] !== undefined && byTitle[change.title] !== change.runtime);
  check("cached: a runtime is only ever shown with its own title", wrong.length === 0, JSON.stringify(wrong));
  check("cached: no page errors", errors.length === 0, errors.join(";"));
  await context.close();
}

// 2 and 3. Holding an arrow, then settling.
{
  const { context, page, errors, flight } = await session();
  await page.waitForTimeout(1200);
  const ids = await cardIds(page);
  const expected = expectedLabels(Object.values(ids));
  const byTitle = Object.fromEntries(Object.entries(ids).map(([title, id]) => [title, expected[id]]));
  const before = flight.started;
  await page.evaluate(() => (window.__details.changes.length = 0));
  const PRESSES = 40;
  for (let i = 0; i < PRESSES; i += 1) {
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(35);
  }
  const duringHold = flight.started - before;
  check(`hold: at most ${MAX_IN_FLIGHT} detail requests in flight (peak ${flight.peak})`, flight.peak <= MAX_IN_FLIGHT, String(flight.peak));
  // How many start depends on how fast the host delivers the keys (a request only starts for a focus that rested
  // 60 ms), so the bound is "never more than one per key", and the unit tests pin the exact rule.
  check(`hold: ${duringHold} detail requests for ${PRESSES} presses (at most one per press)`, duringHold <= PRESSES, String(duringHold));
  await page.waitForTimeout(2500);
  check(`hold: still at most ${MAX_IN_FLIGHT} in flight once settled, while the rest of the page warms (peak ${flight.peak})`, flight.now <= MAX_IN_FLIGHT && flight.peak <= MAX_IN_FLIGHT, `${flight.now}/${flight.peak}`);
  const settled = await page.evaluate(() => {
    const active = document.querySelector("[data-remote-active]") ?? document.activeElement;
    const card = active?.closest?.(".tv-title-card");
    return {
      title: card?.querySelector("strong")?.textContent ?? null,
      href: card?.getAttribute("href") ?? null,
      shown: document.querySelector(".tv-library-preview h2")?.textContent ?? "",
      runtime: document.querySelector(".tv-library-preview [data-detail-field='runtime']")?.textContent ?? null,
    };
  });
  check("settled: the panel shows the focused title", settled.title !== null && settled.shown === settled.title, JSON.stringify(settled));
  const settledId = settled.href?.split("/").pop();
  check(
    `settled: the panel shows the focused item's own runtime (${settled.runtime})`,
    settledId !== undefined && settled.runtime === label(settledId),
    JSON.stringify(settled)
  );
  const { changes } = await page.evaluate(() => window.__details);
  const freshIds = await cardIds(page);
  const all = { ...byTitle, ...Object.fromEntries(Object.entries(freshIds).map(([title, id]) => [title, label(id)])) };
  const stale = changes.filter((change) => change.runtime !== null && all[change.title] !== undefined && all[change.title] !== change.runtime);
  check(`no stale render: ${changes.length} panel changes, none paired a title with another item's runtime`, stale.length === 0, JSON.stringify(stale.slice(0, 3)));
  check("hold: no page errors", errors.length === 0, errors.join(";"));
  await context.close();
}

await finish();
