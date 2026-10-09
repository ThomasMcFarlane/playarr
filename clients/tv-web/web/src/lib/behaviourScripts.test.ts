import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every Playwright script that runs against the built bundle and the mock API is part of the PR gate (CI job
 * `web behaviour`, scripts/web-behaviour.mjs and web-behaviour.config.json). A new script cannot be added to scripts/ and forgotten: it has to be listed
 * there, or excluded with a reason.
 */
const scripts = join(dirname(fileURLToPath(import.meta.url)), "../../scripts");
const config = JSON.parse(readFileSync(join(scripts, "web-behaviour.config.json"), "utf8")) as {
  scripts: string[];
  excluded: Record<string, string>;
  tracked: Record<string, string>;
};
const BEHAVIOUR_SCRIPTS = config.scripts;
const BEHAVIOUR_EXCLUDED = config.excluded;

describe("web behaviour gate", () => {
  const usesMockApi = readdirSync(scripts)
    .filter((name) => name.endsWith(".mjs") && !["web-behaviour.mjs", "e2e-common.mjs"].includes(name))
    .filter((name) => /nav-perf\/server|e2e-common/.test(readFileSync(join(scripts, name), "utf8")))
    .map((name) => name.replace(/\.mjs$/, ""));

  it("lists every mock-API script or excludes it with a reason", () => {
    const covered = new Set<string>([...BEHAVIOUR_SCRIPTS, ...Object.keys(BEHAVIOUR_EXCLUDED)]);
    // Every nav-*-e2e script runs in the `web layout parity` job (its keyboard e2e step loops over that glob),
    // so a new one is covered without a listing.
    const viaParityGlob = (name: string) => /^nav-.+-e2e$/.test(name);
    expect(usesMockApi.filter((name) => !covered.has(name) && !viaParityGlob(name))).toEqual([]);
  });

  it("tracks only listed scripts, each with a task row", () => {
    for (const [name, reason] of Object.entries(config.tracked)) {
      expect(config.scripts, name).toContain(name);
      expect(reason, name).toMatch(/row \d+/);
    }
  });

  it("lists only scripts that exist", () => {
    expect(BEHAVIOUR_SCRIPTS.filter((name) => !existsSync(join(scripts, `${name}.mjs`)))).toEqual([]);
  });

  it("covers the rail geometry, calendar, TV viewport and nav smoke checks", () => {
    for (const name of ["rail-geometry-e2e", "calendar-nav", "tv-viewport", "nav-smoke"]) {
      expect(BEHAVIOUR_SCRIPTS).toContain(name);
    }
  });
});
