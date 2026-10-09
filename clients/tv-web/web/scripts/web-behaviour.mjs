#!/usr/bin/env node
// Runs every web Playwright smoke and behaviour script that needs only the built bundle and the deterministic mock API
// (scripts/nav-perf/server.mjs), against one shared build. This is the PR gate for the web styles and behaviour
// (CI job `web behaviour`, three shards); the full native-parity regression is separate and manual (workflow_dispatch).
//
//   node scripts/web-behaviour.mjs [--dist dir] [--only name] [--shard i/n] [--list]
//
// --shard i/n runs the i-th of n balanced subsets (1-based). Scripts are spread by their measured run time (the
// "seconds" map in the config; 30 for an unlisted one) so the CI shards finish together; the union of all shards is the full list.
//
// Add a new script to web-behaviour.config.json when it is added to scripts/. `src/lib/behaviourScripts.test.ts` fails
// when a script that uses the mock API is neither listed nor excluded with a reason.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The list of scripts, their extra arguments and the excluded ones (with a reason) live in web-behaviour.config.json, which
// `src/lib/behaviourScripts.test.ts` reads. "args" cuts the tablet sweep to every 60 px (25 widths in both themes otherwise).
const config = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "web-behaviour.config.json"), "utf8"));
const BEHAVIOUR_SCRIPTS = config.scripts;
const BEHAVIOUR_ARGS = config.args;
// Scripts that fail on main today, each with a task row: they still run and report (a warning), but do not fail the job.
// The list may only shrink; src/lib/behaviourScripts.test.ts keeps every entry a listed script with a row.
const TRACKED = config.tracked ?? {};

// shardOf(scripts, i, n): the scripts of shard i (1-based) of n, longest-first onto the lightest shard.
export function shardOf(scripts, weights, i, n) {
  const load = Array.from({ length: n }, () => 0);
  const picked = Array.from({ length: n }, () => []);
  const order = [...scripts].sort((a, b) => (weights[b] ?? 30) - (weights[a] ?? 30) || scripts.indexOf(a) - scripts.indexOf(b));
  for (const name of order) {
    const lightest = load.indexOf(Math.min(...load));
    load[lightest] += weights[name] ?? 30;
    picked[lightest].push(name);
  }
  return scripts.filter((name) => picked[i - 1].includes(name));
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  if (args.includes("--list")) {
    console.log(BEHAVIOUR_SCRIPTS.join("\n"));
    return;
  }
  const dist = opt("dist", join(root, "dist"));
  const only = opt("only", "");
  const shard = opt("shard", "");
  let selected = BEHAVIOUR_SCRIPTS;
  if (shard) {
    const [i, n] = shard.split("/").map(Number);
    if (!(i >= 1 && i <= n)) throw new Error(`--shard must be i/n with 1 <= i <= n, got ${shard}`);
    selected = shardOf(BEHAVIOUR_SCRIPTS, config.seconds ?? {}, i, n);
    console.log(`shard ${shard}: ${selected.join(", ")}`);
  }
  const failed = [];
  const trackedFailures = [];
  for (const name of selected.filter((script) => !only || script === only)) {
    console.log(`\n=== ${name}`);
    const started = Date.now();
    const result = spawnSync(process.execPath, [join(root, "scripts", `${name}.mjs`), "--dist", dist, ...(BEHAVIOUR_ARGS[name] ?? [])], {
      cwd: root,
      stdio: "inherit",
    });
    const seconds = Math.round((Date.now() - started) / 1000);
    if (result.status === 0) console.log(`--- ${name}: passed (${seconds}s)`);
    else {
      console.log(`--- ${name}: FAILED (exit ${result.status ?? result.signal}, ${seconds}s)`);
      if (TRACKED[name]) {
        console.log(`::warning::${name} failed but is tracked: ${TRACKED[name]}`);
        trackedFailures.push(name);
      } else failed.push(name);
    }
  }
  if (failed.length) {
    console.error(`\n${failed.length} behaviour script(s) failed: ${failed.join(", ")}`);
    process.exit(1);
  }
  if (trackedFailures.length) console.log(`\nTracked failures (not blocking): ${trackedFailures.join(", ")}`);
  console.log("\nAll blocking web behaviour scripts passed");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
