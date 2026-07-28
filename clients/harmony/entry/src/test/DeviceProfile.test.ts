// entry/src/test/DeviceProfile.test.ts
//
// Pure Node unit tests for core/DeviceProfile.ts (brief section 6.1 / 7.2).
// This file imports only the plain-TypeScript core module below and
// node's own test/assert builtins -- no ArkUI, no @kit.*/@ohos.* imports,
// no decorators.
//
// Covers the resolution table:
//   deviceType === "tv"                       -> dpad + tv        + harmony-tv
//   deviceType === "2in1", or widthVp >= 1280  -> touch + wide     + harmony-mobile (tv metrics)
//   deviceType === "tablet" && widthVp >= 760  -> touch + tablet   + harmony-mobile (touch metrics)
//   everything else                           -> touch + phone    + harmony-mobile (touch metrics)
// plus the compact-phone-in-landscape correction that stops a folded/
// landscape device from being misclassified into the wide / tv-metrics
// stage.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { resolveProfile, DeviceProfile } from "../main/ets/core/DeviceProfile";

describe("resolveProfile: tv device type", () => {
  it("resolves to dpad input, tv form factor and the harmony-tv wire name", () => {
    const profile: DeviceProfile = resolveProfile("tv", 1920, 1080);
    const expected: DeviceProfile = {
      inputMode: "dpad",
      formFactor: "tv",
      platformWireName: "harmony-tv",
      metricsKey: "tv"
    };
    assert.deepStrictEqual(profile, expected);
  });

  it("stays dpad + harmony-tv regardless of window size", () => {
    const profile: DeviceProfile = resolveProfile("tv", 320, 200);
    assert.equal(profile.inputMode, "dpad");
    assert.equal(profile.formFactor, "tv");
    assert.equal(profile.platformWireName, "harmony-tv");
    assert.equal(profile.metricsKey, "tv");
  });
});

describe("resolveProfile: phone / tablet / 2in1 resolve to touch + harmony-mobile", () => {
  it("phone device type resolves to touch input and harmony-mobile", () => {
    const profile: DeviceProfile = resolveProfile("phone", 400, 800);
    const expected: DeviceProfile = {
      inputMode: "touch",
      formFactor: "phone",
      platformWireName: "harmony-mobile",
      metricsKey: "touch"
    };
    assert.deepStrictEqual(profile, expected);
  });

  it("tablet device type at tablet-eligible width resolves to touch input and harmony-mobile", () => {
    const profile: DeviceProfile = resolveProfile("tablet", 800, 1200);
    const expected: DeviceProfile = {
      inputMode: "touch",
      formFactor: "tablet",
      platformWireName: "harmony-mobile",
      metricsKey: "touch"
    };
    assert.deepStrictEqual(profile, expected);
  });

  it("2in1 device type resolves to touch input, wide form factor and harmony-mobile with tv metrics", () => {
    const profile: DeviceProfile = resolveProfile("2in1", 1300, 900);
    const expected: DeviceProfile = {
      inputMode: "touch",
      formFactor: "wide",
      platformWireName: "harmony-mobile",
      metricsKey: "tv"
    };
    assert.deepStrictEqual(profile, expected);
  });

  it("an unrecognised device type degrades to the touch + phone profile, never dpad", () => {
    const profile: DeviceProfile = resolveProfile("wearable", 400, 800);
    assert.equal(profile.inputMode, "touch");
    assert.equal(profile.formFactor, "phone");
    assert.equal(profile.platformWireName, "harmony-mobile");
    assert.equal(profile.metricsKey, "touch");
  });
});

describe("resolveProfile: 1280vp wide breakpoint", () => {
  it("a phone-type device at widthVp 1280 is promoted to the wide / tv-metrics stage", () => {
    const profile: DeviceProfile = resolveProfile("phone", 1280, 900);
    assert.equal(profile.formFactor, "wide");
    assert.equal(profile.metricsKey, "tv");
    assert.equal(profile.inputMode, "touch");
    assert.equal(profile.platformWireName, "harmony-mobile");
  });

  it("one vp below the wide breakpoint stays phone with touch metrics", () => {
    const profile: DeviceProfile = resolveProfile("phone", 1279, 900);
    assert.equal(profile.formFactor, "phone");
    assert.equal(profile.metricsKey, "touch");
  });
});

describe("resolveProfile: 760vp tablet breakpoint", () => {
  it("a tablet device type at widthVp 760 resolves to the tablet form factor", () => {
    const profile: DeviceProfile = resolveProfile("tablet", 760, 900);
    assert.equal(profile.formFactor, "tablet");
    assert.equal(profile.metricsKey, "touch");
  });

  it("one vp below the tablet breakpoint falls back to phone", () => {
    const profile: DeviceProfile = resolveProfile("tablet", 759, 900);
    assert.equal(profile.formFactor, "phone");
    assert.equal(profile.metricsKey, "touch");
  });
});

describe("resolveProfile: compact-phone-in-landscape correction", () => {
  it("overrides a folded 2in1 narrower than 760vp back to phone, even though 2in1 alone selects wide", () => {
    const profile: DeviceProfile = resolveProfile("2in1", 700, 1000);
    const expected: DeviceProfile = {
      inputMode: "touch",
      formFactor: "phone",
      platformWireName: "harmony-mobile",
      metricsKey: "touch"
    };
    assert.deepStrictEqual(profile, expected);
  });

  it("a phone in landscape (widthVp <= 920 and heightVp <= 500) is never misclassified as wide / tv metrics", () => {
    const profile: DeviceProfile = resolveProfile("phone", 900, 450);
    assert.equal(profile.formFactor, "phone");
    assert.equal(profile.metricsKey, "touch");
    assert.equal(profile.inputMode, "touch");
  });

  it("does not force phone when width is landscape-small but height is tall (not the compact case)", () => {
    const profile: DeviceProfile = resolveProfile("phone", 900, 1200);
    assert.equal(profile.formFactor, "phone");
    assert.equal(profile.metricsKey, "touch");
  });
});
