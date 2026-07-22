import { copyFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function certificateProfile(args, environment = process.env) {
  const profileIndex = args.indexOf("--profile");
  const fromArgument = profileIndex >= 0 ? args[profileIndex + 1] : undefined;
  const profile = fromArgument || environment.PLAYARR_TIZEN_CERT_PROFILE;
  if (!profile) {
    throw new Error(
      "A Samsung certificate profile is required: pass --profile <name> or set PLAYARR_TIZEN_CERT_PROFILE"
    );
  }
  return profile;
}

export async function findGeneratedWidget(outputRoot) {
  const widgets = (await readdir(outputRoot))
    .filter((name) => name.toLowerCase().endsWith(".wgt"))
    .sort();
  if (widgets.length !== 1) {
    throw new Error(
      `Expected exactly one generated .wgt in ${outputRoot}, found ${widgets.length}`
    );
  }
  return path.join(outputRoot, widgets[0]);
}

export async function packageWidget({
  args = process.argv.slice(2),
  environment = process.env,
  sourceRoot = appRoot,
  run = spawnSync,
} = {}) {
  const profile = certificateProfile(args, environment);
  const outputRoot = path.join(sourceRoot, "dist");
  const result = run(
    "tizen",
    ["package", "-t", "wgt", "-s", profile, "--", outputRoot],
    { cwd: sourceRoot, stdio: "inherit" }
  );
  if (result.error) {
    throw new Error(`Could not run the Tizen Studio CLI: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`tizen package failed with exit code ${result.status ?? "unknown"}`);
  }

  const generatedWidget = await findGeneratedWidget(outputRoot);
  const stableWidget = path.join(sourceRoot, "playarr-tizen.wgt");
  await copyFile(generatedWidget, stableWidget);
  console.log(`Signed widget: ${stableWidget}`);
  return stableWidget;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await packageWidget();
}
