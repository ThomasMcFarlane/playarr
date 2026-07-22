import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const WEBOS_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

export function readPngDimensions(contents, fileName) {
  if (
    contents.length < 24 ||
    !contents.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    contents.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error(`${fileName} must be a PNG image`);
  }

  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
  };
}

async function assertPngSize(filePath, width, height) {
  const dimensions = readPngDimensions(await readFile(filePath), path.basename(filePath));
  if (dimensions.width !== width || dimensions.height !== height) {
    throw new Error(
      `${path.basename(filePath)} must be ${width}x${height}px (received ${dimensions.width}x${dimensions.height}px)`
    );
  }
}

function validateManifest(manifest, packageVersion) {
  const requiredStrings = ["id", "title", "type", "main", "version", "icon", "largeIcon"];
  for (const field of requiredStrings) {
    if (typeof manifest[field] !== "string" || manifest[field].length === 0) {
      throw new Error(`appinfo.json must declare a non-empty ${field}`);
    }
  }
  if (manifest.type !== "web" || manifest.main !== "index.html") {
    throw new Error("appinfo.json must describe a web app with index.html as its entry point");
  }
  if (!/^[a-z0-9][a-z0-9.-]+$/.test(manifest.id)) {
    throw new Error("appinfo.json id must be a valid lowercase webOS application id");
  }
  if (!WEBOS_VERSION.test(manifest.version)) {
    throw new Error("appinfo.json version must contain three dot-separated integers without leading zeroes");
  }
  if (manifest.version !== packageVersion) {
    throw new Error(
      `appinfo.json version ${manifest.version} does not match package.json version ${packageVersion}`
    );
  }
  if (manifest.icon !== "icon.png" || manifest.largeIcon !== "largeIcon.png") {
    throw new Error("appinfo.json must use the package's 80px icon.png and 130px largeIcon.png");
  }
  if (manifest.disableBackHistoryAPI !== true) {
    throw new Error("appinfo.json must deliver Back to Playarr for modal, player, and route handling");
  }
  if (manifest.handlesRelaunch !== false) {
    throw new Error("appinfo.json must leave foreground reactivation to webOS");
  }
  if (manifest.appDescription?.length > 60) {
    throw new Error("appinfo.json appDescription cannot exceed webOS's 60-character limit");
  }
  for (const unsupported of ["requiredPermissions", "uiRevision"]) {
    if (unsupported in manifest) {
      throw new Error(`appinfo.json contains unsupported webOS TV metadata: ${unsupported}`);
    }
  }
}

async function collectPackageTextFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectPackageTextFiles(absolute)));
    } else if (entry.name.endsWith(".html") || entry.name.endsWith(".css")) {
      files.push(absolute);
    }
  }
  return files;
}

async function assertRelativePackageUrls(outputRoot) {
  const textFiles = await collectPackageTextFiles(outputRoot);
  if (!textFiles.some((file) => path.basename(file) === "index.html")) {
    throw new Error("Vite output is missing index.html");
  }

  const rootAssetAttribute = /\b(?:src|href)\s*=\s*["']\/(?!\/)/i;
  const rootCssUrl = /url\(\s*["']?\/(?!\/)/i;
  for (const file of textFiles) {
    const contents = await readFile(file, "utf8");
    if (rootAssetAttribute.test(contents) || rootCssUrl.test(contents)) {
      throw new Error(
        `${path.relative(outputRoot, file)} contains a root-absolute asset URL that cannot load from an installed IPK`
      );
    }
  }
}

export async function preparePackage({
  sourceRoot = appRoot,
  outputRoot = path.join(sourceRoot, "dist"),
  iconRoot = path.join(sourceRoot, "public"),
} = {}) {
  const manifestSource = path.join(sourceRoot, "appinfo.json");
  const [manifest, packageJson] = await Promise.all([
    readFile(manifestSource, "utf8").then(JSON.parse),
    readFile(path.join(sourceRoot, "package.json"), "utf8").then(JSON.parse),
  ]);

  validateManifest(manifest, packageJson.version);
  await assertPngSize(path.join(iconRoot, manifest.icon), 80, 80);
  await assertPngSize(path.join(iconRoot, manifest.largeIcon), 130, 130);
  const runtimeIcon = await readFile(path.join(iconRoot, "playarr-icon.svg"), "utf8");
  if (!runtimeIcon.includes("<svg") || !runtimeIcon.includes("Playarr")) {
    throw new Error("playarr-icon.svg must contain the shared Playarr application mark");
  }
  await assertRelativePackageUrls(outputRoot);

  await mkdir(outputRoot, { recursive: true });
  await Promise.all([
    copyFile(manifestSource, path.join(outputRoot, "appinfo.json")),
    copyFile(path.join(iconRoot, manifest.icon), path.join(outputRoot, manifest.icon)),
    copyFile(path.join(iconRoot, manifest.largeIcon), path.join(outputRoot, manifest.largeIcon)),
    copyFile(path.join(iconRoot, "playarr-icon.svg"), path.join(outputRoot, "playarr-icon.svg")),
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await preparePackage();
}
