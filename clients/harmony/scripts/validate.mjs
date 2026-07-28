#!/usr/bin/env node
// Tier 0 offline validator (brief section 7.1, "just harmony-validate").
//
// Runs seven structural/contract checks against the Harmony client source
// tree with zero runtime dependencies -- no Huawei SDK, no npm install, no
// network access, seconds not minutes. On the first failing check, prints
// "validation failed: <message>" to stderr and exits 1. Once every check
// passes, prints "Validated 7 Harmony client checks" to stdout and exits 0.
//
//   Check 1 -- manifest shape and cross-references      checks/manifests.mjs
//   Check 2 -- resource-reference integrity              checks/resources.mjs
//   Check 3 -- page and route integrity                  checks/manifests.mjs
//   Check 4 -- ArkTS restriction lint + layer rules       checks/arkts.mjs
//   Check 5 -- package contents                           checks/package.mjs
//   Check 6 -- source contract                            checks/contract.mjs
//   Check 7 -- repo hygiene                                (inline, below)

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkManifests } from './checks/manifests.mjs';
import { checkResources } from './checks/resources.mjs';
import { checkArkTs } from './checks/arkts.mjs';
import { checkPackageContents } from './checks/package.mjs';
import { checkContract } from './checks/contract.mjs';
import { walkFiles } from './lib/walk.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const harmonyDir = process.argv[2] || path.resolve(__dirname, '..');

function fail(message) {
  console.error(`validation failed: ${message}`);
  process.exit(1);
}

function printWarnings(name, warnings) {
  if (!Array.isArray(warnings)) return;
  for (const warning of warnings) {
    console.error(`note [${name}]: ${warning}`);
  }
}

function runCheck(name, fn) {
  let result;
  try {
    result = fn();
  } catch (err) {
    fail(`${name} threw an unexpected error -- ${err.message}`);
    return;
  }
  printWarnings(name, result.warnings);
  if (!result.ok) {
    const firstError = Array.isArray(result.errors) && result.errors.length > 0 ? result.errors[0] : 'failed';
    fail(`[${name}] ${firstError}`);
  }
}

// Check 7 -- repo hygiene: no untracked-but-unignored oddities under
// clients/harmony/, and every scripts/**/*.mjs file is syntactically valid
// standalone Node ESM.
function checkRepoHygiene() {
  const errors = [];

  let lsFilesOutput = '';
  try {
    lsFilesOutput = execFileSync('git', ['ls-files', '-ci', '--exclude-standard'], {
      cwd: harmonyDir,
      encoding: 'utf8',
    });
  } catch (err) {
    errors.push(`'git ls-files -ci --exclude-standard' failed to run -- ${err.message}`);
  }
  const oddities = lsFilesOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (oddities.length > 0) {
    errors.push(
      `untracked-but-unignored files present under clients/harmony/ (tracked yet gitignore-matched): ${oddities.join(', ')}`
    );
  }

  const scriptFiles = walkFiles(__dirname, { include: [/\.mjs$/i], exclude: ['node_modules'] });
  for (const filePath of scriptFiles) {
    try {
      execFileSync(process.execPath, ['--check', filePath], { cwd: harmonyDir, stdio: 'pipe' });
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString('utf8') : err.message;
      errors.push(`'node --check' failed for ${path.relative(harmonyDir, filePath)} -- ${stderr.trim()}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

runCheck('Check 1/3 manifests', () => checkManifests(harmonyDir));
runCheck('Check 2 resources', () => checkResources(harmonyDir));
runCheck('Check 4 arkts', () => checkArkTs(harmonyDir));
runCheck('Check 5 package', () => checkPackageContents(harmonyDir));
runCheck('Check 6 contract', () => checkContract(harmonyDir));
runCheck('Check 7 repo hygiene', () => checkRepoHygiene());

console.log('Validated 7 Harmony client checks');
