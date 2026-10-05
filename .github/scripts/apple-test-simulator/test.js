"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createSimulator } = require("./main");
const { cleanupSimulator } = require("./cleanup");

const IOS_UDID = "4D76CE44-AB81-49AB-9C2E-31769FA43092";
const TV_UDID = "8D72CE44-AB81-49AB-9C2E-31769FA43092";
const runtimes = { runtimes: [
  { identifier: "com.apple.CoreSimulator.SimRuntime.iOS-18-0", version: "18.0", isAvailable: true },
  { identifier: "com.apple.CoreSimulator.SimRuntime.iOS-26-5", version: "26.5", isAvailable: true },
  { identifier: "com.apple.CoreSimulator.SimRuntime.tvOS-26-5", version: "26.5", isAvailable: true },
] };
const types = { devicetypes: [
  { identifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17", name: "iPhone 17" },
  { identifier: "com.apple.CoreSimulator.SimDeviceType.Apple-TV-4K-2nd-generation", name: "Apple TV 4K (2nd generation)" },
  { identifier: "com.apple.CoreSimulator.SimDeviceType.Apple-TV-4K-3rd-generation", name: "Apple TV 4K (3rd generation)" },
] };

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "apple-test-simulator-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { outputFile: path.join(directory, "output"), stateFile: path.join(directory, "state"), stateValues: [] };
}

test("creates the requested iPhone type from the latest installed iOS runtime and records its UDID", (t) => {
  const files = fixture(t);
  const calls = [];
  const run = (_command, args) => {
    calls.push(args);
    if (args[2] === "runtimes") return JSON.stringify(runtimes);
    if (args[2] === "devicetypes") return JSON.stringify(types);
    return IOS_UDID;
  };
  assert.equal(createSimulator({ destination: "platform=iOS Simulator,name=iPhone 17", run, saveState: (...value) => files.stateValues.push(value), ...files }), IOS_UDID);
  assert.deepEqual(calls.at(-1), ["simctl", "create", "Playarr CI ios test", types.devicetypes[0].identifier, runtimes.runtimes[1].identifier]);
  assert.equal(readFileSync(files.outputFile, "utf8"), `udid=${IOS_UDID}\n`);
  assert.deepEqual(files.stateValues, [["simulator_udid", IOS_UDID]]);
});

test("creates Apple TV using the newest installed Apple TV device type", (t) => {
  const files = fixture(t);
  const calls = [];
  const run = (_command, args) => {
    calls.push(args);
    if (args[2] === "runtimes") return JSON.stringify(runtimes);
    if (args[2] === "devicetypes") return JSON.stringify(types);
    return TV_UDID;
  };
  createSimulator({ destination: "platform=tvOS Simulator,name=Apple TV", run, ...files });
  assert.deepEqual(calls.at(-1), ["simctl", "create", "Playarr CI tvos test", types.devicetypes[2].identifier, runtimes.runtimes[2].identifier]);
});

test("honours an exact requested Apple TV Simulator device type", (t) => {
  const files = fixture(t);
  const calls = [];
  const run = (_command, args) => {
    calls.push(args);
    if (args[2] === "runtimes") return JSON.stringify(runtimes);
    if (args[2] === "devicetypes") return JSON.stringify(types);
    return TV_UDID;
  };
  createSimulator({ destination: "platform=tvOS Simulator,name=Apple TV 4K (2nd generation)", run, ...files });
  assert.deepEqual(calls.at(-1), ["simctl", "create", "Playarr CI tvos test", types.devicetypes[1].identifier, runtimes.runtimes[2].identifier]);
});

test("does not create a device when no compatible installed runtime exists", (t) => {
  const files = fixture(t);
  const calls = [];
  const run = (_command, args) => {
    calls.push(args);
    if (args[2] === "runtimes") return JSON.stringify({ runtimes: [] });
    return JSON.stringify(types);
  };
  assert.throws(() => createSimulator({ destination: "platform=iOS Simulator,name=iPhone 17", run, ...files }), /No compatible installed ios Simulator runtime/);
  assert.equal(calls.some((args) => args[1] === "create"), false);
});

test("cleanup deletes only the recorded created UDID and refuses malformed state", (t) => {
  const files = fixture(t);
  const deleted = [];
  assert.equal(cleanupSimulator({ udid: IOS_UDID, run: (_command, args) => deleted.push(args) }), true);
  assert.deepEqual(deleted, [["simctl", "delete", IOS_UDID]]);
  assert.throws(() => cleanupSimulator({ udid: "all", run: () => assert.fail("must not call simctl") }), /invalid recorded UDID/);
  writeFileSync(files.stateFile, `simulator_udid=${TV_UDID}\n`);
  assert.equal(cleanupSimulator({ udid: "", stateFile: files.stateFile, run: (_command, args) => deleted.push(args) }), true);
  assert.deepEqual(deleted.at(-1), ["simctl", "delete", TV_UDID]);
  assert.equal(cleanupSimulator({ udid: "", stateFile: path.join(os.tmpdir(), "missing-apple-state"), run: () => assert.fail("must not call simctl") }), false);
});

test("post-action cleanup reads the saved simulator UDID from its state environment", () => {
  const prior = process.env.STATE_simulator_udid;
  const deleted = [];
  process.env.STATE_simulator_udid = TV_UDID;
  try {
    assert.equal(cleanupSimulator({ run: (_command, args) => deleted.push(args) }), true);
    assert.deepEqual(deleted, [["simctl", "delete", TV_UDID]]);
  } finally {
    if (prior === undefined) delete process.env.STATE_simulator_udid;
    else process.env.STATE_simulator_udid = prior;
  }
});
