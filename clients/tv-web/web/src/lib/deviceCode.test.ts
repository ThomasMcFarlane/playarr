import { describe, expect, it } from "vitest";
import { isCompleteDeviceCode, normaliseDeviceCode } from "./deviceCode";

describe("normaliseDeviceCode", () => {
  it("accepts pasted, spaced, lower-case codes", () => {
    expect(normaliseDeviceCode(" abcd 2345 ")).toBe("ABCD-2345");
  });

  it("recognises only complete codes", () => {
    expect(isCompleteDeviceCode("ABCD-2345")).toBe(true);
    expect(isCompleteDeviceCode("ABCD-23")).toBe(false);
  });
});
