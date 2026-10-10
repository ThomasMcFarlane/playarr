#!/usr/bin/env node
// Board auto-sync: when a PR lands on main, write tasks.d/ fragments that flip the rows naming it.
//
//   board-sync.mjs --pr <n> --date <YYYY-MM-DD> [--open <n,n,...>] [--merged <n,n,...>] [repo-root]
//
// A row is flipped when its Status is `in_review`, or `in_progress` with Notes saying the work waits on a PR
// ("PR open", "folded into #n", "#n open"), and its Notes (or Task) name the merged PR. Rows are read from
// the pending fragment when one exists (it is newer than TASKS.md), otherwise from TASKS.md.
//   - every PR the Notes name is merged (or this one)  -> Status `done`, Notes end "PR #n merged <date>."
//   - another PR the Notes name is still open          -> Status `in_progress`, Notes end "PR #n merged; #a, #b open."
// The result is a fragment, never an edit of TASKS.md: the merge train folds it like any other. Prints the
// row numbers it wrote, one per line, and writes nothing when no row matches.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalCells, formatRow, stripEpicNumber } from './lib/board.mjs';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i < 0 ? undefined : argv[i + 1]; };
const flagValues = new Set(['--pr', '--date', '--open', '--merged']);
const root = path.resolve(argv.find((a, i) => !a.startsWith('--') && !flagValues.has(argv[i - 1])) ?? '.');
const pr = String(opt('pr') ?? '').replace(/\D/g, '');
const date = opt('date');
const list = (v) => new Set(String(v ?? '').split(/[,\s]+/).map((x) => x.replace(/\D/g, '')).filter(Boolean));
const open = list(opt('open'));
const merged = list(opt('merged'));
if (!pr || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) { console.error('usage: board-sync.mjs --pr <n> --date <YYYY-MM-DD> [--open n,n] [--merged n,n] [root]'); process.exit(2); }
merged.add(pr);
open.delete(pr);

const refs = (s) => [...s.matchAll(/(?:#|\bPRs?\s+)(\d+)((?:\s*(?:,|and|to)\s*#?\d+)*)/gi)].flatMap((m) => [m[1], ...[...m[2].matchAll(/\d+/g)].map((x) => x[0])]);
const names = (text) => refs(text).includes(pr);
const waiting = (status, notes) => status === 'in_review' || (status === 'in_progress' && /\bPR open\b|\bfolded into #|#\d+ open\b|\bPRs? \d+[^.;]*\bopen\b/i.test(notes));

const frags = new Map();
const tdir = path.join(root, 'tasks.d');
if (fs.existsSync(tdir)) {
  for (const f of fs.readdirSync(tdir)) {
    if (!f.endsWith('.md') || f.toLowerCase() === 'readme.md') continue;
    const lines = fs.readFileSync(path.join(tdir, f), 'utf8').split('\n').filter(Boolean);
    const section = lines[0]?.startsWith('section:') || lines[0]?.startsWith('section-new:') ? lines.shift() : null;
    for (const row of lines.filter((l) => l.startsWith('|'))) {
      const n = /^\|\s*(\d+)\s*\|/.exec(row)?.[1];
      if (n) frags.set(n, { f, section, row, file: path.join(tdir, f) });
    }
  }
}
const boardRows = new Map();
const boardFile = path.join(root, 'TASKS.md');
if (fs.existsSync(boardFile)) {
  let sec = '';
  for (const l of fs.readFileSync(boardFile, 'utf8').split('\n')) {
    if (l.startsWith('## ')) sec = stripEpicNumber(l.slice(3));
    const n = /^\|\s*(\d+)\s*\|/.exec(l)?.[1];
    if (n && !sec.startsWith('Completed work')) boardRows.set(n, l);
  }
}

const out = [];
for (const n of new Set([...boardRows.keys(), ...frags.keys()])) {
  const fr = frags.get(n);
  const row = fr ? fr.row : boardRows.get(n);
  const c = canonicalCells(row);
  if (!c) continue;
  const [, task, status, , , , , notes] = c;
  if (!waiting(status, notes)) continue;
  if (!(refs(notes).includes(pr) || (!refs(notes).length && names(task)))) continue;
  const others = [...new Set(refs(notes))].filter((x) => x !== pr && !merged.has(x));
  const stillOpen = others.filter((x) => open.has(x));
  const add = stillOpen.length ? `PR #${pr} merged; ${stillOpen.map((x) => `#${x}`).join(', ')} open.` : `PR #${pr} merged ${date}.`;
  c[2] = stillOpen.length ? 'in_progress' : 'done';
  c[7] = `${notes}${notes ? ' ' : ''}${add}`;
  fs.mkdirSync(tdir, { recursive: true });
  if (fr) fs.writeFileSync(fr.file, fs.readFileSync(fr.file, 'utf8').replace(fr.row, () => formatRow(c)));
  else fs.writeFileSync(path.join(tdir, `${n}.md`), `${formatRow(c)}\n`);
  out.push(n);
}
if (out.length) console.log(out.join('\n'));
