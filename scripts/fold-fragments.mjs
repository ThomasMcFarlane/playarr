#!/usr/bin/env node
// Folds per-PR fragment files into CHANGELOG.md and TASKS.md, then deletes them.
//
// Why: every PR used to edit the same top-of-file lines of CHANGELOG.md and TASKS.md, so almost
// every pair of PRs conflicted. PRs now add small, uniquely named fragment files instead and the
// merge train runs this script on the PR branch (after merging main, before CI), so the folded
// result is validated by CI and lands in the same commit.
//
//   changelog.d/<slug>.<category>.md   bullets ("- ...") appended to `### <Category>` under
//                                      `## [Unreleased]`. Categories: added changed fixed removed
//                                      security deprecated documentation performance testing.
//   tasks.d/<row-number>.md            optional first line `section: <heading text of a "## " section>`
//                                      (required when the row is new), then one or more table rows
//                                      `| 330 | ... |`. A row whose number already exists replaces it
//                                      in place; a new row is appended to the end of that section's
//                                      table (the section is created at the top if missing).
//                                      A line `remove: <row-number>` deletes that row from the board
//                                      (a fragment may hold only remove lines; a missing row is an error).
//
// Usage: fold-fragments.mjs [--check] [repo-root]   (--check validates only; writes nothing)
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const check = args.includes('--check');
const root = path.resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const CATS = ['added', 'changed', 'fixed', 'removed', 'security', 'deprecated', 'documentation', 'performance', 'testing'];
const errors = [];
const err = (m) => errors.push(m);

const listFragments = (dir) => {
  const d = path.join(root, dir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();
};

// ---- changelog -------------------------------------------------------------------------------
const clFiles = listFragments('changelog.d');
const clFrags = [];
for (const f of clFiles) {
  const m = /^(.+)\.([a-z]+)\.md$/.exec(f);
  if (!m || !CATS.includes(m[2])) { err(`changelog.d/${f}: name must be <slug>.<category>.md with category in ${CATS.join(', ')}`); continue; }
  const body = fs.readFileSync(path.join(root, 'changelog.d', f), 'utf8').replace(/\s+$/, '');
  if (!body) { err(`changelog.d/${f}: empty`); continue; }
  if (!body.split('\n').some((l) => l.startsWith('- '))) { err(`changelog.d/${f}: must contain at least one "- " bullet`); continue; }
  if (/^(<<<<<<<|>>>>>>>)/m.test(body)) { err(`changelog.d/${f}: conflict markers`); continue; }
  clFrags.push({ f, cat: m[2], body });
}

// ---- tasks -----------------------------------------------------------------------------------
const tkFiles = listFragments('tasks.d');
const tkFrags = [];
for (const f of tkFiles) {
  const lines = fs.readFileSync(path.join(root, 'tasks.d', f), 'utf8').split('\n').map((l) => l.replace(/\s+$/, '')).filter(Boolean);
  let section = null;
  if (lines[0]?.startsWith('section:')) section = lines.shift().slice(8).trim();
  const removes = lines.filter((l) => /^remove:\s*\d+$/.test(l));
  const rows = lines.filter((l) => l.startsWith('|'));
  if ((!rows.length && !removes.length) || rows.length + removes.length !== lines.length) { err(`tasks.d/${f}: after the optional "section:" line every line must be a table row starting with "|" or "remove: <row-number>"`); continue; }
  for (const r of removes) tkFrags.push({ f, n: r.replace(/\D/g, ''), remove: true });
  for (const r of rows) {
    const n = /^\|\s*(\d+)\s*\|/.exec(r)?.[1];
    if (!n) err(`tasks.d/${f}: row must start with "| <number> |": ${r.slice(0, 40)}`);
    else tkFrags.push({ f, n, section, row: r });
  }
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
if (check) { console.log(`ok: ${clFrags.length} changelog and ${tkFrags.length} task fragment row(s)`); process.exit(0); }
if (!clFrags.length && !tkFrags.length) { console.log('no fragments'); process.exit(0); }

// ---- apply: changelog ------------------------------------------------------------------------
if (clFrags.length) {
  const p = path.join(root, 'CHANGELOG.md');
  let lines = fs.readFileSync(p, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^## \[Unreleased\]/.test(l));
  if (start < 0) throw new Error('CHANGELOG.md has no Unreleased section');
  const cap = (c) => c[0].toUpperCase() + c.slice(1);
  // Later fragments end up above earlier ones inside a category; iterate in reverse for stable order.
  for (const { cat, body } of [...clFrags].reverse()) {
    let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
    if (end < 0) end = lines.length;
    let h = lines.findIndex((l, i) => i > start && i < end && l.trim() === `### ${cap(cat)}`);
    if (h < 0) { lines.splice(start + 1, 0, '', `### ${cap(cat)}`, ''); h = start + 2; }
    lines.splice(h + 2, 0, ...body.split('\n'));
  }
  fs.writeFileSync(p, lines.join('\n'));
}

// ---- apply: tasks ----------------------------------------------------------------------------
if (tkFrags.length) {
  const p = path.join(root, 'TASKS.md');
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  for (const { f, n, section, row, remove } of tkFrags) {
    const idx = lines.findIndex((l) => new RegExp(`^\\|\\s*${n}\\s*\\|`).test(l));
    if (remove) {
      if (idx < 0) { console.error(`tasks.d/${f}: cannot remove row ${n}: no such row`); process.exit(1); }
      lines.splice(idx, 1);
      continue;
    }
    if (idx >= 0) { lines[idx] = row; continue; }
    if (!section) { console.error(`tasks.d/${f}: row ${n} is new, so the fragment needs a "section:" line`); process.exit(1); }
    const h = lines.findIndex((l) => l.replace(/^##\s+/, '') === section && l.startsWith('## '));
    if (h < 0) {
      const first = lines.findIndex((l) => l.startsWith('## '));
      lines.splice(first, 0, `## ${section}`, '', '| # | Task | Status | Picked up by | Notes |', '|---|------|--------|--------------|-------|', row, '');
      continue;
    }
    let end = lines.findIndex((l, i) => i > h && l.startsWith('## '));
    if (end < 0) end = lines.length;
    let last = -1;
    for (let i = h + 1; i < end; i++) if (lines[i].startsWith('|')) last = i;
    if (last < 0) lines.splice(h + 1, 0, '', '| # | Task | Status | Picked up by | Notes |', '|---|------|--------|--------------|-------|', row);
    else lines.splice(last + 1, 0, row);
  }
  fs.writeFileSync(p, lines.join('\n'));
}

for (const f of clFiles) fs.unlinkSync(path.join(root, 'changelog.d', f));
for (const f of tkFiles) fs.unlinkSync(path.join(root, 'tasks.d', f));
console.log(`folded ${clFrags.length} changelog and ${tkFrags.length} task fragment row(s)`);
