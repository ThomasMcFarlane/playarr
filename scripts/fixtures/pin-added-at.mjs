#!/usr/bin/env node
// Writes the explicit `added_at` values from catalog.mjs into the fixture database (via the sqlite3 CLI, SQLite
// allows a second writer while the server runs). Usage: pin-added-at.mjs <playarr.db>. Idempotent.
import { spawnSync } from "node:child_process";
import { ADDED_AT } from "./catalog.mjs";

const db = process.argv[2];
if (!db) {
  console.error("usage: pin-added-at.mjs <playarr.db>");
  process.exit(2);
}
const esc = (v) => v.replace(/'/g, "''");
const sql = Object.entries(ADDED_AT)
  .map(([title, at]) => `UPDATE works SET added_at='${esc(at)}' WHERE title='${esc(title)}';`)
  .join("\n");
const r = spawnSync("sqlite3", ["-cmd", ".timeout 10000", db, sql], { encoding: "utf8" });
if (r.status !== 0) {
  console.error(`pin-added-at: sqlite3 failed: ${r.stderr}`);
  process.exit(1);
}
console.log(`added_at pinned for ${Object.keys(ADDED_AT).length} titles`);
