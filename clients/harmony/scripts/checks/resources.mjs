// Check 2 -- resource-reference integrity (brief section 7.1).
//
// The highest-value offline check, because a bad resource reference only
// fails at *runtime* on a real device, never at compile time. This module
// builds the merged resource tree (AppScope/resources + the entry module's
// resources -- there is only ever one module, "entry") and then scans every
// .ets/.ts/.json5 file for the four ways ArkTS code references a resource:
//
//   - the shorthand form  $string:name / $color:name / $media:name / ...
//   - the explicit form   $r('app.type.name')
//   - raw files           $rawfile('relative/path')
//
// and asserts each resolves against that merged tree. Resources that exist
// but are never referenced anywhere are reported back as non-fatal
// `warnings` (dead weight in the shipped HAP), never as `errors`.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { walkFiles } from '../lib/walk.mjs';

const EXCLUDE_DIRS = ['build', 'oh_modules', 'node_modules', '.hvigor', '.git'];

// The element/*.json filename (without extension) IS the resource kind, and
// also the JSON top-level array key holding {name, value} entries.
const ELEMENT_KINDS = new Set([
  'string',
  'color',
  'float',
  'boolean',
  'integer',
  'plural',
  'strarray',
  'intarray',
]);

const REFERENCE_KINDS = new Set([...ELEMENT_KINDS, 'media', 'profile']);

function toPosixRelative(harmonyDir, filePath) {
  return path.relative(harmonyDir, filePath).split(path.sep).join('/');
}

function addEntry(map, name, filePath) {
  if (!map.has(name)) {
    map.set(name, []);
  }
  map.get(name).push(filePath);
}

/**
 * Walk every file living anywhere under a `resources/` directory (in
 * AppScope or the entry module -- there is only one module) and bucket it
 * into the merged resource tree by (qualifier, category) inferred from its
 * own path, exactly like the real HarmonyOS resource resolver does: a name
 * defined under ANY qualifier folder (base, dark, ...) resolves.
 *
 * `rawfile` is special: unlike element/media/profile, files under it sit
 * directly under `resources/rawfile/...` with no qualifier folder in
 * between, and its "name" is the path *relative to that rawfile root*
 * (matching how `$rawfile('images/foo.png')` addresses it), not a bare
 * basename.
 */
export function collectResourceTree(harmonyDir) {
  const tree = {
    string: new Map(),
    color: new Map(),
    float: new Map(),
    boolean: new Map(),
    integer: new Map(),
    plural: new Map(),
    strarray: new Map(),
    intarray: new Map(),
    media: new Map(),
    profile: new Map(),
    rawfile: new Map(),
  };

  const resourceFiles = walkFiles(harmonyDir, {
    include: [/[/\\]resources[/\\]/],
    exclude: EXCLUDE_DIRS,
  });

  for (const filePath of resourceFiles) {
    const parts = filePath.split(path.sep);
    const resourcesIdx = parts.lastIndexOf('resources');
    if (resourcesIdx === -1 || resourcesIdx + 1 >= parts.length) {
      continue;
    }
    const afterResources = parts.slice(resourcesIdx + 1);
    const basename = path.basename(filePath);
    if (basename.startsWith('.')) {
      continue; // e.g. rawfile/.gitkeep -- not a real resource
    }

    let category;
    let restParts;
    if (afterResources[0] === 'rawfile') {
      category = 'rawfile';
      restParts = afterResources.slice(1);
    } else if (afterResources.length >= 2) {
      category = afterResources[1];
      restParts = afterResources.slice(2);
    } else {
      continue;
    }

    if (category === 'rawfile') {
      if (restParts.length === 0) continue;
      addEntry(tree.rawfile, restParts.join('/'), filePath);
      continue;
    }

    if (category === 'media' || category === 'profile') {
      if (restParts.length === 0) continue;
      const extname = path.extname(basename);
      const nameNoExt = basename.slice(0, basename.length - extname.length);
      addEntry(tree[category], nameNoExt, filePath);
      continue;
    }

    if (category === 'element') {
      const extname = path.extname(basename);
      if (extname !== '.json') continue;
      const kind = basename.slice(0, basename.length - extname.length);
      if (!ELEMENT_KINDS.has(kind)) continue;
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(filePath, 'utf8'));
      } catch (err) {
        throw new Error(`checkResources: failed to parse '${filePath}': ${err.message}`);
      }
      const arr = parsed[kind];
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        if (entry && typeof entry.name === 'string') {
          addEntry(tree[kind], entry.name, filePath);
        }
      }
      continue;
    }
    // Unknown resource category (e.g. layout/, graphic/ if ever added) --
    // not one of the reference forms this validator understands; ignore.
  }

  return tree;
}

const SHORTHAND_PATTERN =
  /\$(string|color|media|float|boolean|profile|integer|plural|strarray|intarray):([A-Za-z0-9_]+)/g;
const R_PATTERN = /\$r\(\s*(['"])app\.(\w+)\.(\w+)\1\s*\)/g;
const RAWFILE_PATTERN = /\$rawfile\(\s*(['"])([^'"]+)\1\s*\)/g;

function scanReferences(harmonyDir) {
  const files = walkFiles(harmonyDir, {
    include: [/\.(ets|ts|json5)$/i],
    exclude: EXCLUDE_DIRS,
  });

  const refs = [];
  for (const filePath of files) {
    const text = readFileSync(filePath, 'utf8');

    let m;
    SHORTHAND_PATTERN.lastIndex = 0;
    while ((m = SHORTHAND_PATTERN.exec(text)) !== null) {
      refs.push({ kind: m[1], name: m[2], filePath });
    }
    R_PATTERN.lastIndex = 0;
    while ((m = R_PATTERN.exec(text)) !== null) {
      refs.push({ kind: m[2], name: m[3], filePath });
    }
    RAWFILE_PATTERN.lastIndex = 0;
    while ((m = RAWFILE_PATTERN.exec(text)) !== null) {
      refs.push({ kind: 'rawfile', name: m[2], filePath });
    }
  }
  return refs;
}

export function checkResources(harmonyDir) {
  const errors = [];
  const warnings = [];

  const tree = collectResourceTree(harmonyDir);
  const refs = scanReferences(harmonyDir);
  const referenced = new Set();

  for (const ref of refs) {
    const rel = toPosixRelative(harmonyDir, ref.filePath);
    referenced.add(`${ref.kind}:${ref.name}`);

    if (!REFERENCE_KINDS.has(ref.kind) && ref.kind !== 'rawfile') {
      errors.push(`${rel}: unknown resource reference kind '$${ref.kind}:${ref.name}'`);
      continue;
    }
    const map = tree[ref.kind];
    if (!map || !map.has(ref.name)) {
      const form = ref.kind === 'rawfile' ? `$rawfile('${ref.name}')` : `$${ref.kind}:${ref.name}`;
      errors.push(`${rel}: ${form} does not resolve against any known resource`);
    }
  }

  for (const kind of Object.keys(tree)) {
    for (const [name, definedIn] of tree[kind].entries()) {
      if (!referenced.has(`${kind}:${name}`)) {
        const files = definedIn.map((f) => toPosixRelative(harmonyDir, f)).join(', ');
        warnings.push(`unreferenced resource $${kind}:${name} (defined in ${files})`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
