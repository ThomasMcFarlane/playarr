import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function preparePackage({
  sourceRoot = appRoot,
  outputRoot = path.join(sourceRoot, "dist"),
  iconSource = path.resolve(sourceRoot, "../../web/public/playarr-icon-512.png"),
  runtimeConfigSource = path.join(sourceRoot, "public/streamarr-config.json"),
  packageJsonSource = path.join(sourceRoot, "package.json"),
} = {}) {
  const manifestSource = path.join(sourceRoot, "tizen-manifest.xml");
  const [manifest, packageJson, runtimeConfigText] = await Promise.all([
    readFile(manifestSource, "utf8"),
    readFile(packageJsonSource, "utf8").then(JSON.parse),
    readFile(runtimeConfigSource, "utf8"),
  ]);

  const requiredManifestContent = [
    "<widget ",
    "<tizen:application ",
    '<tizen:profile name="tv"',
    '<content src="index.html"',
    '<icon src="icon.png"',
    "<name>Playarr</name>",
    'required_version="7.0"',
    "http://tizen.org/privilege/internet",
    'http://tizen.org/privilege/tv.inputdevice',
    "http://tizen.org/privilege/filesystem.write",
    '<access origin="*"',
  ];
  for (const expected of requiredManifestContent) {
    if (!manifest.includes(expected)) {
      throw new Error(`tizen-manifest.xml is missing required content: ${expected}`);
    }
  }
  const manifestVersion = manifest.match(/<widget\b[^>]*\bversion="([^"]+)"/s)?.[1];
  if (manifestVersion !== packageJson.version) {
    throw new Error(
      `tizen-manifest.xml version ${manifestVersion ?? "missing"} does not match package.json version ${packageJson.version}`
    );
  }

  const runtimeConfig = JSON.parse(runtimeConfigText);
  if (typeof runtimeConfig.apiBaseUrl !== "string") {
    throw new Error("streamarr-config.json apiBaseUrl must be a string");
  }
  if (runtimeConfig.apiBaseUrl.trim()) {
    const apiUrl = new URL(runtimeConfig.apiBaseUrl);
    if (
      (apiUrl.protocol !== "http:" && apiUrl.protocol !== "https:") ||
      apiUrl.username ||
      apiUrl.password ||
      apiUrl.search ||
      apiUrl.hash
    ) {
      throw new Error(
        "streamarr-config.json apiBaseUrl must use HTTP(S) without credentials, a query, or a fragment"
      );
    }
  }

  await mkdir(outputRoot, { recursive: true });
  await copyFile(manifestSource, path.join(outputRoot, "config.xml"));
  await copyFile(iconSource, path.join(outputRoot, "icon.png"));
  await copyFile(runtimeConfigSource, path.join(outputRoot, "streamarr-config.json"));

  const builtIndex = await readFile(path.join(outputRoot, "index.html"), "utf8");
  for (const expected of [
    "$WEBAPIS/webapis/webapis.js",
    'type="application/avplayer"',
  ]) {
    if (!builtIndex.includes(expected)) {
      throw new Error(`built index.html is missing required Tizen content: ${expected}`);
    }
  }

  const runtimeIcon = await readFile(path.join(outputRoot, "playarr-icon.svg"), "utf8");
  if (!runtimeIcon.includes("<svg") || !runtimeIcon.includes("Playarr")) {
    throw new Error("built package is missing the shared Playarr application mark");
  }

  const rootAssetAttribute = /\b(?:src|href)\s*=\s*["']\/(?!\/)/i;
  const rootCssUrl = /url\(\s*["']?\/(?!\/)/i;
  const pendingDirectories = [outputRoot];
  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(absolute);
      } else if (entry.name.endsWith(".html") || entry.name.endsWith(".css")) {
        const contents = await readFile(absolute, "utf8");
        if (rootAssetAttribute.test(contents) || rootCssUrl.test(contents)) {
          throw new Error(
            `${path.relative(outputRoot, absolute)} contains a root-absolute asset URL that cannot load from an installed WGT`
          );
        }
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await preparePackage();
}
