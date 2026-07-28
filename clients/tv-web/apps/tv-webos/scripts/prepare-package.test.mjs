import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { preparePackage, readPngDimensions } from "./prepare-package.mjs";

function fakePng(width, height) {
  const data = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

function validManifest(overrides = {}) {
  return {
    id: "com.playarr.tv",
    title: "Playarr",
    version: "0.1.0",
    type: "web",
    main: "index.html",
    icon: "icon.png",
    largeIcon: "largeIcon.png",
    disableBackHistoryAPI: true,
    handlesRelaunch: false,
    ...overrides,
  };
}

async function validPackageTree(root, manifest = validManifest()) {
  const output = path.join(root, "dist");
  const publicRoot = path.join(root, "public");
  await mkdir(path.join(output, "assets"), { recursive: true });
  await mkdir(publicRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "appinfo.json"), JSON.stringify(manifest)),
    writeFile(path.join(root, "package.json"), JSON.stringify({ version: "0.1.0" })),
    writeFile(
      path.join(output, "index.html"),
      '<script type="module" src="./assets/app.js"></script>'
    ),
    writeFile(path.join(output, "assets", "app.css"), 'body{background:url("../icon.png")}'),
    writeFile(path.join(publicRoot, "icon.png"), fakePng(80, 80)),
    writeFile(path.join(publicRoot, "largeIcon.png"), fakePng(130, 130)),
    writeFile(path.join(publicRoot, "playarr-icon.svg"), "<svg><title>Playarr</title></svg>"),
  ]);
  return { output, publicRoot };
}

test("copies a package-valid manifest and exact webOS icon sizes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playarr-webos-"));
  const { output } = await validPackageTree(root);

  await preparePackage({ sourceRoot: root, outputRoot: output });

  assert.deepEqual(
    JSON.parse(await readFile(path.join(output, "appinfo.json"), "utf8")),
    validManifest()
  );
  assert.deepEqual(
    readPngDimensions(await readFile(path.join(output, "icon.png")), "icon.png"),
    { width: 80, height: 80 }
  );
  assert.deepEqual(
    readPngDimensions(await readFile(path.join(output, "largeIcon.png")), "largeIcon.png"),
    { width: 130, height: 130 }
  );
  assert.match(await readFile(path.join(output, "playarr-icon.svg"), "utf8"), /Playarr/);
});

test("rejects a manifest that cannot launch the bundled web app", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playarr-webos-invalid-"));
  const manifest = validManifest({ type: "native" });
  const { output } = await validPackageTree(root, manifest);

  await assert.rejects(
    preparePackage({ sourceRoot: root, outputRoot: output }),
    /must describe a web app/
  );
});

test("rejects package and manifest version drift", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playarr-webos-version-"));
  const { output } = await validPackageTree(root, validManifest({ version: "0.2.0" }));

  await assert.rejects(
    preparePackage({ sourceRoot: root, outputRoot: output }),
    /does not match package.json version/
  );
});

test("rejects root-absolute Vite asset URLs that fail inside an IPK", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playarr-webos-assets-"));
  const { output } = await validPackageTree(root);
  await writeFile(
    path.join(output, "index.html"),
    '<script type="module" src="/assets/app.js"></script>'
  );

  await assert.rejects(
    preparePackage({ sourceRoot: root, outputRoot: output }),
    /root-absolute asset URL/
  );
});

test("rejects icons that do not match webOS launcher requirements", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playarr-webos-icon-"));
  const { output, publicRoot } = await validPackageTree(root);
  await writeFile(path.join(publicRoot, "icon.png"), fakePng(512, 512));

  await assert.rejects(
    preparePackage({ sourceRoot: root, outputRoot: output }),
    /must be 80x80px/
  );
});
