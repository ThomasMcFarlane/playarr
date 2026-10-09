// Shared helpers for the TASKS.md board ("epic tables"): one `## ` heading per epic and one table per
// epic with exactly the header below. Used by fold-fragments.mjs and board-sync.mjs.
export const HEADER = ['ID', 'Task', 'Status', 'Owner', 'Branch', 'Depends', 'ETA', 'Notes'];
export const STATUSES = ['todo', 'in_progress', 'in_review', 'blocked', 'blocked_on_owner', 'done'];
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
  if (/^blocked on owner/.test(l) || /^paused/.test(l)) return 'blocked_on_owner';
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
