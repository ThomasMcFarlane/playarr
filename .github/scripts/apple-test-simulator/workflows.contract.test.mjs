import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const workflow = readFileSync(
  fileURLToPath(new URL("../../workflows/simulator-tests.yml", import.meta.url)),
  "utf8",
);

describe("Playarr Simulator dispatcher", () => {
  it("is read-only and runs on a GitHub-hosted macOS runner", () => {
    assert.match(workflow, /^permissions:\n  contents: read\n\njobs:/m);
    assert.doesNotMatch(workflow, /id-token|self-hosted/);
    assert.match(workflow, /runs-on: macos-latest/);
    assert.match(workflow, /timeout-minutes: 60/);
  });

  it("uses the prepared CocoaPods workspace for iOS and the direct project for tvOS", () => {
    assert.match(workflow, /directory: clients\/ios\n\s+workspace: clients\/ios\/Playarr\.xcworkspace\n\s+project: ""\n\s+scheme: PlayarrApp/);
    assert.match(workflow, /directory: clients\/apple-tv\n\s+workspace: ""\n\s+project: clients\/apple-tv\/PlayarrTV\.xcodeproj\n\s+scheme: PlayarrTV/);
    assert.match(workflow, /xcodebuild test/);
  });

  it("creates and always deletes an isolated simulator", () => {
    assert.match(workflow, /apple-test-simulator\/main\.js/);
    assert.match(workflow, /if: \$\{\{ always\(\) && steps\.simulator\.outputs\.udid != '' \}\}/);
    assert.match(workflow, /apple-test-simulator\/cleanup\.js/);
  });
});

describe("Playarr signed release platform selector", () => {
  const workflow = readFileSync(
    fileURLToPath(new URL("../../workflows/ios-release.yml", import.meta.url)),
    "utf8",
  );

  it("defaults to both platforms and validates the explicit platform choice", () => {
    assert.match(workflow, /platform:\n\s+description: [^\n]*tvOS[^\n]*\n\s+required: true\n\s+type: choice\n\s+options:\n\s+- both\n\s+- ios\n\s+- tvos\n\s+default: both/);
    assert.match(workflow, /PLATFORM_INPUT: \$\{\{ inputs\.platform \}\}/);
    assert.match(workflow, /platform="\$\{PLATFORM_INPUT:-both\}"/);
    assert.match(workflow, /\[\[ "\$platform" == both \|\| "\$platform" == ios \|\| "\$platform" == tvos \]\]/);
  });

  it("gates each signed upload independently and requires only its platform profile", () => {
    assert.match(workflow, /if \[\[ "\$RELEASE_PLATFORM" == both \|\| "\$RELEASE_PLATFORM" == ios \]\]; then[\s\S]*?APPLE_PROVISIONING_PROFILE_BASE64/);
    assert.match(workflow, /if \[\[ "\$RELEASE_PLATFORM" == both \|\| "\$RELEASE_PLATFORM" == tvos \]\]; then[\s\S]*?APPLE_TVOS_PROVISIONING_PROFILE_BASE64/);
    assert.match(workflow, /if \[\[ "\$RELEASE_PLATFORM" == both \|\| "\$RELEASE_PLATFORM" == ios \]\]; then\n\s+ARCHIVE_PATH="\$IOS_ARCHIVE_PATH"[\s\S]*?release\.sh testflight ios\n\s+fi/);
    assert.match(workflow, /if \[\[ "\$RELEASE_PLATFORM" == both \|\| "\$RELEASE_PLATFORM" == tvos \]\]; then\n\s+ARCHIVE_PATH="\$TVOS_ARCHIVE_PATH"[\s\S]*?release\.sh testflight tvos\n\s+fi/);
  });
});
