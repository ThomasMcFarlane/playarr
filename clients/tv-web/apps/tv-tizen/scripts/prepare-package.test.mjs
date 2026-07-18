import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { preparePackage } from "./prepare-package.mjs";

const validManifest = `
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets">
  <tizen:application id="StrmarrTV1.Streamarr" package="StrmarrTV1" required_version="6.0"/>
  <tizen:profile name="tv"/>
  <content src="index.html"/>
  <icon src="icon.png"/>
</widget>`;

test("copies a package-valid widget manifest and icon into the build output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playarr-tizen-"));
  const output = path.join(root, "dist");
  const icon = path.join(root, "source-icon.png");

  await writeFile(path.join(root, "tizen-manifest.xml"), validManifest);
  await writeFile(icon, "test-icon");
  await preparePackage({ sourceRoot: root, outputRoot: output, iconSource: icon });

  assert.equal(await readFile(path.join(output, "config.xml"), "utf8"), validManifest);
  assert.equal(await readFile(path.join(output, "icon.png"), "utf8"), "test-icon");
});

test("rejects a manifest without the Tizen TV profile", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playarr-tizen-invalid-"));
  await writeFile(
    path.join(root, "tizen-manifest.xml"),
    validManifest.replace('<tizen:profile name="tv"/>', "")
  );

  await assert.rejects(
    preparePackage({
      sourceRoot: root,
      outputRoot: path.join(root, "dist"),
      iconSource: path.join(root, "missing.png"),
    }),
    /tizen:profile/
  );
});
