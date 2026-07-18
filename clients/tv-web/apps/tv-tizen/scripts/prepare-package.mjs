import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function preparePackage({
  sourceRoot = appRoot,
  outputRoot = path.join(sourceRoot, "dist"),
  iconSource = path.resolve(sourceRoot, "../../web/public/playarr-icon-512.png"),
} = {}) {
  const manifestSource = path.join(sourceRoot, "tizen-manifest.xml");
  const manifest = await readFile(manifestSource, "utf8");

  const requiredManifestContent = [
    "<widget ",
    "<tizen:application ",
    '<tizen:profile name="tv"',
    '<content src="index.html"',
    '<icon src="icon.png"',
  ];
  for (const expected of requiredManifestContent) {
    if (!manifest.includes(expected)) {
      throw new Error(`tizen-manifest.xml is missing required content: ${expected}`);
    }
  }

  await mkdir(outputRoot, { recursive: true });
  await copyFile(manifestSource, path.join(outputRoot, "config.xml"));
  await copyFile(iconSource, path.join(outputRoot, "icon.png"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await preparePackage();
}
