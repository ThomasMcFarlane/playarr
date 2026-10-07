import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {preparePackage, readPngDimensions, tomlStringField} from './prepare-package.mjs';

function fakePng(width, height) {
  const data = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data);
  data.write('IHDR', 12, 'ascii');
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

function manifestToml({version = '0.1.0', componentId = 'com.streamarr.firetv.main', icon = '@image/PlayarrIcon.png'} = {}) {
  return `schema-version = 1\n\n[package]\nid = "com.streamarr.firetv"\ntitle = "Playarr"\nversion = "${version}"\nicon = "${icon}"\n\n[components]\n[[components.interactive]]\nid = "${componentId}"\nruntime-module = "/com.amazon.kepler.keplerscript.runtime.loader_2@IKeplerScript_2_0"\ncategories = ["com.amazon.category.main"]\nlaunch-type = "singleton"\n`;
}

async function validProjectTree(root, overrides = {}) {
  await mkdir(path.join(root, 'assets'), {recursive: true});
  await Promise.all([
    writeFile(path.join(root, 'manifest.toml'), manifestToml(overrides)),
    writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({version: overrides.version ?? '0.1.0'})
    ),
    writeFile(
      path.join(root, 'app.json'),
      JSON.stringify({
        name: overrides.componentId ?? 'com.streamarr.firetv.main',
        displayName: 'Playarr',
      })
    ),
    writeFile(path.join(root, 'assets', 'PlayarrIcon.png'), fakePng(512, 512)),
    writeFile(path.join(root, 'assets', 'PlayarrLargeIcon.png'), fakePng(1280, 720)),
  ]);
}

test('tomlStringField extracts a value from a plain table', () => {
  const toml = manifestToml();
  assert.equal(tomlStringField(toml, '[package]', 'version'), '0.1.0');
  assert.equal(tomlStringField(toml, '[package]', 'icon'), '@image/PlayarrIcon.png');
});

test('tomlStringField extracts a value from an array-of-tables heading', () => {
  const toml = manifestToml();
  assert.equal(
    tomlStringField(toml, '[[components.interactive]]', 'id'),
    'com.streamarr.firetv.main'
  );
});

test('readPngDimensions reads width/height straight from the IHDR chunk', () => {
  assert.deepEqual(readPngDimensions(fakePng(512, 512), 'x.png'), {width: 512, height: 512});
});

test('readPngDimensions rejects a non-PNG buffer', () => {
  assert.throws(() => readPngDimensions(Buffer.from('not a png'), 'x.png'), /must be a PNG image/);
});

test('accepts a fully consistent project tree', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playarr-fire-tv-'));
  await validProjectTree(root);

  await assert.doesNotReject(preparePackage({sourceRoot: root}));
});

test('rejects manifest.toml/package.json version drift', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playarr-fire-tv-version-'));
  await validProjectTree(root, {version: '0.2.0'});
  // package.json intentionally left at the default 0.1.0 by not overriding it.
  await writeFile(path.join(root, 'package.json'), JSON.stringify({version: '0.1.0'}));

  await assert.rejects(preparePackage({sourceRoot: root}), /does not match package\.json/);
});

test('rejects a component id that does not match app.json\'s registered name', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playarr-fire-tv-componentid-'));
  await validProjectTree(root, {componentId: 'com.streamarr.firetv.wrong'});
  await writeFile(
    path.join(root, 'app.json'),
    JSON.stringify({name: 'com.streamarr.firetv.main', displayName: 'Playarr'})
  );

  await assert.rejects(preparePackage({sourceRoot: root}), /AppRegistry\.registerComponent/);
});

test('rejects a non-square PlayarrIcon.png', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playarr-fire-tv-icon-'));
  await validProjectTree(root);
  await writeFile(path.join(root, 'assets', 'PlayarrIcon.png'), fakePng(512, 480));

  await assert.rejects(preparePackage({sourceRoot: root}), /must be square/);
});

test('rejects a too-small PlayarrIcon.png', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playarr-fire-tv-icon-small-'));
  await validProjectTree(root);
  await writeFile(path.join(root, 'assets', 'PlayarrIcon.png'), fakePng(64, 64));

  await assert.rejects(preparePackage({sourceRoot: root}), /too small/);
});

test('rejects a PlayarrLargeIcon.png that is not 16:9', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playarr-fire-tv-largeicon-'));
  await validProjectTree(root);
  await writeFile(path.join(root, 'assets', 'PlayarrLargeIcon.png'), fakePng(1280, 1280));

  await assert.rejects(preparePackage({sourceRoot: root}), /must be 16:9/);
});

test('rejects a leftover proxy-config.json', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playarr-fire-tv-proxyconfig-'));
  await validProjectTree(root);
  await writeFile(path.join(root, 'proxy-config.json'), '{}');

  await assert.rejects(preparePackage({sourceRoot: root}), /proxy-config\.json exists/);
});
