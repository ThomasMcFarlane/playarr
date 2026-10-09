import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const script = path.join(path.dirname(new URL(import.meta.url).pathname), 'fold-fragments.mjs');
const board = `# Tasks

## Active

| ID | Task | Status | Owner | Branch | Depends | ETA | Notes |
|---|---|---|---|---|---|---|---|
| 1 | One | todo | | | | | a |
| 2 | Two | todo | | | | | b |
`;

const run = (fragments, extra = []) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-'));
  fs.mkdirSync(path.join(root, 'tasks.d'));
  fs.writeFileSync(path.join(root, 'TASKS.md'), board);
  for (const [name, body] of Object.entries(fragments)) fs.writeFileSync(path.join(root, 'tasks.d', name), body);
  const r = spawnSync('node', [script, ...extra, root], { encoding: 'utf8' });
  return { r, root, tasks: fs.readFileSync(path.join(root, 'TASKS.md'), 'utf8') };
};

test('remove fragment deletes the row and the fragment', () => {
  const { r, root, tasks } = run({ '1.md': 'remove: 1\n' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!/^\| 1 \|/m.test(tasks));
  assert.ok(/^\| 2 \|/m.test(tasks));
  assert.ok(!fs.existsSync(path.join(root, 'tasks.d', '1.md')));
});

test('removing an unknown row fails', () => {
  assert.notEqual(run({ '9.md': 'remove: 9\n' }).r.status, 0);
});

test('--check accepts remove lines and rejects junk', () => {
  assert.equal(run({ '1.md': 'remove: 1\n' }, ['--check']).r.status, 0);
  assert.notEqual(run({ '1.md': 'remove 1\n' }, ['--check']).r.status, 0);
});

const H = '| ID | Task | Status | Owner | Branch | Depends | ETA | Notes |';

test('a canonical fragment replaces its row in place and a new row creates an epic table', () => {
  const { r, tasks } = run({
    '1.md': '| 1 | One | in_progress | agent | feat/one | | 2026-10-10 14:00 ICT | a |\n',
    '3.md': 'section-new: Fresh epic\n| 3 | Three | todo | | | 1 | | c |\n',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(tasks, /^\| 1 \| One \| in_progress \| agent \| feat\/one \| \| 2026-10-10 14:00 ICT \| a \|$/m);
  assert.match(tasks, new RegExp(`## Fresh epic\\n\\n${H.replace(/[|]/g, '\\$&')}\\n\\|---\\|---\\|---\\|---\\|---\\|---\\|---\\|---\\|\\n\\| 3 \\| Three \\| todo \\| \\| \\| 1 \\| \\| c \\|`));
});

test('a five-column fragment is converted, keeping the old status in Notes', () => {
  const { r, tasks } = run({ '1.md': '| 1 | One | on hold (native) | - | a |\n' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(tasks, /^\| 1 \| One \| blocked \| - \| \| \| \| a Previous status: on hold \(native\)\. \|$/m);
});

test('--check validates the board itself', () => {
  const bad = (text) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-'));
    fs.writeFileSync(path.join(root, 'TASKS.md'), text);
    return spawnSync('node', [script, '--check', root], { encoding: 'utf8' });
  };
  assert.equal(bad(board).status, 0);
  assert.notEqual(bad(board.replace('| ID | Task', '| # | Task')).status, 0);
  assert.notEqual(bad(board.replace('| todo |', '| pending |')).status, 0);
  assert.notEqual(bad(board.replace('| One | todo |', '|  One  | todo |')).status, 0);
  assert.notEqual(bad(`${board}| 2 | Dup | todo | | | | | x |\n`).status, 0);
});

test('fold does not write epic ETA lines under headings', () => {
  const { r, tasks } = run({ '1.md': '| 1 | One | in_progress | agent | | | 2026-10-10 14:00 ICT | a |\n' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!/^ETA: /m.test(tasks));
  assert.match(tasks, /## Active\n\n\| ID/);
});

test('fold drops legacy epic ETA lines left under headings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-'));
  fs.mkdirSync(path.join(root, 'tasks.d'));
  fs.writeFileSync(path.join(root, 'TASKS.md'), board.replace('## Active\n', '## Active\nETA: 2026-10-10 05:00 ICT (2026-10-09 23:00 BST) (2 open)\n'));
  fs.writeFileSync(path.join(root, 'tasks.d', '1.md'), '| 1 | One | todo | | | | | a |\n');
  assert.equal(spawnSync('node', [script, root], { encoding: 'utf8' }).status, 0);
  assert.ok(!/^ETA: /m.test(fs.readFileSync(path.join(root, 'TASKS.md'), 'utf8')));
});

test('--check: open rows need a valid ETA; a past ETA only warns', () => {
  const frag = (status, eta, notes = 'a') => ({ '1.md': `| 1 | One | ${status} | agent | | | ${eta} | ${notes} |\n` });
  const chk = (f, now = '2026-10-10T00:00:00Z') => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-'));
    fs.mkdirSync(path.join(root, 'tasks.d'));
    fs.writeFileSync(path.join(root, 'TASKS.md'), board);
    for (const [n, b] of Object.entries(f)) fs.writeFileSync(path.join(root, 'tasks.d', n), b);
    return spawnSync('node', [script, '--check', root], { encoding: 'utf8', env: { ...process.env, FOLD_NOW: now } });
  };
  // missing ETA fails
  assert.notEqual(chk(frag('in_progress', ' ')).status, 0);
  assert.notEqual(chk(frag('in_review', ' ', 'PR open: #5')).status, 0);
  // valid future ETA passes without warning
  let r = chk(frag('in_progress', '2026-10-10 14:00 ICT'));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!/warning/.test(r.stderr));
  // past ETA warns, exit 0
  r = chk(frag('in_progress', '2026-10-09 14:00 ICT'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /warning: .*row 1: ETA 2026-10-09 14:00 ICT is in the past/);
  // other statuses need no ETA
  assert.equal(chk(frag('todo', ' ')).status, 0);
  assert.equal(chk(frag('done', ' ')).status, 0);
  assert.equal(chk(frag('parked', ' ', 'Parked by owner 2026-10-09: hold; resumes when web is done')).status, 0);
});

test('--check applies the ETA rule to the board itself', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-'));
  const check = (text) => {
    fs.writeFileSync(path.join(root, 'TASKS.md'), text);
    return spawnSync('node', [script, '--check', root], { encoding: 'utf8', env: { ...process.env, FOLD_NOW: '2026-10-10T00:00:00Z' } });
  };
  assert.notEqual(check(board.replace('| 1 | One | todo |', '| 1 | One | in_progress |')).status, 0);
  const past = check(board.replace('| 1 | One | todo | | | | |', '| 1 | One | in_progress | a | | | 2026-10-09 01:00 ICT |'));
  assert.equal(past.status, 0, past.stderr);
  assert.match(past.stderr, /warning: TASKS\.md line \d+: row 1: ETA .* in the past/);
});

test('--check judges the board as it will be after the fragments fold', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-'));
  fs.mkdirSync(path.join(root, 'tasks.d'));
  fs.writeFileSync(path.join(root, 'TASKS.md'), board.replace('| 1 | One | todo |', '| 1 | One | in_progress |'));
  const check = () => spawnSync('node', [script, '--check', root], { encoding: 'utf8', env: { ...process.env, FOLD_NOW: '2026-10-10T00:00:00Z' } });
  assert.notEqual(check().status, 0);
  fs.writeFileSync(path.join(root, 'tasks.d', '1.md'), '| 1 | One | todo | | | | | a |\n');
  assert.equal(check().status, 0, check().stderr);
});

const section = (name, n = 3) => `section: ${name}\n| ${n} | Three | todo | | | | | c |\n`;
const rowIn = (tasks, heading, n) => {
  const part = tasks.split(/^## /m).find((p) => p.startsWith(`${heading}\n`));
  return part ? new RegExp(`^\\| ${n} \\|`, 'm').test(part) : false;
};

test('an existing row ignores its section line and stays in its epic', () => {
  const { r, tasks } = run({ '1.md': 'section: Totally unknown\n| 1 | One v2 | todo | | | | | a |\n' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(rowIn(tasks, 'Active', 1));
  assert.ok(!/Totally unknown/.test(tasks));
  assert.equal(run({ '1.md': 'section: Totally unknown\n| 1 | One v2 | todo | | | | | a |\n' }, ['--check']).r.status, 0);
});

test('a new row resolves Active:/Planned: prefixes and case', () => {
  for (const name of ['Active: Active', 'planned: active', 'ACTIVE']) {
    const { r, tasks } = run({ '3.md': section(name) });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(rowIn(tasks, 'Active', 3), name);
    assert.equal((tasks.match(/^## /gm) ?? []).length, 1);
  }
});

const boardWith = (headings) => `# Tasks\n\n${headings.map((h) => `## ${h}\n\n${H}\n|---|---|---|---|---|---|---|---|\n`).join('\n')}`;
const runOn = (text, fragments, extra = []) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-'));
  fs.mkdirSync(path.join(root, 'tasks.d'));
  fs.writeFileSync(path.join(root, 'TASKS.md'), text);
  for (const [name, body] of Object.entries(fragments)) fs.writeFileSync(path.join(root, 'tasks.d', name), body);
  const r = spawnSync('node', [script, ...extra, root], { encoding: 'utf8' });
  return { r, tasks: fs.readFileSync(path.join(root, 'TASKS.md'), 'utf8') };
};

test('renamed and merged headings resolve through the alias table', () => {
  const cases = [
    ['Active: Server performance, security and relay cut-over (2026-10-03)', 'Server performance and security (2026-10-03)'],
    ['Planned: Games, TV/PVR, PlayarrOS and clients hub (2026-09-05): Games Library', 'Games library'],
    ['Planned: Games, TV/PVR, PlayarrOS and clients hub (2026-09-05): Live TV and PVR', 'Live TV and recording'],
    ['Planned: Games, TV/PVR, PlayarrOS and clients hub (2026-09-05): PlayarrOS', 'PlayarrOS'],
    ['Planned: Games, TV/PVR, PlayarrOS and clients hub (2026-09-05): Clients hub listings (no epic; each epic owns its listing sub-item)', 'Client listings on the clients hub'],
    ['Player audit fixes', 'Player progress and resume (2026-10-07)'],
    ['Active: player progress data-loss fixes (2026-10-08)', 'Player progress and resume (2026-10-07)'],
    ['Active: Player progress and resume fixes (2026-10-07)', 'Player progress and resume (2026-10-07)'],
    ['Pixel parity campaign', 'Pixel parity campaign (2026-10-07)'],
  ];
  const targets = [...new Set(cases.map((c) => c[1]))];
  for (const [old, now] of cases) {
    const { r, tasks } = runOn(boardWith(targets), { '3.md': section(old) });
    assert.equal(r.status, 0, `${old}: ${r.stderr}`);
    assert.ok(rowIn(tasks, now, 3), old);
    assert.equal((tasks.match(/^## /gm) ?? []).length, targets.length, old);
  }
});

test('the retired Owner actions epic is rejected with a message', () => {
  const { r } = runOn(boardWith(['Release automation (2026-10-07)']), { '3.md': section('Active: Owner actions (blocked on the owner)') }, ['--check']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Owner actions.*retired/);
});

test('--check fails on an unknown section, lists headings and creates nothing; fold also fails', () => {
  const text = boardWith(['Alpha epic', 'Beta epic']);
  const c = runOn(text, { '3.md': section('Gamma epic') }, ['--check']);
  assert.notEqual(c.r.status, 0);
  assert.match(c.r.stderr, /matches no heading/);
  assert.match(c.r.stderr, /- Alpha epic/);
  assert.match(c.r.stderr, /- Beta epic/);
  assert.match(c.r.stderr, /section-new/);
  const f = runOn(text, { '3.md': section('Gamma epic') });
  assert.notEqual(f.r.status, 0);
  assert.equal(f.tasks, text);
});

test('section-new creates a heading on purpose and --check accepts it', () => {
  const text = boardWith(['Alpha epic']);
  const frag = { '3.md': 'section-new: Gamma epic\n| 3 | Three | todo | | | | | c |\n' };
  assert.equal(runOn(text, frag, ['--check']).r.status, 0);
  const { r, tasks } = runOn(text, frag);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(rowIn(tasks, 'Gamma epic', 3));
});
