import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { preparePackage } from "./prepare-package.mjs";

const validManifest = `
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" version="0.1.0">
  <tizen:application id="StrmarrTV1.Playarr" package="StrmarrTV1" required_version="7.0"/>
  <tizen:profile name="tv"/>
  <name>Playarr</name>
  <content src="index.html"/>
  <icon src="icon.png"/>
  <access origin="*" subdomains="true"/>
  <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
  <tizen:privilege name="http://tizen.org/privilege/filesystem.write"/>
</widget>`;

const builtIndex = `
<script src="$WEBAPIS/webapis/webapis.js"></script>
<object type="application/avplayer"></object>`;

test("copies a package-valid widget manifest and icon into the build output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playarr-tizen-"));
  const output = path.join(root, "dist");
  const icon = path.join(root, "source-icon.png");
  const runtimeConfig = path.join(root, "playarr-config.json");
  const packageJson = path.join(root, "package.json");

  await writeFile(path.join(root, "tizen-manifest.xml"), validManifest);
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "index.html"), builtIndex);
  await writeFile(path.join(output, "playarr-icon.svg"), '<svg aria-label="Playarr"></svg>');
  await writeFile(icon, "test-icon");
  await writeFile(runtimeConfig, '{"apiBaseUrl":""}');
  await writeFile(packageJson, '{"version":"0.1.0"}');
  await preparePackage({
    sourceRoot: root,
    outputRoot: output,
    iconSource: icon,
    runtimeConfigSource: runtimeConfig,
    packageJsonSource: packageJson,
  });

  assert.equal(await readFile(path.join(output, "config.xml"), "utf8"), validManifest);
  assert.equal(await readFile(path.join(output, "icon.png"), "utf8"), "test-icon");
  assert.equal(
    await readFile(path.join(output, "playarr-config.json"), "utf8"),
    '{"apiBaseUrl":""}'
  );
});

test("rejects a manifest without the Tizen TV profile", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playarr-tizen-invalid-"));
  await writeFile(
    path.join(root, "tizen-manifest.xml"),
    validManifest.replace('<tizen:profile name="tv"/>', "")
  );
  await mkdir(path.join(root, "dist"), { recursive: true });
  await writeFile(path.join(root, "dist/index.html"), builtIndex);
  await writeFile(path.join(root, "package.json"), '{"version":"0.1.0"}');
  await writeFile(path.join(root, "playarr-config.json"), '{"apiBaseUrl":""}');

  await assert.rejects(
    preparePackage({
      sourceRoot: root,
      outputRoot: path.join(root, "dist"),
      iconSource: path.join(root, "missing.png"),
      runtimeConfigSource: path.join(root, "playarr-config.json"),
      packageJsonSource: path.join(root, "package.json"),
    }),
    /tizen:profile/
  );
});

test("rejects a manifest below the Chromium 94 Tizen 7 floor", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playarr-tizen-floor-"));
  const output = path.join(root, "dist");
  await writeFile(
    path.join(root, "tizen-manifest.xml"),
    validManifest.replace('required_version="7.0"', 'required_version="6.0"')
  );
  await writeFile(path.join(root, "package.json"), '{"version":"0.1.0"}');
  await writeFile(path.join(root, "playarr-config.json"), '{"apiBaseUrl":""}');
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "index.html"), builtIndex);

  await assert.rejects(
    preparePackage({
      sourceRoot: root,
      outputRoot: output,
      iconSource: path.join(root, "missing.png"),
      runtimeConfigSource: path.join(root, "playarr-config.json"),
      packageJsonSource: path.join(root, "package.json"),
    }),
    /required_version="7\.0"/
  );
});

test("rejects manifest/package version drift", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playarr-tizen-version-"));
  const output = path.join(root, "dist");
  await writeFile(path.join(root, "tizen-manifest.xml"), validManifest);
  await writeFile(path.join(root, "package.json"), '{"version":"0.2.0"}');
  await writeFile(path.join(root, "playarr-config.json"), '{"apiBaseUrl":""}');
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "index.html"), builtIndex);

  await assert.rejects(
    preparePackage({
      sourceRoot: root,
      outputRoot: output,
      iconSource: path.join(root, "missing.png"),
      runtimeConfigSource: path.join(root, "playarr-config.json"),
      packageJsonSource: path.join(root, "package.json"),
    }),
    /does not match package\.json/
  );
});

test("rejects packaged server URLs containing a query or fragment", async () => {
  for (const apiBaseUrl of [
    "https://playarr.example.test/?token=secret",
    "https://playarr.example.test/#private",
  ]) {
    const root = await mkdtemp(path.join(os.tmpdir(), "playarr-tizen-config-"));
    const output = path.join(root, "dist");
    await writeFile(path.join(root, "tizen-manifest.xml"), validManifest);
    await writeFile(path.join(root, "package.json"), '{"version":"0.1.0"}');
    await writeFile(
      path.join(root, "playarr-config.json"),
      JSON.stringify({ apiBaseUrl })
    );
    await mkdir(output, { recursive: true });

    await assert.rejects(
      preparePackage({
        sourceRoot: root,
        outputRoot: output,
        iconSource: path.join(root, "missing.png"),
        runtimeConfigSource: path.join(root, "playarr-config.json"),
        packageJsonSource: path.join(root, "package.json"),
      }),
      /without credentials, a query, or a fragment/
    );
  }
});
