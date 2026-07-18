import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { preparePackage } from "./prepare-package.mjs";

test("copies a package-valid manifest and icon into the build output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playarr-webos-"));
  const output = path.join(root, "dist");
  const icon = path.join(root, "source-icon.png");
  const manifest = {
    id: "com.streamarr.tv",
    version: "0.1.0",
    type: "web",
    main: "index.html",
    icon: "icon.png",
  };

  await writeFile(path.join(root, "appinfo.json"), JSON.stringify(manifest));
  await writeFile(icon, "test-icon");
  await preparePackage({ sourceRoot: root, outputRoot: output, iconSource: icon });

  assert.deepEqual(
    JSON.parse(await readFile(path.join(output, "appinfo.json"), "utf8")),
    manifest
  );
  assert.equal(await readFile(path.join(output, "icon.png"), "utf8"), "test-icon");
});

test("rejects a manifest that cannot launch the bundled web app", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playarr-webos-invalid-"));
  await writeFile(
    path.join(root, "appinfo.json"),
    JSON.stringify({ type: "native", main: "index.html", icon: "icon.png" })
  );

  await assert.rejects(
    preparePackage({
      sourceRoot: root,
      outputRoot: path.join(root, "dist"),
      iconSource: path.join(root, "missing.png"),
    }),
    /must describe a web app/
  );
});
