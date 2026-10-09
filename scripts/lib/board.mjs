// Shared helpers for the TASKS.md board ("epic tables"): one `## ` heading per epic and one table per
// epic with exactly the header below. Used by fold-fragments.mjs and board-sync.mjs.
export const HEADER = ['ID', 'Task', 'Status', 'Owner', 'Branch', 'Depends', 'ETA', 'Notes'];
export const STATUSES = ['todo', 'in_progress', 'in_review', 'blocked', 'blocked_on_owner', 'parked', 'done'];
export const HEADER_LINE = `| ${HEADER.join(' | ')} |`;
export const SEPARATOR_LINE = `|${HEADER.map(() => '---').join('|')}|`;
export const ETA_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} (?:[A-Z]{2,5}|[+-]\d{2}:\d{2})$/;

// Cells of a table row, trimmed. A literal pipe inside a cell is written `\|`.
export const parseCells = (line) => {
  const t = line.trim();
  if (!t.startsWith('|') || !t.endsWith('|') || t.length < 2) return null;
  return t.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim());
};

// Cells of a row of the former five-column board, which split on " | " and could hold bare pipes.
export const legacyCells = (line) => {
  const t = line.trim();
  if (!t.startsWith('|') || !t.endsWith('|')) return null;
  const c = t.replace(/^\|\s*/, '').replace(/\s*\|$/, '').split(' | ').map((x) => x.trim());
  return c.length === 5 ? c : null;
};
const escapePipes = (s) => s.replace(/(?<!\\)\|/g, '\\|');

// Cells are not padded: one space inside each pipe, a single space for an empty cell.
export const formatRow = (cells) => `|${cells.map((c) => (c ? ` ${c} ` : ' ')).join('|')}|`;

export const isSeparator = (line) => /^\|(?:\s*:?-+:?\s*\|)+\s*$/.test(line.trim());
export const rowId = (line) => /^\|\s*(\d+)\s*\|/.exec(line)?.[1];

// Maps the free-text status of the former five-column board (# | Task | Status | Picked up by | Notes)
// to one of STATUSES.
export const legacyStatus = (status) => {
  const l = status.trim().toLowerCase();
  if (/^(done except|client side done|partly done)/.test(l)) return 'in_progress';
  if (/^root cause fixed.*blocked/.test(l)) return 'blocked';
  if (/^(done|implemented|configured|root cause fixed|dropped|won't fix|won't do|not applicable)\b/.test(l)) return 'done';
  if (/^(paused|parked)\b/.test(l)) return 'parked';
  if (/^blocked on owner/.test(l)) return 'blocked_on_owner';
  if (/^(blocked|on hold)/.test(l)) return 'blocked';
  if (/^in review\b/.test(l) || /\bpr open\b/.test(l)) return 'in_review';
  if (/^in progress/.test(l)) return 'in_progress';
  if (/^(pending|open)\b/.test(l)) return 'todo';
  throw new Error(`unknown legacy status: ${status}`);
};
const PLAIN = new Set(['done', 'pending', 'open', 'blocked', 'blocked on owner', 'in review', 'in progress']);

// A branch is only taken from text that names it explicitly: a backticked branch-like token next to
// the word "branch", or after "done on".
const BRANCH_RE = /(?:\bbranch(?:es)?\s+`|\bdone on\s+`)((?:task|fix|feat|ci|chore|docs|test|refactor)\/[\w./-]+)`/gi;
export const findBranch = (...texts) => {
  const found = new Set(texts.flatMap((t) => [...t.matchAll(BRANCH_RE)].map((m) => m[1])));
  return found.size === 1 ? [...found][0] : '';
};

// Five-column legacy cells -> eight canonical cells. The old status text is kept in Notes unless it was
// a plain word that maps one to one.
export const fromLegacy = (cells) => {
  const [id, task, status, owner, notes] = cells.map(escapePipes);
  const canon = legacyStatus(status);
  let n = notes;
  if (!PLAIN.has(status.trim().toLowerCase())) n = `${n}${n ? ' ' : ''}Previous status: ${status.trim()}.`;
  return [id, task, canon, owner, findBranch(owner, notes, status), '', '', n];
};

// Cells of a fragment or board row in canonical form (accepts the legacy five-column shape).
export const canonicalCells = (line) => {
  const l = legacyCells(line);
  if (l) return fromLegacy(l);
  const c = parseCells(line);
  return c && c.length === 8 ? c : null;
};

// Problems with one canonical row, as strings.
export const rowProblems = (c) => {
  const p = [];
  if (!/^\d+$/.test(c[0]) && !/^[A-Z]+-\d+$/.test(c[0])) p.push(`ID "${c[0]}" is not a number or PREFIX-n`);
  if (!STATUSES.includes(c[2])) p.push(`Status "${c[2]}" is not one of ${STATUSES.join(', ')}`);
  if (c[6] && !ETA_RE.test(c[6])) p.push(`ETA "${c[6]}" is not YYYY-MM-DD HH:MM <timezone>`);
  return p;
};

// ---- ETA instants ------------------------------------------------------------------------------
// Fixed offsets in minutes for the zone abbreviations an ETA may carry (rows may also use +HH:MM).
const ZONE_OFFSETS = { ICT: 420, UTC: 0, GMT: 0, BST: 60, CET: 60, CEST: 120, EST: -300, EDT: -240, PST: -480, PDT: -420, JST: 540, IST: 330, SGT: 480 };

// Milliseconds since the epoch for an ETA string, or null when the zone is unknown.
export const etaInstant = (eta) => {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) (\S+)$/.exec(eta);
  if (!m) return null;
  const z = m[6];
  let off = ZONE_OFFSETS[z];
  const num = /^([+-])(\d{2}):(\d{2})$/.exec(z);
  if (num) off = (num[1] === '-' ? -1 : 1) * (Number(num[2]) * 60 + Number(num[3]));
  if (off === undefined) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - off * 60000;
};

// Open rows (in_progress, in_review) must carry an ETA; the mod computes the epic ETA itself. `parked`
// (owner-paused work) needs no ETA and is excluded from it, like `blocked` and `todo`.
export const OPEN_STATUSES = ['in_progress', 'in_review'];

// For an open row: an error when the ETA is missing or malformed, a warning when it is already past.
export const openRowEta = (c, now = Date.now()) => {
  if (!OPEN_STATUSES.includes(c[2])) return {};
  if (!c[6]) return { error: `${c[2]} row needs an ETA (YYYY-MM-DD HH:MM <timezone>)` };
  if (!ETA_RE.test(c[6])) return {};
  const t = etaInstant(c[6]);
  if (t === null) return { error: `ETA "${c[6]}" has an unknown timezone` };
  if (t < now) return { warning: `ETA ${c[6]} is in the past; update it or move the row out of ${c[2]}` };
  return {};
};

// ---- epic heading resolution -------------------------------------------------------------------
// Fragments written before the epic headings were renamed (#465, #467, #469) still carry the old
// `section:` text. Resolving it against the live headings (instead of creating a heading for anything
// unknown) keeps stale epics from coming back.
export const normaliseSection = (s) => s.replace(/^\s*(?:active|planned):\s*/i, '').replace(/\s+/g, ' ').trim().toLowerCase();

// Old heading (normalised: no "Active: "/"Planned: " prefix, lower case) -> current heading text.
// A value of null rejects the section with the message in REJECTED_SECTIONS.
const SECTION_ALIASES = {
  'server performance, security and relay cut-over (2026-10-03)': 'Server performance and security (2026-10-03)',
  'owner actions (blocked on the owner)': null,
  'games, tv/pvr, playarros and clients hub (2026-09-05): games library': 'Games library',
  'games, tv/pvr, playarros and clients hub (2026-09-05): live tv and pvr': 'Live TV and recording',
  'games, tv/pvr, playarros and clients hub (2026-09-05): playarros': 'PlayarrOS',
  'games, tv/pvr, playarros and clients hub (2026-09-05): clients hub listings (no epic; each epic owns its listing sub-item)': 'Client listings on the clients hub',
  'player audit fixes': 'Player progress and resume (2026-10-07)',
  'player progress data-loss fixes (2026-10-08)': 'Player progress and resume (2026-10-07)',
  'player progress and resume fixes (2026-10-07)': 'Player progress and resume (2026-10-07)',
  'pixel parity campaign': 'Pixel parity campaign (2026-10-07)',
};
const REJECTED_SECTIONS = {
  'owner actions (blocked on the owner)': 'the "Owner actions" epic no longer exists; put the row in the epic it belongs to (for example "Public repository readiness (2026-10-05)" or "Release automation (2026-10-07)")',
};

// Resolves a fragment's `section:` text against the board's `## ` headings. Returns
// { heading } with the current heading text, or { error } with a message for the fragment author.
export function resolveSection(name, headings) {
  const byKey = new Map(headings.map((h) => [normaliseSection(h), h]));
  const key = normaliseSection(name);
  if (byKey.has(key)) return { heading: byKey.get(key) };
  if (key in SECTION_ALIASES) {
    const to = SECTION_ALIASES[key];
    if (to === null) return { error: `section "${name}" is retired: ${REJECTED_SECTIONS[key]}` };
    const h = byKey.get(normaliseSection(to));
    if (h) return { heading: h };
  }
  const list = headings.map((h) => `  - ${h}`).join('\n');
  return { error: `section "${name}" matches no heading on the board (a leading "Active: "/"Planned: " is ignored). Use one of:\n${list}\nTo create a new epic on purpose, use a "section-new: <name>" line instead.` };
}
