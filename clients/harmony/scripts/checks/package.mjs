// Check 5 -- package contents (brief section 7.1).
//
// Walks the shippable tree (everything that isn't a build artefact or a
// dependency cache) and rejects two categories of accident:
//   1. files whose *suffix alone* should never ship (signing material,
//      secrets, databases, already-packaged artefacts);
//   2. text files whose *content* looks like a leaked secret -- a raw
//      private key, a hard-coded access/refresh token, a bearer JWT, or a
//      RFC1918 private-network host baked into an http(s):// URL.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { walkFiles } from '../lib/walk.mjs';

const EXCLUDE_DIRS = ['build', 'oh_modules', 'node_modules', '.hvigor', '.git'];

const DISALLOWED_SUFFIXES = new Set([
  '.p12',
  '.cer',
  '.p7b',
  '.key',
  '.pem',
  '.env',
  '.db',
  '.hap',
  '.app',
  '.har',
]);

// Extensions that are legitimately binary in this project: content-scanning
// them for text patterns is both pointless and liable to false-positive on
// coincidental byte sequences, so they are suffix-checked but not grepped.
const BINARY_CONTENT_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.zip',
  '.gz',
  '.tar',
  '.7z',
  '.pdf',
  '.mp4',
  '.mp3',
  '.wav',
  '.mov',
  '.m4a',
  '.ogg',
  '.flac',
]);

const PRIVATE_KEY_PATTERN = /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/;
const TOKEN_LITERAL_PATTERN = /(?:access|refresh)[_-]?token\s*[:=]\s*['"]?[A-Za-z0-9_-]{24,}/i;
const BEARER_JWT_PATTERN = /Bearer ey[A-Za-z0-9_-]{10,}/;
const RFC1918_HOST_PATTERN = /https?:\/\/(?:192\.168|10\.|172\.(?:1[6-9]|2\d|3[01]))/;

export function checkPackageContents(harmonyDir) {
  const errors = [];

  const files = walkFiles(harmonyDir, { include: [/.*/], exclude: EXCLUDE_DIRS });

  for (const filePath of files) {
    const rel = path.relative(harmonyDir, filePath).split(path.sep).join('/');
    const ext = path.extname(filePath).toLowerCase();

    if (DISALLOWED_SUFFIXES.has(ext)) {
      errors.push(`${rel}: disallowed file suffix '${ext}' must never ship in the package`);
      continue;
    }

    if (BINARY_CONTENT_EXTENSIONS.has(ext)) {
      continue;
    }

    let text;
    try {
      text = readFileSync(filePath, 'utf8');
    } catch {
      continue; // unreadable as text -- nothing to grep
    }
    // An extension we didn't recognise as binary but that decodes with a
    // NUL byte is actually binary content; skip content-scanning it too.
    if (text.indexOf('\u0000') !== -1) {
      continue;
    }

    if (PRIVATE_KEY_PATTERN.test(text)) {
      errors.push(`${rel}: contains a private-key header`);
    }
    if (TOKEN_LITERAL_PATTERN.test(text)) {
      errors.push(`${rel}: contains what looks like a hard-coded access/refresh token literal`);
    }
    if (BEARER_JWT_PATTERN.test(text)) {
      errors.push(`${rel}: contains what looks like a hard-coded bearer JWT`);
    }
    if (RFC1918_HOST_PATTERN.test(text)) {
      errors.push(`${rel}: contains an RFC1918 private-network host literal in a URL`);
    }
  }

  return { ok: errors.length === 0, errors };
}
