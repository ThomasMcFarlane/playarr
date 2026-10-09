#!/usr/bin/env node
// The persistent (IndexedDB) copy of the focused-item details.
//
//  1. The store itself, in a real browser: write and read, live-event invalidation by tag, other accounts' rows
//     purged, the LRU cap (least recently used go first, reads count as use), and expiry.
//  2. End to end: a detail the focus has seen is on disk; after a reload (memory empty) the left panel paints
//     its runtime from disk well inside the time the server needs to answer (250 ms in this mock), and the
//     detail is still revalidated over the network.
//
//   node scripts/nav-details-cache-e2e.mjs [--no-build] [--dist dir]
import { build } from "esbuild";
import { boot, root } from "./e2e-common.mjs";
import { join } from "node:path";

const { check, open, finish, server } = await boot({ detailDelayMs: 250, movies: 60, series: 4 });

// 1. The store class, bundled for the page.
const bundle = await build({
  entryPoints: [join(root, "src/lib/detailsStore.ts")],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "DetailsStoreModule",
  platform: "browser",
  target: "es2020",
});
const code = bundle.outputFiles[0].text;
{
  const { context, page, errors } = await open("/healthz");
  await page.addScriptTag({ content: code });
  const result = await page.evaluate(async () => {
    const { IndexedDbDetailsStore, DETAILS_STORE_VERSION } = window.DetailsStoreModule;
    const out = {};
    let now = 1_000_000;
    const store = new IndexedDbDetailsStore(() => now, { max: 5, trimTo: 3, maxAgeMs: 10_000 });
    const detail = (id) => ({ work: { id }, children: "Movie" });
    // write and read
    await store.put("A", "w1", detail("w1"), ["catalog", "progress", "watchlist"], now);
    out.read = (await store.get("A", "w1"))?.data?.work?.id;
    out.otherScopeMiss = (await store.get("B", "w1")) === undefined;
    // invalidate by tag: a household event does not touch a detail, a progress event does
    await store.invalidate("A", ["household"]);
    out.afterHousehold = (await store.get("A", "w1"))?.data?.work?.id;
    await store.invalidate("A", ["progress"]);
    out.afterProgress = (await store.get("A", "w1")) === undefined;
    // purge other accounts
    await store.put("A", "w2", detail("w2"), ["catalog"], now);
    await store.put("B", "w2", detail("w2"), ["catalog"], now);
    await store.purgeExcept("A");
    out.purgedOther = (await store.get("B", "w2")) === undefined;
    out.keptOwn = (await store.get("A", "w2")) !== undefined;
    await store.purgeExcept(undefined);
    out.signOutEmpties = (await store.get("A", "w2")) === undefined;
    // LRU: six rows against a cap of five trims to three, keeping the most recently used (a read counts)
    for (let i = 1; i <= 6; i += 1) {
      now += 10;
      await store.put("A", `r${i}`, detail(`r${i}`), ["catalog"], now);
    }
    now += 10;
    await store.get("A", "r1");
    now += 10;
    await store.trim();
    const kept = [];
    for (let i = 1; i <= 6; i += 1) if ((await store.get("A", `r${i}`)) !== undefined) kept.push(`r${i}`);
    out.kept = kept;
    // expiry
    now += 20_000;
    out.expired = (await store.get("A", "r1")) === undefined;
    out.version = DETAILS_STORE_VERSION;
    return out;
  });
  check("store: a stored detail reads back, per account", result.read === "w1" && result.otherScopeMiss, JSON.stringify(result));
  check("store: a household event leaves details, a progress event drops them", result.afterHousehold === "w1" && result.afterProgress, JSON.stringify(result));
  check("store: another account's rows are purged, sign-out empties it", result.purgedOther && result.keptOwn && result.signOutEmpties, JSON.stringify(result));
  check(
    `store: the LRU cap trims to the most recently used (kept ${result.kept})`,
    result.kept.length === 3 && result.kept.includes("r1") && result.kept.includes("r6") && result.kept.includes("r5"),
    JSON.stringify(result.kept)
  );
  check("store: expired rows are not served", result.expired, JSON.stringify(result));
  check("store: no page errors", errors.length === 0, errors.join(";"));
  await context.close();
}

// 2. Persisted across a reload, painted before the network answers.
{
  const { context, page, errors } = await open("/movies", { queryCache: true });
  await page.waitForSelector("[data-library-index]");
  const rowCount = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const opening = indexedDB.open("playarr-details");
          opening.onsuccess = () => {
            const count = opening.result.transaction("details").objectStore("details").count();
            count.onsuccess = () => resolve(count.result);
          };
          opening.onerror = () => resolve(-1);
        })
    );
  let rows = 0;
  for (let i = 0; i < 40 && rows < 4; i += 1) {
    await page.waitForTimeout(250);
    rows = await rowCount();
  }
  check(`persisted: ${rows} details on disk after the focus rested (>= 4)`, rows >= 4, String(rows));
  let detailRequests = 0;
  page.on("request", (request) => {
    if (/\/api\/v1\/catalog\/[^/?#]+$/.test(new URL(request.url()).pathname)) detailRequests += 1;
  });
  // From here the server needs 8 s per detail, so anything shown sooner came from disk.
  server.setDetailDelay(8000);
  // Installed before the reload's scripts run, so times are from the start of the navigation.
  await page.addInitScript(() => {
    window.__paint = { previewAt: null, runtimeAt: null };
    const tick = () => {
      const now = performance.now();
      if (window.__paint.previewAt === null && document.querySelector(".tv-library-preview h2")) window.__paint.previewAt = now;
      if (document.querySelector(".tv-library-preview [data-detail-field='runtime']")) {
        window.__paint.runtimeAt = now;
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.reload();
  await page.waitForSelector("[data-library-index]");
  await page.waitForTimeout(2000);
  const paint = await page.evaluate(() => window.__paint);
    check(
    `persisted: after a reload the runtime paints from disk (${paint.runtimeAt === null ? "never" : Math.round(paint.runtimeAt)} ms after navigation, the server needs 8000)`,
    paint.runtimeAt !== null && paint.runtimeAt < 6000,
    JSON.stringify(paint)
  );
  check(`persisted: the detail is still revalidated over the network (${detailRequests} requests)`, detailRequests >= 1, String(detailRequests));
  check("persisted: no page errors", errors.length === 0, errors.join(";"));
  await context.close();
}

await finish();
