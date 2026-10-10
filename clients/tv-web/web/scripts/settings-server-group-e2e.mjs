#!/usr/bin/env node
// Settings -> Server lists the server group's members automatically and read-only (board 1.9982).
// Mock with a group of two (this server plus one other): the primary row carries the group badge, the other
// member is the only extra row, and the group entries carry no buttons or inputs.
//   node scripts/settings-server-group-e2e.mjs [--dist dist] [--no-build]
import { boot, opt, root } from "./e2e-common.mjs";
import { startServer } from "./nav-perf/server.mjs";
import { join } from "node:path";

const h = await boot({ serverGroup: true });
try {
  const { page, errors } = await h.open("/settings/server", );
  await page.waitForSelector(".connected-server-list");
  await page.waitForSelector("[data-server-group-member], .connected-server-badge", { timeout: 5000 });
  const text = await page.locator(".connected-server-list").innerText();
  const members = page.locator("[data-server-group-member]");
  h.check("exactly one extra group row for a 2-member group", (await members.count()) === 1, `${await members.count()} rows`);
  h.check("the other member is listed with one address", /Server B/.test(text) && (await members.locator("small").count()) === 1, text);
  h.check("this server is not listed twice", !/Server A/.test(text), text);
  const primaryBadges = await page.locator(".connected-server:not([data-server-group-member]) .connected-server-badge").allInnerTexts();
  h.check("the primary row carries the group badge", primaryBadges.some((t) => /server group/i.test(t)), primaryBadges.join(", "));
  h.check("group rows carry the group badge", /server group/i.test(await members.first().locator(".connected-server-badge").innerText()));
  h.check("no edit controls on group entries", (await members.locator("button, input, select, a").count()) === 0);
  h.check("no 'forget server' control remains", (await page.getByRole("button", { name: /forget/i }).count()) === 0);
  h.check("no page errors", errors.length === 0, errors.join("; "));
  // Standalone server: no group entries.
  const plainServer = await startServer({ distDir: opt("dist", join(root, "dist")), movies: 4, series: 2, artists: 0 });
  const plain = await h.open("/settings/server", { server: plainServer });
  await plain.page.waitForSelector(".connected-server-list");
  h.check("standalone server shows no group entries", (await plain.page.locator("[data-server-group-member]").count()) === 0);
} finally {
  /* servers close in finish() */
}
await h.finish();
