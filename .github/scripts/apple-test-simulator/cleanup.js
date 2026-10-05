"use strict";

const { execFileSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanupSimulator({ udid = process.env.STATE_simulator_udid, stateFile = process.env.GITHUB_STATE, run = (command, args) => execFileSync(command, args, { encoding: "utf8" }) }) {
  const recorded = udid || (stateFile && existsSync(stateFile) && readFileSync(stateFile, "utf8").split(/\r?\n/).find((line) => line.startsWith("simulator_udid="))?.slice("simulator_udid=".length));
  if (!recorded) return false;
  if (!UUID.test(recorded)) throw new Error("Refusing to delete a simulator with an invalid recorded UDID");
  run("xcrun", ["simctl", "delete", recorded]);
  console.log("Deleted the isolated Apple test simulator created by this action");
  return true;
}

if (require.main === module) {
  try {
    cleanupSimulator({ udid: process.env.STATE_simulator_udid });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { cleanupSimulator, UUID };
