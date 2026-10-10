import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The package builds the shared web client, so it must define every compile-time
// constant the web build defines; a missing one is a ReferenceError at startup.
test("vite config defines every compile-time constant of the web build", async () => {
  const keys = (source) => new Set(source.match(/\b__[A-Z][A-Z0-9_]*__(?=\s*:)/g));
  const web = keys(await readFile(new URL("../../../web/vite.config.ts", import.meta.url), "utf8"));
  const app = keys(await readFile(new URL("../vite.config.ts", import.meta.url), "utf8"));
  assert.ok(web.size > 0);
  for (const key of web) assert.ok(app.has(key), `${key} is not defined`);
});
