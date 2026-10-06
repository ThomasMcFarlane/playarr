// Check 4 -- ArkTS restriction lint, plus the layer-architecture rules from
// brief section 3.1 (files under core/ are pure .ts, no cross-layer
// leakage, and a handful of literals are pinned to exactly one file).
//
// There is no ArkTS/TypeScript parser available offline, so the lint half
// of this check is a best-effort LEXICAL scan, exactly as brief section 7.1
// frames it ("Lexical scan over every .ets/.ts ... rejecting: ..."). Source
// text is first masked -- comment bodies and string/template-literal
// *content* replaced with same-length whitespace, every delimiter and all
// real code (including a template literal's `${...}` interpolation) left
// untouched -- so a banned lexeme that only happens to appear inside a
// string literal or a comment can never trigger a false positive. Two
// rules (`@ts-ignore` / `@ts-nocheck`) are the deliberate exception: their
// entire point is to ban a *comment* form, so those two scan the RAW,
// unmasked text instead. The same is true of the "this literal may appear
// only in file X" architectural pins below -- those pin real string/import
// content, so they also scan raw text.
//
// This is necessarily heuristic rather than a full parse (e.g. `A & B`
// intersection-type detection cannot perfectly distinguish a type position
// from an object-literal value using regex alone) -- see inline notes on
// the specific rules where the ambiguity is real.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { walkFiles } from '../lib/walk.mjs';

const EXCLUDE_DIRS = ['build', 'oh_modules', 'node_modules', '.hvigor', '.git'];
const SOURCE_INCLUDE = [/\.(ets|ts)$/i];

// Only these two subtrees are ever compiled by the ArkTS compiler:
//   - entry/src/main/ets      the shipped app source
//   - entry/src/ohosTest/ets  on-device Hypium instrumentation tests
// entry/src/test/**  is deliberately plain, Linux-runnable TypeScript (see
// brief section 7.2 / 2.7) transpiled by plain `tsc` and run under
// `node --test` -- it is NEVER compiled by the ArkTS compiler, and its
// tests legitimately need full TypeScript (e.g. Endpoints.test.ts asserts
// against the literal "/api/..." path strings by design, and
// Object.prototype.hasOwnProperty.call(...) is ordinary safe-property-check
// idiom in plain test code). Likewise hvigorfile.ts / entry/hvigorfile.ts
// are Node-executed build-tool config, not ArkTS. None of those belong in
// this check's scope.
const ARKTS_SOURCE_ROOTS = ['entry/src/main/ets', 'entry/src/ohosTest/ets'];

function toPosixRelative(harmonyDir, filePath) {
  return path.relative(harmonyDir, filePath).split(path.sep).join('/');
}

function collectArkTsSourceFiles(harmonyDir) {
  const files = [];
  for (const root of ARKTS_SOURCE_ROOTS) {
    const rootPath = path.join(harmonyDir, root);
    try {
      files.push(...walkFiles(rootPath, { include: SOURCE_INCLUDE, exclude: EXCLUDE_DIRS }));
    } catch {
      // Root doesn't exist yet in this slice -- nothing to scan there.
    }
  }
  return files.sort();
}

function lineColAt(text, index) {
  let line = 1;
  let col = 1;
  const upto = Math.min(index, text.length);
  for (let i = 0; i < upto; i++) {
    if (text[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

/**
 * Mask comment bodies and string/template-literal *content* to same-length
 * whitespace (preserving newlines for accurate line numbers), leaving every
 * delimiter and all real code -- including `${...}` template-expression
 * code -- untouched.
 */
function maskSource(text) {
  const n = text.length;
  const out = new Array(n);
  let i = 0;

  function blank(from, to) {
    for (let j = from; j < to; j++) {
      out[j] = text[j] === '\n' ? '\n' : ' ';
    }
  }

  while (i < n) {
    const ch = text[i];
    const next = i + 1 < n ? text[i + 1] : '';

    if (ch === '/' && next === '/') {
      const start = i;
      while (i < n && text[i] !== '\n') i++;
      blank(start, i);
      continue;
    }

    if (ch === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i = Math.min(i + 2, n);
      blank(start, i);
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      out[i] = ch;
      i++;
      const contentStart = i;
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        if (text[i] === '\n') break; // unterminated -- bail out of the string
        i++;
      }
      blank(contentStart, i);
      if (i < n && text[i] === quote) {
        out[i] = quote;
        i++;
      }
      continue;
    }

    if (ch === '`') {
      out[i] = '`';
      i++;
      let contentStart = i;
      let closed = false;
      while (i < n) {
        if (text[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        if (text[i] === '`') {
          blank(contentStart, i);
          out[i] = '`';
          i++;
          closed = true;
          break;
        }
        if (text[i] === '$' && i + 1 < n && text[i + 1] === '{') {
          blank(contentStart, i);
          out[i] = '$';
          out[i + 1] = '{';
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') depth--;
            if (depth === 0) {
              out[i] = '}';
              i++;
              break;
            }
            out[i] = text[i]; // live code inside ${...} -- never masked
            i++;
          }
          contentStart = i;
          continue;
        }
        i++;
      }
      if (!closed) {
        blank(contentStart, i);
      }
      continue;
    }

    out[i] = ch;
    i++;
  }

  return out.join('');
}

/**
 * Blank ONLY comment bodies to same-length whitespace; string/template
 * literal content is left completely untouched (unlike `maskSource`).
 *
 * The "literal X may appear only in file Y" architectural pins need this
 * inverse of `maskSource`: their entire point is to catch the literal
 * showing up as real CODE (typically a string literal restating a path or
 * header name instead of importing the one true constant/function), while
 * still ignoring the same words used in ordinary documentation prose (every
 * repository/DTO file's docstring legitimately references endpoint paths
 * like "POST /api/v1/oauth/token" purely as documentation). String
 * literals still need to be walked over (not blanked) so that e.g. a
 * "//" inside "https://" is never mistaken for a line-comment start.
 */
function maskCommentsOnly(text) {
  const n = text.length;
  const out = new Array(n);
  let i = 0;

  function blank(from, to) {
    for (let j = from; j < to; j++) {
      out[j] = text[j] === '\n' ? '\n' : ' ';
    }
  }
  function copy(from, to) {
    for (let j = from; j < to; j++) out[j] = text[j];
  }

  while (i < n) {
    const ch = text[i];
    const next = i + 1 < n ? text[i + 1] : '';

    if (ch === '/' && next === '/') {
      const start = i;
      while (i < n && text[i] !== '\n') i++;
      blank(start, i);
      continue;
    }

    if (ch === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i = Math.min(i + 2, n);
      blank(start, i);
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        if (text[i] === '\n') break;
        i++;
      }
      if (i < n && text[i] === quote) i++;
      copy(start, i);
      continue;
    }

    if (ch === '`') {
      const start = i;
      i++;
      while (i < n) {
        if (text[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        if (text[i] === '`') {
          i++;
          break;
        }
        i++;
      }
      copy(start, i);
      continue;
    }

    out[i] = ch;
    i++;
  }

  return out.join('');
}

function computeDepthAtIndex(masked) {
  const depths = new Array(masked.length + 1);
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    depths[i] = depth;
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}') depth = Math.max(0, depth - 1);
  }
  depths[masked.length] = depth;
  return depths;
}

function findAll(masked, regex) {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const re = new RegExp(regex.source, flags);
  const hits = [];
  let m;
  while ((m = re.exec(masked)) !== null) {
    hits.push(m.index);
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return hits;
}

// Each rule matches against the MASKED source. `regex` may be given without
// the 'g' flag -- findAll adds it.
const SIMPLE_BAN_RULES = [
  { message: "'any'/'unknown' type annotation", regex: /:\s*(?:any|unknown)\b/ },
  { message: "'as any'/'as unknown' cast", regex: /\bas\s+(?:any|unknown)\b/ },
  {
    message: 'index signature ([k: string]:)',
    regex: /\[\s*[A-Za-z_$][\w$]*\s*:\s*(?:string|number|symbol)\s*\]\s*:/,
  },
  {
    message: "bracket property access (obj['field'])",
    regex: /[\w$)\]]\s*\[\s*(['"])[^'"]*\1\s*\]/,
  },
  // Heuristic: `A & B` right after a type-alias `=` or a `:` annotation.
  // Cannot be fully precise without a parser -- a colon also introduces
  // object-literal values, where `a & b` is ordinary bitwise-AND, not an
  // intersection type. Kept deliberately narrow (token immediately
  // followed by `&` then another token, nothing else) to minimise that risk.
  {
    message: 'intersection type (A & B)',
    regex: /\btype\s+[A-Za-z_$][\w$]*\s*=\s*[\w$.<>[\]]+(?:\s*&\s*[\w$.<>[\]]+)+/,
  },
  { message: 'intersection type (A & B)', regex: /:\s*[\w$.<>[\]]+(?:\s*&\s*[\w$.<>[\]]+)+/ },
  {
    message: 'conditional type (X extends Y ? A : B)',
    regex: /:\s*[\w$.<>[\]]+\s+extends\s+[\w$.<>[\]]+\s*\?[^:;{}\n]*:/,
  },
  {
    message: "'typeof' in type position",
    regex: /(?::\s*typeof\b)|(?:\btype\s+[A-Za-z_$][\w$]*\s*=\s*typeof\b)/,
  },
  { message: "'this' used as a type", regex: /:\s*this\b(?!\.)/ },
  { message: "'as const'", regex: /\bas\s+const\b/ },
  {
    message: '<T>x angle-bracket cast syntax',
    regex: /(?:^|[=(,;:!&|?\n])\s*<[A-Za-z_$][\w$]*>(?=[\w$(])/,
  },
  { message: 'for...in loop', regex: /\bfor\s*\(\s*(?:const|let|var)?\s*[\w$]+\s+in\s+/ },
  { message: "'in' operator", regex: /\bin\b/ },
  { message: "'delete' operator", regex: /\bdelete\b/ },
  {
    message: 'destructuring declaration',
    regex: /\b(?:const|let|var)\s*(?:\{[^};]*\}|\[[^\];]*\])\s*=/,
  },
  {
    message: 'destructuring assignment',
    regex: /(?:^|[;{(,]\s*)(?:\{[^};]*\}|\[[^\];]*\])\s*=(?!=)/,
  },
  { message: 'Symbol(...)', regex: /\bSymbol\s*\(/ },
  { message: '#private field', regex: /#[A-Za-z_$][\w$]*/ },
  { message: 'globalThis', regex: /\bglobalThis\b/ },
  { message: 'new.target', regex: /\bnew\.target\b/ },
  { message: 'with statement', regex: /\bwith\s*\(/ },
  { message: 'anonymous function expression', regex: /\bfunction\s*\(/ },
  { message: "generator function ('function*')", regex: /\bfunction\s*\*/ },
  { message: '.call(/.apply(/.bind(', regex: /\.(?:call|apply|bind)\s*\(/ },
  { message: 'typed catch clause', regex: /\bcatch\s*\(\s*[A-Za-z_$][\w$]*\s*:/ },
  { message: 'import x = require(...)', regex: /\bimport\s+[\w$]+\s*=\s*require\s*\(/ },
  { message: 'export =', regex: /\bexport\s*=/ },
  { message: 'optional chaining (?./?[/?()', regex: /\?\.(?!\d)|\?\[|\?\(/ },
];

function runLexicalBans(harmonyDir, errors) {
  const files = collectArkTsSourceFiles(harmonyDir);

  for (const filePath of files) {
    const rel = toPosixRelative(harmonyDir, filePath);
    const raw = readFileSync(filePath, 'utf8');

    // @ts-ignore / @ts-nocheck exist only as comment directives, so this
    // must scan the RAW text -- the masked text has erased comment content.
    if (raw.includes('@ts-ignore') || raw.includes('@ts-nocheck')) {
      errors.push(`${rel}: '@ts-ignore'/'@ts-nocheck' suppression comments are banned`);
    }

    const masked = maskSource(raw);

    for (const rule of SIMPLE_BAN_RULES) {
      for (const index of findAll(masked, rule.regex)) {
        const { line, col } = lineColAt(masked, index);
        errors.push(`${rel}:${line}:${col}: banned ArkTS construct -- ${rule.message}`);
      }
    }

    // Nested function declarations: a NAMED `function foo(` occurring at a
    // brace depth greater than zero (i.e. inside some enclosing block).
    // Top-level exported functions (depth 0), which core/*.ts relies on
    // throughout, are unaffected.
    const depths = computeDepthAtIndex(masked);
    const namedFnPattern = /\bfunction\s+[A-Za-z_$][\w$]*\s*\(/g;
    let m;
    while ((m = namedFnPattern.exec(masked)) !== null) {
      if (depths[m.index] > 0) {
        const { line, col } = lineColAt(masked, m.index);
        errors.push(`${rel}:${line}:${col}: banned ArkTS construct -- nested function declaration`);
      }
    }
  }
}

// -- Architectural rules (brief section 3.1) ---------------------------------

function checkCoreLayerPurity(harmonyDir, errors) {
  const coreDir = path.join(harmonyDir, 'entry/src/main/ets/core');
  let coreFiles;
  try {
    coreFiles = walkFiles(coreDir, { include: [/.*/], exclude: EXCLUDE_DIRS });
  } catch {
    return; // core/ doesn't exist yet in this slice
  }

  for (const filePath of coreFiles) {
    const rel = toPosixRelative(harmonyDir, filePath);

    if (!filePath.endsWith('.ts')) {
      errors.push(`${rel}: files under ets/core/ must be .ts (found a non-.ts file)`);
      continue;
    }

    // Scan the MASKED text -- every core/*.ts file's own header comment
    // documents this exact rule in prose ("No ArkUI, no @kit./@ohos.
    // imports...", "...must not contain @Component/@Entry/@State/build()"),
    // which would otherwise trip these checks on the very comments
    // explaining them. Real code violations (an actual import, an actual
    // decorator) survive masking untouched; only comment/string content is
    // blanked.
    const raw = readFileSync(filePath, 'utf8');
    const masked = maskSource(raw);
    if (masked.includes('@kit.') || masked.includes('@ohos.')) {
      errors.push(`${rel}: core/ must not import '@kit.*' or '@ohos.*'`);
    }
    if (/(?:from|import)\s+['"][^'"]*\.ets['"]/.test(masked)) {
      errors.push(`${rel}: core/ must not import a '.ets' file`);
    }
    for (const marker of ['@Component', '@Entry', '@State', 'build()']) {
      if (masked.includes(marker)) {
        errors.push(`${rel}: core/ must not contain the ArkUI construct '${marker}'`);
      }
    }
  }
}

// A literal that may only ever appear in one (or a short, explicit allow-
// list of) file(s) as real CODE. Scans the comment-masked (but
// string-preserving) text across the ArkTS-compiled source, so a
// docstring that merely *mentions* the same path/header/platform name for
// documentation purposes (extremely common across data/, net/, auth/
// docstrings) is never a false positive, while an actual restated string
// literal elsewhere still is.
function checkLiteralOnlyIn(harmonyDir, errors, { substring, caseInsensitive, allowedRelPaths, label }) {
  const files = collectArkTsSourceFiles(harmonyDir);
  const needle = caseInsensitive ? substring.toLowerCase() : substring;
  const allowed = new Set(allowedRelPaths);

  for (const filePath of files) {
    const rel = toPosixRelative(harmonyDir, filePath);
    if (allowed.has(rel)) continue;
    const raw = readFileSync(filePath, 'utf8');
    const commentMasked = maskCommentsOnly(raw);
    const haystack = caseInsensitive ? commentMasked.toLowerCase() : commentMasked;
    if (haystack.includes(needle)) {
      errors.push(`${rel}: literal '${label}' must appear only in ${[...allowed].join(' or ')}`);
    }
  }
}

function checkPagesIsolation(harmonyDir, errors) {
  const pagesDir = path.join(harmonyDir, 'entry/src/main/ets/pages');
  let pageFiles;
  try {
    pageFiles = walkFiles(pagesDir, { include: [/\.ets$/i], exclude: EXCLUDE_DIRS });
  } catch {
    return; // pages/ doesn't exist yet in this slice
  }

  const importPattern = /(?:from|import)\s+['"][^'"]*\/(?:net|auth)\/[^'"]*['"]/;
  for (const filePath of pageFiles) {
    const rel = toPosixRelative(harmonyDir, filePath);
    const text = readFileSync(filePath, 'utf8');
    if (importPattern.test(text)) {
      errors.push(`${rel}: pages/*.ets must not import from 'net/' or 'auth/' directly (go through data/)`);
    }
  }
}

export function checkArkTs(harmonyDir) {
  const errors = [];

  runLexicalBans(harmonyDir, errors);
  checkCoreLayerPurity(harmonyDir, errors);

  checkLiteralOnlyIn(harmonyDir, errors, {
    substring: '/api/',
    allowedRelPaths: ['entry/src/main/ets/core/Endpoints.ts'],
    label: '/api/',
  });
  checkLiteralOnlyIn(harmonyDir, errors, {
    substring: 'x-playarr-client-',
    caseInsensitive: true,
    allowedRelPaths: ['entry/src/main/ets/core/Headers.ts'],
    label: 'x-playarr-client-',
  });
  // core/DeviceProfile.ts is a documented, deliberate second home for the
  // two clientPlatform wire names (see its own file-header comment): it is
  // the pure/testable resolver that both AppConfig.ts and the unit tests
  // call into, and importing AppConfig.ts from there would be circular.
  checkLiteralOnlyIn(harmonyDir, errors, {
    substring: 'harmony-tv',
    allowedRelPaths: ['entry/src/main/ets/core/AppConfig.ts', 'entry/src/main/ets/core/DeviceProfile.ts'],
    label: 'harmony-tv',
  });
  checkLiteralOnlyIn(harmonyDir, errors, {
    substring: 'harmony-mobile',
    allowedRelPaths: ['entry/src/main/ets/core/AppConfig.ts', 'entry/src/main/ets/core/DeviceProfile.ts'],
    label: 'harmony-mobile',
  });

  checkPagesIsolation(harmonyDir, errors);

  return { ok: errors.length === 0, errors };
}
