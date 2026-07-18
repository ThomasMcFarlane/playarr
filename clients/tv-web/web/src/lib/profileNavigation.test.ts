import { describe, expect, it } from "vitest";
import { shouldRevalidateCurrentProfile } from "./profileNavigation";

describe("shouldRevalidateCurrentProfile", () => {
  it("reuses a saved current-profile session when authentication failed in place", () => {
    expect(shouldRevalidateCurrentProfile(true, "select", "/settings/account")).toBe(true);
  });

  it("keeps ordinary profile and settings navigation unchanged", () => {
    expect(shouldRevalidateCurrentProfile(true, "select")).toBe(false);
    expect(shouldRevalidateCurrentProfile(true, "settings", "/settings/account")).toBe(false);
    expect(shouldRevalidateCurrentProfile(false, "select", "/settings/account")).toBe(false);
  });
});
