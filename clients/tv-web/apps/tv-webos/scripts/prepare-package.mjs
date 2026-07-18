import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function preparePackage({
  sourceRoot = appRoot,
  outputRoot = path.join(sourceRoot, "dist"),
  iconSource = path.resolve(sourceRoot, "../../web/public/playarr-icon-512.png"),
} = {}) {
  const manifestSource = path.join(sourceRoot, "appinfo.json");
  const manifest = JSON.parse(await readFile(manifestSource, "utf8"));

  if (manifest.type !== "web" || manifest.main !== "index.html") {
    throw new Error("appinfo.json must describe a web app with index.html as its entry point");
  }
  if (typeof manifest.icon !== "string" || manifest.icon.length === 0) {
    throw new Error("appinfo.json must declare an application icon");
  }

  await mkdir(outputRoot, { recursive: true });
  await copyFile(manifestSource, path.join(outputRoot, "appinfo.json"));
  await copyFile(iconSource, path.join(outputRoot, manifest.icon));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await preparePackage();
}
