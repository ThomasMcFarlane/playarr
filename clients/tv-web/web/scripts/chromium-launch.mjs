// Launches Playwright's Chromium for the web scripts. CI and developer machines keep the browser Playwright installed
// for the capture tools (scripts/parity), whose revision can differ from this package's playwright-core, so pick the
// newest installed chromium build instead of the revision this package expects. NAV_PERF_CHROMIUM overrides.
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

export function chromiumExecutable() {
  if (process.env.NAV_PERF_CHROMIUM) return process.env.NAV_PERF_CHROMIUM;
  const dir = join(homedir(), ".cache/ms-playwright");
  const full = existsSync(dir) ? readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : undefined;
  return full ? join(dir, full, "chrome-linux64/chrome") : undefined;
}

export function launchChromium(options = {}) {
  const executablePath = chromiumExecutable();
  return chromium.launch(executablePath ? { executablePath, ...options } : options);
}
