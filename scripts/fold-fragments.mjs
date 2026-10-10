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
//   tasks.d/<row-number>.md            optional first line `section: <epic>` (the bare epic name or `N. Name`, as in
//                                      the "## N. Name" heading; required when the row is new; ignored when the row
//                                      exists, which stays in its epic; old names resolve through an alias table, an
//                                      unknown one fails, and `section-new: <name>` is how to create an epic on
//                                      purpose: it takes the highest epic number + 1), then one or more table rows
//                                      `| 330 | Task | todo | owner | branch | depends | ETA | Notes |` (the eight
//                                      canonical columns; the former five-column row is still accepted and
//                                      converted). A row whose number already exists replaces it
//                                      in place; a new row is appended to the end of that section's
//                                      table. Depends hold `<epic>.<task>` references; a bare row ID that is on the
//                                      board is rewritten to its reference when the fragment folds.
//                                      A fragment that updates an existing row must keep its title (normalised word
//                                      overlap >= 0.5), or `--check` fails: a different task reusing the number would
//                                      overwrite an unrelated row. A leading `retitle: true` line allows a deliberate rename.
//                                      Two fragments for one ID with different titles also fail.
//                                      A line `remove: <row-number>` deletes that row from the board
//                                      (a fragment may hold only remove lines; a missing row is an error).
//
// Usage: fold-fragments.mjs [--check] [repo-root]   (--check validates only; writes nothing)
import fs from 'node:fs';
import path from 'node:path';
import { resolveSection, HEADER_LINE, SEPARATOR_LINE, canonicalCells, formatRow, parseCells, isSeparator, rowProblems, openRowEta, parseEpicHeading, stripEpicNumber, nextEpicNumber, epicByRow, normaliseDepends, dependsProblems, normaliseSection, titlesDiffer } from './lib/board.mjs';

const args = process.argv.slice(2);
const check = args.includes('--check');
const root = path.resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const CATS = ['added', 'changed', 'fixed', 'removed', 'security', 'deprecated', 'documentation', 'performance', 'testing'];
const errors = [];
const warnings = [];
// FOLD_NOW (ISO date) overrides the clock for tests.
const now = process.env.FOLD_NOW ? Date.parse(process.env.FOLD_NOW) : Date.now();
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

// Problems with a board in text form: every table has the canonical header, every row eight cells, a valid
// status and ETA, unique IDs, and no padding (two or more spaces next to a pipe).
function checkBoard(text) {
  const out = [];
  const ids = new Set();
  const all = text.split('\n');
  const epics = epicByRow(all);
  const nums = new Map();
  let inTable = false;
  let heading = null;
  all.forEach((l, i) => {
    const at = `line ${i + 1}`;
    if (l.startsWith('## ')) { heading = { text: l.slice(3), at, seen: false }; return; }
    if (!l.startsWith('|')) { inTable = false; return; }
    if (heading && !heading.seen) {
      heading.seen = true;
      const e = parseEpicHeading(heading.text);
      if (!e) out.push(`${heading.at}: epic heading "## ${heading.text}" must be numbered: "## <N>. <Epic name>"`);
      else if (nums.has(e.num)) out.push(`${heading.at}: epic number ${e.num} is used twice (also line ${nums.get(e.num)})`);
      else nums.set(e.num, heading.at.slice(5));
    }
    if (/ {2,}\||\| {2,}/.test(l)) out.push(`${at}: padded cell (two or more spaces next to a pipe)`);
    if (!inTable) {
      inTable = true;
      if (l !== HEADER_LINE) out.push(`${at}: table header must be exactly ${HEADER_LINE}`);
      return;
    }
    if (isSeparator(l)) { if (l !== SEPARATOR_LINE) out.push(`${at}: separator row must be ${SEPARATOR_LINE}`); return; }
    const c = parseCells(l);
    if (!c || c.length !== 8) { out.push(`${at}: row must have eight columns`); return; }
    for (const pr of rowProblems(c)) out.push(`${at}: row ${c[0]}: ${pr}`);
    for (const pr of dependsProblems(c[5], epics)) out.push(`${at}: row ${c[0]}: ${pr}`);
    const e = openRowEta(c, now);
    if (e.error) out.push(`${at}: row ${c[0]}: ${e.error}`);
    if (e.warning) warnings.push(`warning: TASKS.md ${at}: row ${c[0]}: ${e.warning}`);
    if (ids.has(c[0])) out.push(`${at}: duplicate ID ${c[0]}`);
    ids.add(c[0]);
  });
  return out;
}

// ---- tasks -----------------------------------------------------------------------------------
const tkFiles = listFragments('tasks.d');
const tkFrags = [];
for (const f of tkFiles) {
  const lines = fs.readFileSync(path.join(root, 'tasks.d', f), 'utf8').split('\n').map((l) => l.replace(/\s+$/, '')).filter(Boolean);
  let section = null;
  let sectionNew = false;
  let retitle = false;
  // `retitle: true` (leading line) allows this fragment to rename an existing row.
  // `section: <heading>` resolves against the board (see resolveSection); `section-new: <name>` deliberately creates an epic.
  while (lines[0]?.startsWith('section:') || lines[0]?.startsWith('section-new:') || /^retitle:/.test(lines[0] ?? '')) {
    const l = lines.shift();
    if (l.startsWith('retitle:')) { retitle = /^retitle:\s*true$/i.test(l); continue; }
    sectionNew = l.startsWith('section-new:');
    section = l.slice(l.indexOf(':') + 1).trim();
  }
  const removes = lines.filter((l) => /^remove:\s*\d+$/.test(l));
  const rows = lines.filter((l) => l.startsWith('|'));
  if ((!rows.length && !removes.length) || rows.length + removes.length !== lines.length) { err(`tasks.d/${f}: after the optional "section:" line every line must be a table row starting with "|" or "remove: <row-number>"`); continue; }
  for (const r of removes) tkFrags.push({ f, n: r.replace(/\D/g, ''), remove: true });
  for (const r of rows) {
    const n = /^\|\s*(\d+)\s*\|/.exec(r)?.[1];
    let cells = null;
    try { cells = canonicalCells(r); } catch (e) { err(`tasks.d/${f}: ${e.message}`); continue; }
    if (!n) err(`tasks.d/${f}: row must start with "| <number> |": ${r.slice(0, 40)}`);
    else if (!cells) err(`tasks.d/${f}: row ${n} must have the eight columns ${HEADER_LINE}`);
    else {
      for (const pr of rowProblems(cells)) err(`tasks.d/${f}: row ${n}: ${pr}`);
      tkFrags.push({ f, n, section, sectionNew, retitle, row: formatRow(cells), cells });
    }
  }
}

// Applies the task fragments to the board lines (replace in place, append, create a section, remove) and
// returns the new lines. `fail(message)` reports a fragment that cannot apply and the fragment is skipped.
function applyTasks(lines, fail) {
  for (const { f, n, section: wanted, sectionNew, cells, remove } of tkFrags) {
    const idx = lines.findIndex((l) => new RegExp(`^\\|\\s*${n}\\s*\\|`).test(l));
    if (remove) {
      if (idx < 0) { fail(`tasks.d/${f}: cannot remove row ${n}: no such row`); continue; }
      lines.splice(idx, 1);
      continue;
    }
    // Bare row IDs in Depends become `<epic>.<task>` references (fragments written before the numbered epics).
    const epics = epicByRow(lines);
    const row = formatRow([cells[0], cells[1], cells[2], cells[3], cells[4], normaliseDepends(cells[5], epics), cells[6], cells[7]]);
    // An existing row stays in its current epic: its `section:` line is ignored.
    if (idx >= 0) { lines[idx] = row; continue; }
    if (!wanted) { fail(`tasks.d/${f}: row ${n} is new, so the fragment needs a "section:" line`); continue; }
    const nameOnly = stripEpicNumber(wanted);
    let section = nameOnly;
    if (sectionNew) {
      const heads = lines.filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
      const have = heads.find((h) => normaliseSection(h) === normaliseSection(nameOnly));
      section = have ?? `${nextEpicNumber(lines)}. ${nameOnly}`;
    } else {
      const r = resolveSection(wanted, lines.filter((l) => l.startsWith('## ')).map((l) => l.slice(3)));
      if (r.error) { fail(`tasks.d/${f}: row ${n}: ${r.error}`, true); continue; }
      section = r.heading;
    }
    const h = lines.findIndex((l) => l.replace(/^##\s+/, '') === section && l.startsWith('## '));
    if (h < 0) {
      const first = lines.findIndex((l) => l.startsWith('## '));
      lines.splice(first, 0, `## ${section}`, '', HEADER_LINE, SEPARATOR_LINE, row, '');
      continue;
    }
    let end = lines.findIndex((l, i) => i > h && l.startsWith('## '));
    if (end < 0) end = lines.length;
    let last = -1;
    for (let i = h + 1; i < end; i++) if (lines[i].startsWith('|')) last = i;
    if (last < 0) lines.splice(h + 1, 0, '', HEADER_LINE, SEPARATOR_LINE, row);
    else lines.splice(last + 1, 0, row);
  }
  return lines;
}

// Board hygiene, enforced when validating (not when the train folds):
//  - a fragment whose status is `in_review` must name its PR number (`#123` or `PR 123`) in Notes, or the
//    board cannot flip the row when that PR lands (scripts/board-sync.mjs);
//  - an in_progress or in_review row (fragment or board) must have a valid ETA; a past ETA only warns
//    (it must not fail CI as time passes);
//  - TASKS.md itself must be in the canonical format (header, statuses, ETA, unpadded cells);
//  - a row that is not on the board yet needs a "section:" line.
if (check) {
  const boardFile = path.join(root, 'TASKS.md');
  const onBoard = new Set(fs.existsSync(boardFile) ? [...fs.readFileSync(boardFile, 'utf8').matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) => m[1]) : []);
  const boardTitles = new Map();
  if (fs.existsSync(boardFile)) for (const l of fs.readFileSync(boardFile, 'utf8').split('\n')) { const c = l.startsWith('|') ? parseCells(l) : null; if (c && /^\d+$/.test(c[0])) boardTitles.set(c[0], c[1]); }
  const pendingTitles = new Map();
  for (const fr of tkFrags) {
    if (fr.remove) continue;
    const hint = 'Is this a different task reusing the number? Use a new number, or add `retitle: true` to the fragment to rename deliberately.';
    const old = boardTitles.get(fr.n);
    if (old !== undefined && !fr.retitle && titlesDiffer(fr.cells[1], old)) err(`tasks.d/${fr.f}: row ${fr.n} title mismatch: fragment '${fr.cells[1]}' vs board '${old}'. ${hint}`);
    const earlier = pendingTitles.get(fr.n);
    if (earlier && !fr.retitle && titlesDiffer(fr.cells[1], earlier.title)) err(`tasks.d/${fr.f}: row ${fr.n} title mismatch: fragment '${fr.cells[1]}' vs pending fragment tasks.d/${earlier.f} '${earlier.title}'. Two fragments target the same ID. ${hint}`);
    if (!earlier) pendingTitles.set(fr.n, { f: fr.f, title: fr.cells[1] });
    const e = openRowEta(fr.cells, now);
    if (e.error) err(`tasks.d/${fr.f}: row ${fr.n}: ${e.error}`);
    if (e.warning) warnings.push(`warning: tasks.d/${fr.f}: row ${fr.n}: ${e.warning}`);
    if (fr.cells[2] === 'in_review' && !/(#|PR\s+)\d+/.test(fr.cells[7])) err(`tasks.d/${fr.f}: status is in_review but Notes name no PR number (write "PR open: #123")`);
    const bareDeps = fr.cells[5].split(',').map((t) => t.trim()).filter((t) => /^(?:\d+|[A-Z]+-\d+)$/.test(t));
    if (bareDeps.length) {
      const epics = fs.existsSync(boardFile) ? epicByRow(fs.readFileSync(boardFile, 'utf8').split('\n')) : new Map();
      for (const t of bareDeps) if (epics.has(t)) warnings.push(`warning: tasks.d/${fr.f}: row ${fr.n}: Depends "${t}" is a bare ID; write ${epics.get(t)}.${t} (the fold rewrites it)`);
    }
    if (!fr.section && !onBoard.has(fr.n)) err(`tasks.d/${fr.f}: row ${fr.n} is not on the board, so the fragment needs a "section:" line`);
  }
  // The board as it will be once the fragments fold, so a fragment may fix a row the current board gets wrong.
  if (fs.existsSync(boardFile)) {
    const folded = applyTasks(fs.readFileSync(boardFile, 'utf8').split('\n'), (m, isSection) => { if (isSection) err(m); }).filter((l) => !/^ETA: /.test(l));
    for (const m of checkBoard(folded.join('\n'))) err(`TASKS.md${tkFrags.length ? ' (after fold)' : ''}: ${m}`);
  }
}

if (warnings.length) console.error(warnings.join('\n'));
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
  const lines = applyTasks(fs.readFileSync(p, 'utf8').split('\n'), (m) => { console.error(m); process.exit(1); });
  // One-off cleanup: drop the per-epic `ETA:` lines an earlier fold wrote under the headings (the board mod computes the epic ETA).
  fs.writeFileSync(p, lines.filter((l) => !/^ETA: /.test(l)).join('\n'));
}

for (const f of clFiles) fs.unlinkSync(path.join(root, 'changelog.d', f));
for (const f of tkFiles) fs.unlinkSync(path.join(root, 'tasks.d', f));
console.log(`folded ${clFrags.length} changelog and ${tkFrags.length} task fragment row(s)`);
