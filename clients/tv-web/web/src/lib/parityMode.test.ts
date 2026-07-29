import { describe, expect, it } from "vitest";
import { readParityMode, readTvCrossEngine } from "./parityMode";

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

  it("maps product TV cross-engine query to raster paint path", () => {
    expect(readTvCrossEngine("?tvCrossEngine=1")).toBe(true);
    expect(readTvCrossEngine("?platform=android-tv")).toBe(true);
    expect(readParityMode("?tvCrossEngine=1")).toBe("raster");
    expect(readParityMode("?platform=android-tv")).toBe("raster");
  });
});
