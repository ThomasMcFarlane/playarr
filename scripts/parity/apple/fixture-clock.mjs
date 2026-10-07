#!/usr/bin/env node
// Prints the fixture clock (ISO 8601) the captures freeze at. It is read from scripts/fixtures/catalog.mjs
// (FIXTURE_CLOCK) so the app and the web capture never hard-code a second copy; `fallback` (argv[2]) is used only
// while a checkout still lacks the constant.
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const fallback = process.argv[2] || "2026-10-07T12:00:00Z";
try {
  const catalog = await import(pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/catalog.mjs")).href);
  const value = catalog.FIXTURE_CLOCK;
  const text = value instanceof Date ? value.toISOString() : value;
  console.log(text || fallback);
} catch {
  console.log(fallback);
}
