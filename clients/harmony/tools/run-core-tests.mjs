#!/usr/bin/env node
// tools/run-core-tests.mjs
//
// Harmony client offline validation, Tier 0b (`just harmony-test`, brief
// section 7.2). Type-checks and transpiles every plain-TypeScript file
// under entry/src/main/ets/core/ plus every entry/src/test/**/*.test.ts
// unit test with this package's own pinned `typescript`, then runs the
// compiled tests under `node --test`. No ArkUI, no @kit./@ohos. imports and
// no HarmonyOS SDK are involved anywhere in this path -- see brief 7.4 for
// what Tier 0b deliberately does NOT attempt to cover.
//
// -----------------------------------------------------------------------
// Three notes on deliberate deviations from the one-line tool description:
//
// 1. package-lock.json is hand-written, not `npm install`-generated -- this
//    sandbox has no npm registry access. Its shape (lockfileVersion 3, one
//    root manifest entry, one `node_modules/<pkg>` entry per dependency) is
//    real and should let `npm ci --prefix tools` run to completion
//    syntactically, but the `integrity` hashes are well-formed placeholders,
//    not verified registry checksums. CI is what actually resolves this
//    lockfile against the real npm registry (regenerating or validating
//    those hashes for real); treat this repo's copy as scaffolding, not as
//    proof the pinned versions are byte-for-byte what CI will fetch.
//
// 2. `@types/node` is present alongside the pinned `typescript` devDependency
//    even though it isn't spelled out by name in the brief's one-line Tier 0b
//    description. It is not optional: every entry/src/test/*.test.ts file
//    imports `node:test` and `node:assert`/`node:assert/strict`, and at
//    least one of them (Jwt.test.ts) leans on `assert.ok(claims)`'s real
//    `asserts` control-flow signature to narrow `AccessTokenClaims | null`
//    down to `AccessTokenClaims` for the lines that follow. Without
//    `@types/node`, `ts.createProgram` cannot resolve those imports at all
//    (`TS2307: Cannot find module 'node:test'`) -- every single test file
//    would fail to type-check, and the narrowing above silently stops
//    working even where the import error is tolerated. Skipping it would
//    defeat the entire point of using `ts.createProgram` (real type
//    checking) instead of `ts.transpileModule` (skips it). Pinned exactly,
//    matching this monorepo's `clients/tv-web` catalog version.
//
// 3. `node --test` is invoked with an explicit, pre-computed list of
//    compiled `*.test.js` paths, not a single bare `<tempDir>` argument.
//    Empirically (this workstation's Node), passing a directory as the sole
//    positional argument to `--test` makes Node try to `require()` that
//    path as a single module rather than recursively discovering test files
//    under it, which throws MODULE_NOT_FOUND. Running `node --test` with no
//    path argument from inside the directory *does* fall back to Node's
//    default recursive discovery glob -- but pinning the exact file list
//    computed from the same walk that fed the compiler is more explicit
//    about exactly what ran, and doesn't depend on Node's default test-file
//    naming patterns matching every future file we add here.
// -----------------------------------------------------------------------

import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));

let ts;
try {
  ({ default: ts } = await import("typescript"));
} catch (err) {
  console.error(
    'run-core-tests: could not load the "typescript" package from tools/node_modules.'
  );
  console.error("Run `npm ci --prefix tools` (or `npm install --prefix tools`) first.");
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
}

const projectRoot = path.resolve(toolsDir, "..");
const srcRoot = path.join(projectRoot, "entry", "src");
const coreDir = path.join(srcRoot, "main", "ets", "core");
const testDir = path.join(srcRoot, "test");

/** Recursively collects file paths under `dir` whose basename satisfies `matches`. */
function walk(dir, matches) {
  const out = [];
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, matches));
    } else if (matches(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const coreFiles = walk(coreDir, (name) => name.endsWith(".ts")).sort();
const testFiles = walk(testDir, (name) => name.endsWith(".test.ts")).sort();

if (coreFiles.length === 0) {
  console.error(
    `run-core-tests: found zero .ts files under ${coreDir} -- refusing to report a false pass.`
  );
  process.exit(1);
}
if (testFiles.length === 0) {
  console.error(
    `run-core-tests: found zero .test.ts files under ${testDir} -- refusing to report a false pass.`
  );
  process.exit(1);
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "harmony-core-tests-"));
// Compiled output has no ancestor package.json of its own; pin the module
// format explicitly so Node's CommonJS/ESM auto-detection can never be
// swayed by whatever happens to sit above os.tmpdir() on a given machine.
fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "commonjs" }) + "\n");

const compilerOptions = {
  // The four options the tool is specified against:
  target: ts.ScriptTarget.ES2021,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  outDir,
  // Supplementary options needed to make the above actually work here:
  rootDir: srcRoot, // keeps main/ets/core/** and test/** paths under outDir predictable
  typeRoots: [path.join(toolsDir, "node_modules", "@types")], // core/ and test/ live outside tools/,
  // so automatic @types discovery (which only walks *upward* from each source
  // file) would never find tools/node_modules/@types on its own.
  types: ["node"],
  skipLibCheck: true, // don't re-typecheck @types/node's own .d.ts files, only ours against them
  noEmitOnError: true,
};

const allFiles = [...coreFiles, ...testFiles];
const program = ts.createProgram(allFiles, compilerOptions);
const preEmitDiagnostics = ts.getPreEmitDiagnostics(program);

function reportDiagnosticsAndExit(diagnostics) {
  const host = ts.createCompilerHost(compilerOptions);
  const useColor = process.stderr.isTTY === true;
  const formatted = useColor
    ? ts.formatDiagnosticsWithColorAndContext(diagnostics, host)
    : ts.formatDiagnostics(diagnostics, host);
  console.error(formatted);
  console.error(
    `run-core-tests: TypeScript compilation failed with ${diagnostics.length} error(s) -- ` +
      "see the offending file(s) and line(s) above. Fix the type error(s) before re-running."
  );
  process.exit(1);
}

if (preEmitDiagnostics.length > 0) {
  reportDiagnosticsAndExit(preEmitDiagnostics);
}

const emitResult = program.emit();
if (emitResult.diagnostics.length > 0) {
  reportDiagnosticsAndExit(emitResult.diagnostics);
}

console.log(
  `Compiled ${coreFiles.length} core source file(s) and ${testFiles.length} test file(s) ` +
    `with TypeScript ${ts.version} -- running under node --test.`
);

const compiledTestFiles = testFiles.map((file) => {
  const relative = path.relative(srcRoot, file).replace(/\.ts$/, ".js");
  return path.join(outDir, relative);
});

const missing = compiledTestFiles.filter((file) => !fs.existsSync(file));
if (missing.length > 0) {
  console.error(
    "run-core-tests: tsc reported a clean emit but the following compiled test file(s) are missing:"
  );
  for (const file of missing) {
    console.error(`  ${file}`);
  }
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...compiledTestFiles], {
  stdio: "inherit",
});

if (result.error) {
  console.error(`run-core-tests: failed to spawn \`node --test\`: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
