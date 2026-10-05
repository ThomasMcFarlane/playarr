"use strict";

const { execFileSync } = require("node:child_process");
const { appendFileSync } = require("node:fs");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function versionParts(version) {
  return String(version).split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function parseDestination(destination) {
  const match = /^platform=(iOS|tvOS) Simulator,name=([^,]+)(?:,os=([^,]+))?$/i.exec(destination);
  if (!match) throw new Error("Destination must name an iOS or tvOS Simulator device");
  return { platform: match[1].toLowerCase(), requestedName: match[2], requestedOs: match[3] || "" };
}

function latestRuntime(runtimes, platform, requestedOs) {
  const prefix = platform === "ios" ? "com.apple.CoreSimulator.SimRuntime.iOS-" : "com.apple.CoreSimulator.SimRuntime.tvOS-";
  const choices = runtimes
    .filter((runtime) => runtime.isAvailable && runtime.identifier.startsWith(prefix))
    .filter((runtime) => !requestedOs || runtime.version === requestedOs)
    .sort((left, right) => compareVersions(right.version, left.version));
  if (!choices.length) throw new Error(`No compatible installed ${platform} Simulator runtime is available`);
  return choices[0];
}

function deviceType(deviceTypes, platform, requestedName) {
  if (platform === "ios") {
    const exact = deviceTypes.find((item) => item.name === requestedName && item.identifier.startsWith("com.apple.CoreSimulator.SimDeviceType.iPhone-"));
    if (!exact) throw new Error(`Requested iOS Simulator device type is unavailable: ${requestedName}`);
    return exact;
  }

  const appleTvs = deviceTypes.filter((item) => item.name.startsWith("Apple TV") && item.identifier.startsWith("com.apple.CoreSimulator.SimDeviceType.Apple-TV-"));
  if (!appleTvs.length) throw new Error("No Apple TV Simulator device type is installed");
  if (requestedName !== "Apple TV") {
    const exact = appleTvs.find((item) => item.name === requestedName);
    if (!exact) throw new Error(`Requested tvOS Simulator device type is unavailable: ${requestedName}`);
    return exact;
  }
  const generation = (name) => {
    const match = name.match(/\((\d+)(?:st|nd|rd|th) generation\)/i);
    return match ? Number(match[1]) : 0;
  };
  return appleTvs.sort((left, right) => generation(right.name) - generation(left.name))[0];
}

function runSimctl(args, run) {
  return run("xcrun", ["simctl", ...args]);
}

function createSimulator({ destination, run = (command, args) => execFileSync(command, args, { encoding: "utf8" }), outputFile = process.env.GITHUB_OUTPUT, saveState = (name, value) => console.log(`::save-state name=${name}::${value}`) }) {
  if (!outputFile) throw new Error("GitHub output path is required");
  const request = parseDestination(destination);
  const runtimeData = JSON.parse(runSimctl(["list", "runtimes", "--json"], run));
  const deviceTypeData = JSON.parse(runSimctl(["list", "devicetypes", "--json"], run));
  const runtime = latestRuntime(runtimeData.runtimes || [], request.platform, request.requestedOs);
  const type = deviceType(deviceTypeData.devicetypes || [], request.platform, request.requestedName);
  const udid = runSimctl(["create", `Playarr CI ${request.platform} test`, type.identifier, runtime.identifier], run).trim();
  if (!UUID.test(udid)) throw new Error("simctl returned an invalid simulator UDID");
  saveState("simulator_udid", udid);
  appendFileSync(outputFile, `udid=${udid}\n`);
  console.log(`Created isolated ${request.platform} Simulator using runtime ${runtime.version} and device type ${type.name}`);
  return udid;
}

if (require.main === module) {
  try {
    createSimulator({ destination: process.env.INPUT_DESTINATION });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { UUID, compareVersions, createSimulator, deviceType, latestRuntime, parseDestination, runSimctl };
