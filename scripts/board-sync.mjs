#!/usr/bin/env node
// Board auto-sync: when a PR lands on main, write tasks.d/ fragments that flip the rows naming it.
//
//   board-sync.mjs --pr <n> --date <YYYY-MM-DD> [--open <n,n,...>] [--merged <n,n,...>] [repo-root]
//
// A row is flipped when its status is a "PR is on its way" status ("PR open", "in review",
// "in progress: PR ...", "in progress: folded into #n", "in progress: #n open") and names the merged PR, or
// says only "PR open" / "in review" while the row text (task or notes) names it. Rows are read from the
// pending fragment when one exists (it is newer than TASKS.md), otherwise from TASKS.md.
//   - every PR the status names is merged (or this one)  -> "done (PR #n merged <date>)"
//   - another PR the status names is still open           -> "in progress: #n merged; #a, #b open"
// The result is a fragment, never an edit of TASKS.md: the merge train folds it like any other. Prints the
// row numbers it wrote, one per line, and writes nothing when no row matches.
import fs from 'node:fs';
import path from 'node:path';

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
const waiting = (status) => /\bPR open\b|^in review\b|^in progress:\s*(PR\b|fix PR\b|PR open|folded into #|.*\bopen\b)/i.test(status);
const generic = (status) => !refs(status).length;

const frags = new Map();
const tdir = path.join(root, 'tasks.d');
if (fs.existsSync(tdir)) {
  for (const f of fs.readdirSync(tdir)) {
    if (!f.endsWith('.md') || f.toLowerCase() === 'readme.md') continue;
    const lines = fs.readFileSync(path.join(tdir, f), 'utf8').split('\n').filter(Boolean);
    const section = lines[0]?.startsWith('section:') ? lines.shift() : null;
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
    if (l.startsWith('## ')) sec = l.slice(3).trim();
    const n = /^\|\s*(\d+)\s*\|/.exec(l)?.[1];
    if (n && sec !== 'Completed work') boardRows.set(n, l);
  }
}

const out = [];
for (const n of new Set([...boardRows.keys(), ...frags.keys()])) {
  const fr = frags.get(n);
  const row = fr ? fr.row : boardRows.get(n);
  const c = row.split(' | ');
  if (c.length < 5) continue;
  const status = c[2];
  if (/^done\b|^dropped\b/i.test(status) || !waiting(status)) continue;
  if (!(refs(status).includes(pr) || (generic(status) && names(`${c[1]} ${c.slice(4).join(' | ')}`)))) continue;
  const others = [...new Set(refs(status))].filter((x) => x !== pr && !merged.has(x));
  const stillOpen = others.filter((x) => open.has(x));
  c[2] = stillOpen.length
    ? `in progress: #${pr} merged; ${stillOpen.map((x) => `#${x}`).join(', ')} open`
    : `done (PR #${pr} merged ${date})`;
  fs.mkdirSync(tdir, { recursive: true });
  if (fr) fs.writeFileSync(fr.file, fs.readFileSync(fr.file, 'utf8').replace(fr.row, () => c.join(' | ')));
  else fs.writeFileSync(path.join(tdir, `${n}.md`), `${c.join(' | ')}\n`);
  out.push(n);
}
if (out.length) console.log(out.join('\n'));
