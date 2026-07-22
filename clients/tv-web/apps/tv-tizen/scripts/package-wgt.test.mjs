import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { certificateProfile, findGeneratedWidget } from "./package-wgt.mjs";

test("reads the certificate profile from CLI args before the environment", () => {
  assert.equal(
    certificateProfile(["--profile", "PlayarrTV"], {
      PLAYARR_TIZEN_CERT_PROFILE: "Fallback",
    }),
    "PlayarrTV"
  );
  assert.equal(
    certificateProfile([], { PLAYARR_TIZEN_CERT_PROFILE: "PlayarrTV" }),
    "PlayarrTV"
  );
  assert.throws(() => certificateProfile([], {}), /certificate profile is required/);
});

test("finds exactly one generated widget", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playarr-tizen-wgt-"));
  await writeFile(path.join(root, "Streamarr.wgt"), "widget");
  assert.equal(await findGeneratedWidget(root), path.join(root, "Streamarr.wgt"));
  await writeFile(path.join(root, "Other.wgt"), "widget");
  await assert.rejects(findGeneratedWidget(root), /found 2/);
});
