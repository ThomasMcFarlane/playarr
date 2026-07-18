import { describe, expect, it } from "vitest";
import { selectDeviceProfiles } from "./deviceProfiles";

describe("device profile selection", () => {
  const availableProfiles = [
    { id: "current", name: "Current user" },
    { id: "saved", name: "Saved user" },
    { id: "remote", name: "Remote user" },
  ];

  it("only returns profiles signed in on this device", () => {
    expect(
      selectDeviceProfiles(
        availableProfiles,
        (userId) => userId === "saved",
        "current"
      )
    ).toEqual(availableProfiles.slice(0, 2));
  });

  it("retains a current transparent-login profile without a saved session", () => {
    expect(selectDeviceProfiles(availableProfiles, () => false, "current")).toEqual([
      availableProfiles[0],
    ]);
  });

  it("does not expose server users when this device has no matching session", () => {
    expect(selectDeviceProfiles(availableProfiles, () => false)).toEqual([]);
  });
});
