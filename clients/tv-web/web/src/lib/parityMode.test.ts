import { describe, expect, it } from "vitest";
import { readParityMode } from "./parityMode";

describe("readParityMode", () => {
  it("returns off when absent", () => {
    expect(readParityMode("")).toBe("off");
    expect(readParityMode("?apiBaseUrl=x")).toBe("off");
  });

  it("reads geometry and raster from query", () => {
    expect(readParityMode("?parity=geometry")).toBe("geometry");
    expect(readParityMode("?foo=1&parity=raster")).toBe("raster");
  });

  it("ignores unknown values", () => {
    expect(readParityMode("?parity=full-stage")).toBe("off");
  });
});
